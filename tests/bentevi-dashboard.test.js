const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '../src/app/(app)/dashboard/page.tsx');
const dashboardRoutePath = path.join(__dirname, '../src/app/api/dashboard/resumo/route.ts');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

test('dashboard segue a hierarquia executiva Bentevi sem tendência fabricada', () => {
  const page = source(dashboardPath);

  for (const label of [
    'Visão executiva do período',
    'Operação agora',
    'Receita diária',
    'Vendas recentes',
    'Produtos com mais vendas',
    'Reputação no Mercado Livre',
    'Integrações e sincronização',
  ]) {
    assert.match(page, new RegExp(label));
  }

  assert.match(page, /PREPARATION_ORDER_STATUSES/);
  assert.match(page, /SHIPPING_ORDER_STATUSES/);
  assert.match(page, /Acumulado dos anúncios no Mercado Livre/);
  assert.doesNotMatch(page, /function Trend|ArrowUpOutlined|ArrowDownOutlined/);
});

test('período atualiza só o resumo e atualização manual consulta cada fonte uma vez', () => {
  const page = source(dashboardPath);

  assert.match(page, /dateRangeRef\.current = dateRange;\s*void fetchSummary\(dateRange\);/);
  assert.match(
    page,
    /await Promise\.all\(\[fetchSummary\(\), fetchReputation\(\), fetchIntegrations\(\)\]\)/,
  );
  assert.match(page, /if \(reloadSummary\) void fetchSummary\(\);/);
  assert.doesNotMatch(page, /if \(reloadSummary\)[\s\S]{0,80}fetchReputation/);
});

test('vendas recentes recebem o id necessário para abrir o Drawer de Vendas', () => {
  const page = source(dashboardPath);
  const route = source(dashboardRoutePath);

  assert.match(route, /const pedidosRecentes = recentRows\.map[\s\S]*id: p\.id,/);
  assert.match(page, /\/pedidos\?view=all&venda=\$\{encodeURIComponent\(order\.id\)\}/);
});

test('sincronizações distinguem sucesso, conclusão parcial e falha', () => {
  const page = source(dashboardPath);

  assert.match(page, /finalizeDsliteSync\('done', true\)/);
  assert.match(page, /finalizeDsliteSync\('partial', true\)/);
  assert.match(page, /finalizeDsliteSync\('error', false\)/);
  assert.match(page, /finalizeMlSync\(type, 'done', true\)/);
  assert.match(page, /finalizeMlSync\(type, 'partial', true\)/);
  assert.match(page, /finalizeMlSync\(type, 'error', false\)/);
});
