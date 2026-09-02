const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const page = read('src/app/(app)/anuncios/page.tsx');
const styles = read('src/app/(app)/anuncios/anuncios.module.css');
const route = read('src/app/api/anuncios/route.ts');
const statusRoute = read('src/app/api/anuncios/status-lote/route.ts');
const detailRoute = read('src/app/api/ml/anuncio/preco-detalhe/route.ts');
const priceRoute = read('src/app/api/ml/anuncio/atualizar-preco/route.ts');
const fixture = read('src/lib/ml/listings-dashboard.ts');
const migration = read('supabase/migrations/20260902170000_bnt_d11_ml_listings_search.sql');

test('BNT-D11 organiza anúncios por decisão operacional', () => {
  for (const label of ['Total monitorado', 'Ativos', 'Pausados', 'Qualidade em risco', 'Preço em revisão']) {
    assert.match(page, new RegExp(label));
  }
  for (const column of ['Anúncio', 'Produto', 'Preço e resultado', 'Desempenho', 'Qualidade', 'Estado', 'Catálogo', 'Ações']) {
    assert.match(page, new RegExp(`title: '${column}'`));
  }
  assert.match(page, /Analisar/);
  assert.match(page, /Análise do anúncio/);
  assert.match(styles, /var\(--bentevi-primary/);
});

test('BNT-D11 separa as contagens dos rótulos nas filas rápidas', () => {
  assert.match(page, /styles\.quickViewLabel/);
  assert.equal((page.match(/styles\.quickViewCount/g) || []).length, 5);
  assert.match(styles, /\.quickViewCount[\s\S]*linear-gradient\(135deg, rgba\(255, 189, 14, 0\.14\), rgba\(255, 189, 14, 0\.02\)\)/);
  assert.match(styles, /font-variant-numeric: tabular-nums/);
});

test('BNT-D11 pagina, filtra, resume e ordena em uma única RPC', () => {
  assert.match(route, /rpc\('search_ml_listings_paginated'/);
  assert.doesNotMatch(route, /\.from\('anuncios_ml'\)/);
  assert.match(migration, /row_number\(\) over/);
  assert.match(migration, /'metrics', jsonb_build_object/);
  assert.match(migration, /'queueCounts', jsonb_build_object/);
  assert.match(migration, /listing\.item_id asc/);
  assert.doesNotMatch(migration, /create index/i);
  assert.equal(fs.existsSync(path.join(root, 'src/app/api/anuncios/resumo/route.ts')), false);
});

test('BNT-D11 só classifica qualidade quando a fonte é o endpoint de performance', () => {
  assert.match(migration, /qualidade_info ->> 'source' = 'mercado_livre_performance'/);
  assert.match(migration, /quality_available and quality_score < 80/);
  assert.match(fixture, /qualityInfo\?\.source === 'mercado_livre_performance'/);
  assert.match(page, /Leitura não disponível/);
});

test('BNT-D11 usa alíquota dinâmica e mantém cálculo de rentabilidade no backend', () => {
  assert.match(route, /loadPricingTaxContext/);
  assert.match(route, /p_tax_rate: taxRate/);
  assert.match(migration, /base\.price \* p_tax_rate/);
  assert.doesNotMatch(migration, /base\.price \* 0\.0[45]/);
  assert.match(migration, /raise exception 'p_tax_rate inválida/);
});

test('BNT-D11 altera um preço único nos anúncios padrão e catálogo vinculados', () => {
  assert.match(page, /scope: 'linked'/);
  assert.match(page, /O mesmo preço será aplicado ao anúncio padrão e ao anúncio de catálogo/);
  assert.match(page, /result\.type === 'catalog'/);
  assert.match(priceRoute, /body\?\.scope === 'linked'/);
  assert.match(page, /useMlPricePublishTracking/);
  assert.match(page, /atualizar-preco\/status\?outboxId/);
});

test('BNT-D11 detecta preço automático antes de habilitar edição manual', () => {
  assert.match(detailRoute, /automaticPricing/);
  assert.match(detailRoute, /hasMlAutomaticPrice\(itemResult\.data\)/);
  assert.match(priceRoute, /hasMlAutomaticPrice\(result\.data\)/);
  assert.match(page, /details\.automaticPricing\?\.active/);
  assert.match(page, /Preço automático ativo no Mercado Livre/);
});

test('BNT-D11 altera status somente pelo anúncio operacional e relata cada item', () => {
  assert.match(page, /row\.isOperational && row\.productId/);
  assert.match(page, /Anúncios irmãos de catálogo não serão alterados diretamente/);
  assert.match(page, /\/api\/anuncios\/status-lote/);
  assert.match(statusRoute, /select\('id, sku, ml_item_id, custom_price, estoque, ml_status'\)/);
  assert.match(statusRoute, /items,/);
  for (const outcome of ['queued', 'already_target', 'unchanged', 'skipped_no_item', 'skipped_ineligible', 'failed']) {
    assert.match(statusRoute, new RegExp(outcome));
  }
});

test('BNT-D11 acompanha atualização observada sem polling silencioso', () => {
  assert.match(page, /\/api\/sync\/anuncios\/job/);
  assert.match(page, /\/api\/sync\/anuncios\/status\?jobId/);
  assert.match(page, /syncFailures/);
  assert.match(page, /Tentar novamente/);
  assert.doesNotMatch(page, /catch \{\}/);
});

test('BNT-D11 reutiliza a amostra real protegida e bloqueia mutações', () => {
  assert.match(route, /loadBntD07VisualReview\(\)/);
  assert.match(route, /listBntD11VisualReview/);
  assert.match(fixture, /isHomologationFixture: true/);
  assert.match(page, /Amostra real de produção, somente leitura/);
  assert.match(page, /Sincronização, preço, status e links externos permanecem bloqueados/);
  assert.doesNotMatch(fixture, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});

test('RPC BNT-D11 aplica privilégio mínimo e search_path seguro', () => {
  assert.match(migration, /stable/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
});

test('BNT-D11 preserva relatório existente como etapa separada', () => {
  assert.match(page, /Relatório atual; o redesign do PDF será feito em BNT-D11-PDF/);
  assert.match(page, /\/api\/anuncios\/exportar-pdf/);
});
