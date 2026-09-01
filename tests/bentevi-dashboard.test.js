const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '../src/app/(app)/dashboard/page.tsx');
const dashboardStylePath = path.join(__dirname, '../src/app/(app)/dashboard/dashboard.module.css');
const dashboardRoutePath = path.join(__dirname, '../src/app/api/dashboard/resumo/route.ts');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

test('dashboard é um cockpit comercial gamificado, sem integração ou reputação', () => {
  const page = source(dashboardPath);

  for (const label of [
    'Meta de lucro',
    'Ritmo comercial',
    'Pulso da operação',
    'Produtos que puxaram o resultado',
    'Vendas recentes',
  ]) {
    assert.match(page, new RegExp(label));
  }

  assert.match(page, /type="dashboard"/);
  assert.match(page, /\[25, 50, 75, 100\]/);
  assert.match(page, /Hoje[\s\S]*7 dias[\s\S]*30 dias/);
  assert.doesNotMatch(page, /api\/ml\/reputacao|api\/integracoes\/status/);
  assert.doesNotMatch(page, /api\/sync\/|Sincronizar|Reputação no Mercado Livre|Integrações e sincronização/);
});

test('dashboard compara métricas reais e preserva o acesso ao Drawer de Vendas', () => {
  const page = source(dashboardPath);

  assert.match(page, /Faturamento[\s\S]*Lucro[\s\S]*Pedidos/);
  assert.match(page, /dataKey="current"/);
  assert.match(page, /dataKey="previous"/);
  assert.match(page, /Período anterior/);
  assert.match(page, /\/pedidos\?view=all&venda=\$\{encodeURIComponent\(order\.id\)\}/);
  assert.match(page, /Lucro pendente/);
});

test('resumo usa a venda operacional, períodos equivalentes e exclui cancelamentos', () => {
  const route = source(dashboardRoutePath);

  assert.match(route, /type DashboardPreset = "today" \| "7d" \| "30d"/);
  assert.match(route, /previousStart = new Date\(currentStart\.getTime\(\) - days \* DAY_MS\)/);
  assert.match(route, /previousEnd = new Date\(currentEnd\.getTime\(\) - days \* DAY_MS\)/);
  assert.match(route, /from\("pedidos_operacionais"\)/);
  assert.match(route, /if \(normalizeStatus\(row\.situacao\) === "cancelado"\) continue/);
  assert.match(route, /operational_total/);
  assert.match(route, /operational_lucro/);
  assert.match(route, /profitPending/);
});

test('resumo reutiliza filas operacionais e agrega produtos vendidos no período', () => {
  const route = source(dashboardRoutePath);

  assert.match(route, /enrichOrdersWithWhatsappStatus/);
  assert.match(route, /matchesOrdersOperationalView\(row, "urgent"\)/);
  assert.match(route, /matchesOrdersOperationalView\(row, "preparation"\)/);
  assert.match(route, /matchesOrdersOperationalView\(row, "shipping"\)/);
  assert.match(route, /from\("pedido_itens"\)/);
  assert.match(route, /valor_total_liquido/);
  assert.doesNotMatch(route, /from\("anuncios_ml"\)/);
  assert.doesNotMatch(route, /fulfillment_source/);
});

test('layout evita grade de cards pequenos e possui adaptação desktop', () => {
  const page = source(dashboardPath);
  const styles = source(dashboardStylePath);

  assert.doesNotMatch(page, /\bCard\b/);
  assert.match(styles, /\.hero[\s\S]*grid-template-columns/);
  assert.match(styles, /\.operationTrack[\s\S]*grid-template-columns/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /@media \(max-width: 820px\)/);
});
