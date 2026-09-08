/* UI isolada: nenhum servidor, login, banco ou API externa é acessado.
 * Use ferramentas já instaladas via BNT_PLAYWRIGHT_PATH e BNT_ESBUILD_PATH.
 * Não instala dependências. Screenshots ficam no diretório temporário informado no log.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require(process.env.BNT_PLAYWRIGHT_PATH || 'playwright');
const { expect } = require((process.env.BNT_PLAYWRIGHT_PATH || 'playwright') + '/test');
const esbuild = require(process.env.BNT_ESBUILD_PATH || 'esbuild');
const root = path.resolve(__dirname, '../..');
process.chdir(root);
const load = require('../helpers/load-integration-module');
const policy = require('../../src/services/pricing-policy.ts');
const taxRules = require('../../src/services/pricing.ts');
const economy = load('src/services/pricing-economy.ts', { './pricing-policy': policy, './pricing': taxRules,
  './pricing-core.js': require('../../src/services/pricing-core.js') });
const pricingContext = load('src/services/pricing-context.ts', { 'server-only': {}, './pricing-economy': economy,
  './commercial-pricing-configuration': {}, './pricing-tax-context': {}, '@/lib/preferred-offer': {}, '@/lib/dslite/supplier-policy': {} });
const tax = { appliedRate: .04, estimatedRate: .04, confirmedRate: null, rbt12: 100000,
  bracket: 1, source: 'estimated', referenceMonth: '2026-09', manualRequired: false, warning: null };

async function main() {
  const result = await esbuild.build({ absWorkingDir: root, bundle: true, write: false, outfile: 'browser-test.js',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { message } from 'antd';
      import Providers from './src/lib/Providers';
      import ComercialTab from './src/components/configuracoes/ComercialTab';
      import 'antd/dist/reset.css';
      function Harness() { const [api, holder] = message.useMessage();
        return <Providers>{holder}<main style={{padding:24}}><ComercialTab messageApi={api} /></main></Providers>; }
      createRoot(document.getElementById('root')!).render(<Harness />);
    ` },
  });
  const assets = Object.fromEntries(result.outputFiles.map(file => [path.extname(file.path), file.text]));
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'bnt-v2-15-ui-'));
  const browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext({ viewport: { width: 1380, height: 1080 } });
  const page = await browserContext.newPage();
  page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let dto = { mlFeeFallbackPercent: 15, unspecifiedShippingCost: 30, inactiveCostThreshold: 2000,
    finalPricePolicy: policy.FINAL_PRICE_POLICY, pricingTaxContext: { ...tax } };
  let getMode = 'ok', putMode = 'ok', simulateMode = 'ok', heldSimulation = null, heldPut = null;
  const writes = [], simulations = [], unexpected = [];
  let reads = 0;
  await browserContext.route('**/*', async route => {
    const url = new URL(route.request().url());
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (url.hostname !== '127.0.0.1') { unexpected.push(url.origin); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="pt-BR"><head><link rel="stylesheet" href="/bundle.css"></head><body style="background:#0b0b0b;color:#f5f5f5"><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'application/javascript', body: assets['.js'] });
    if (url.pathname === '/bundle.css') return route.fulfill({ contentType: 'text/css', body: assets['.css'] });
    if (url.pathname === '/api/configuracoes/comercial/simular') {
      const input = route.request().postDataJSON(); simulations.push(input);
      const data = { pricing: pricingContext.simulateProductPricing({ ...input, taxContext: dto.pricingTaxContext, evaluatedAt: '2026-09-08T12:00:00.000Z' }), pricingTaxContext: dto.pricingTaxContext };
      if (simulateMode === 'held') { heldSimulation = () => json(data); return; }
      if (simulateMode === 'fail') return json({ erro: 'Contexto fiscal indisponível' }, 503);
      return json(data);
    }
    if (url.pathname === '/api/configuracoes/comercial') {
      if (route.request().method() === 'GET') {
        reads++;
        return getMode === 'ok' ? json(dto) : getMode === 'malformed' ? json({}) : json({ erro: 'Indisponível' }, 500);
      }
      const input = route.request().postDataJSON(); writes.push(input);
      if (putMode === 'fail') return json({ erro: 'Falha controlada ao salvar' }, 500);
      dto = { ...dto, ...input };
      if (putMode === 'held') { heldPut = () => json(dto); return; }
      if (putMode === 'partial') return json({ erro: 'Configuração salva, mas o histórico falhou', persisted: true }, 500);
      return json(dto);
    }
    unexpected.push(url.pathname); return route.abort();
  });
  const save = page.getByRole('button', { name: /Salvar parâmetros comerciais$/ });
  const simulate = page.getByRole('button', { name: 'Simular no servidor' });
  const fee = page.getByLabel('Taxa estimada do ML', { exact: true });
  const shipping = page.getByLabel('Frete estimado — a combinar', { exact: true });
  const threshold = page.getByLabel('Limite de custo da oferta', { exact: true });
  const cost = page.getByLabel('Custo (CMV)', { exact: true });
  const price = page.getByLabel('Preço de venda para avaliar (opcional)', { exact: true });
  const refresh = page.getByRole('button', { name: 'Atualizar dados' });
  const table = page.getByRole('table');
  const checkpoints = [];
  const passed = name => { checkpoints.push(name); console.log('PASS ' + name); };
  try {
    await page.goto('http://127.0.0.1:43177/');
    await expect(fee).toHaveValue(/^15(?:\.00)?$/); await expect(save).toBeDisabled(); await expect(simulate).toBeDisabled();
    await expect(cost).toHaveValue('');
    await expect(page.getByText(/Política canônica por preço final/)).toContainText('M2M-PRC-01-v1');
    await expect(page.getByRole('link', { name: 'Gerenciar em Empresa e fiscal' })).toHaveAttribute('href', '/configuracoes?tab=empresa');
    await expect(page.getByText(/Estimada · Competência/)).toBeVisible();
    passed('carregamento válido, política e fiscal somente leitura, custo vazio');

    await cost.fill('0'); await expect(simulate).toBeEnabled(); await simulate.click();
    await expect(table).toBeVisible(); assert.equal(simulations.at(-1).costCents, 0);
    await cost.fill(''); await expect(simulate).toBeDisabled(); await expect(table).toHaveCount(0);
    passed('zero explícito aceito; ausência não vira zero');

    await cost.fill('80'); await price.fill('200'); await simulate.click(); await expect(table).toBeVisible();
    await expect(table).toContainText('Preço avaliado'); await expect(table).toContainText('Taxa do cenário');
    await expect(table).toContainText('Equilíbrio'); await expect(table).toContainText('4,00%');
    await page.screenshot({ path: path.join(artifacts, 'commercial-desktop.png'), fullPage: true });
    passed('memória econômica completa sem se passar por cotação viva');

    await fee.fill('20'); await shipping.fill('40'); await expect(save).toBeEnabled(); await expect(table).toHaveCount(0);
    await simulate.click(); await expect(table).toBeVisible();
    assert.equal(simulations.at(-1).feeRate, .15); assert.equal(simulations.at(-1).shippingCents, 3000);
    await page.getByText('Alterações do formulário', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Alterações do formulário' })).toBeChecked(); await expect(table).toHaveCount(0);
    await simulate.click(); await expect(table).toBeVisible();
    assert.equal(simulations.at(-1).feeRate, .20); assert.equal(simulations.at(-1).shippingCents, 4000);
    assert.equal(simulations.at(-1).priceCents, 20000); assert.equal('inactiveCostThreshold' in simulations.at(-1), false);
    passed('valores salvos e formulário são cenários separados; threshold fora da economia');

    await save.click(); const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('15% → 20%'); await expect(dialog).toContainText('Taxa estimada do ML');
    await page.getByRole('button', { name: 'Revisar', exact: true }).click();
    await expect(dialog).toHaveCount(0); assert.equal(writes.length, 0); await expect(fee).toHaveValue(/^20(?:\.00)?$/);
    passed('confirmação mostra antes/depois; cancelar não grava');

    const readsBefore = reads;
    await refresh.click(); await page.getByRole('button', { name: 'Continuar editando' }).click();
    assert.equal(reads, readsBefore); await expect(shipping).toHaveValue(/^40(?:\.00)?$/);
    await refresh.click(); await page.getByRole('button', { name: 'Descartar e atualizar' }).click();
    await expect(shipping).toHaveValue(/^30(?:\.00)?$/); await expect(save).toBeDisabled(); await expect(table).toHaveCount(0);
    passed('atualização confirma descarte e relê servidor');

    await fee.fill('20'); putMode = 'fail'; await save.click();
    await page.getByRole('button', { name: 'Confirmar e salvar' }).click();
    await expect(page.getByText('Falha controlada ao salvar', { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible(); assert.equal(writes.length, 1);
    await page.getByRole('button', { name: 'Revisar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    putMode = 'held'; await save.click(); await page.getByRole('button', { name: 'Confirmar e salvar' }).click();
    await expect.poll(() => !!heldPut).toBe(true);
    await expect(fee).toBeDisabled(); await expect(save).toBeDisabled();
    await heldPut(); await expect(dialog).toHaveCount(0); await expect(save).toBeDisabled();
    assert.deepEqual(writes.at(-1), { mlFeeFallbackPercent: 20, unspecifiedShippingCost: 30, inactiveCostThreshold: 2000 });
    passed('erro mantém confirmação; sucesso atualiza estado e bloqueia gravações concorrentes');

    await shipping.fill('45'); putMode = 'partial'; await save.click();
    await page.getByRole('button', { name: 'Confirmar e salvar' }).click();
    await expect(dialog).toContainText('Salvo com pendência administrativa');
    await expect(dialog.getByRole('button', { name: 'Confirmar e salvar' })).toBeDisabled();
    await expect(shipping).toHaveValue(/^45(?:\.00)?$/);
    assert.equal(writes.length, 3); await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Salvo com pendência administrativa', { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    passed('persistência parcial avisa, recarrega e não repete PUT');

    await threshold.fill('0'); await expect(save).toBeDisabled();
    await threshold.fill('2000'); await fee.fill(''); await expect(simulate).toBeDisabled(); await expect(save).toBeDisabled();
    await refresh.click(); await page.getByRole('button', { name: 'Descartar e atualizar' }).click();
    await expect(fee).toHaveValue(/^20(?:\.00)?$/);
    passed('limites e campos ausentes impedem salvamento inválido');

    simulateMode = 'held'; await simulate.click(); await expect.poll(() => !!heldSimulation).toBe(true);
    await cost.fill('81'); await heldSimulation(); await expect(table).toHaveCount(0);
    simulateMode = 'ok'; await simulate.click(); await expect(table).toBeVisible();
    await expect(page.getByText(/CMV:/)).toContainText('81');
    passed('editar entradas invalida resposta em voo; somente novo cenário é exibido');

    simulateMode = 'fail'; await simulate.click();
    await expect(page.getByText('Simulação indisponível', { exact: true })).toBeVisible(); await expect(table).toHaveCount(0);
    simulateMode = 'ok'; dto.pricingTaxContext = { ...tax, appliedRate: null, source: 'unavailable', warning: 'Fiscal sem evidência' };
    await refresh.click(); await expect(page.getByText(/Indisponível · Competência/)).toBeVisible();
    await simulate.click(); await expect(table).toBeVisible(); await expect(table).toContainText('—');
    passed('falha de simulação e fiscal indisponível não preservam resultados antigos');

    getMode = 'fail'; await refresh.click();
    await expect(page.getByText('Configuração indisponível', { exact: true })).toBeVisible();
    await expect(fee).toBeDisabled(); await expect(save).toBeDisabled(); await expect(simulate).toBeDisabled();
    getMode = 'malformed'; await refresh.click(); await expect(save).toBeDisabled();
    getMode = 'ok'; dto.pricingTaxContext = { ...tax }; await refresh.click(); await expect(fee).toBeEnabled();
    passed('falha ou resposta incompatível bloqueia edição até nova leitura válida');

    await page.setViewportSize({ width: 768, height: 1024 }); await simulate.click(); await expect(table).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'commercial-768.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'a tabela deve rolar internamente, sem estourar a página');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    passed('layout 768px sem overflow global e nenhum acesso externo');
    console.log(JSON.stringify({ passed: checkpoints.length, writesMocked: writes.length, simulationsMocked: simulations.length, errors, unexpected, artifacts }));
  } catch (error) {
    console.error('Browser errors:', errors);
    console.error('Accessibility:', await page.locator('body').ariaSnapshot());
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
    console.error('Artifacts: ' + artifacts); throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
