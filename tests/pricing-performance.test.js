const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./helpers/load-integration-module');

const performance = load('src/lib/ml/pricing-performance.ts');

function points(itemId, start, end, visits = 1) {
  const rows = [];
  for (let day = start; day < end; day = performance.shiftDateKey(day, 1)) {
    rows.push({ itemId, date: day, visits });
  }
  return rows;
}

test('interpreta a janela oficial de 150 dias e preenche dias sem visitas', () => {
  const start = '2026-04-14';
  const end = '2026-09-11';
  const payload = {
    item_id: 'MLB123456789',
    date_from: `${start}T00:00:00Z`,
    date_to: '2026-09-10T00:00:00Z',
    total_visits: 4,
    last: 149,
    unit: 'day',
    results: [
      { date: '2026-09-09T00:00:00Z', total: 3 },
      { date: '2026-09-10T00:00:00Z', total: 1 },
    ],
  };
  const parsed = performance.parseMlVisitWindow({ itemId: payload.item_id, payload, expectedStart: start, expectedEnd: end });
  assert.equal(parsed.complete, true);
  assert.equal(parsed.points.length, 150);
  assert.equal(parsed.points.find((row) => row.date === '2026-09-08').visits, 0);
  assert.equal(parsed.points.find((row) => row.date === '2026-09-09').visits, 3);
});

test('rejeita envelope parcial, total divergente e anúncio diferente', () => {
  const base = {
    item_id: 'MLB123456789',
    date_from: '2026-04-14T00:00:00Z',
    date_to: '2026-09-10T00:00:00Z',
    total_visits: 2,
    last: 149,
    unit: 'day',
    results: [{ date: '2026-09-10T00:00:00Z', total: 1 }],
  };
  assert.equal(performance.parseMlVisitWindow({ itemId: base.item_id, payload: base, expectedStart: '2026-04-14', expectedEnd: '2026-09-11' }).complete, false);
  assert.equal(performance.parseMlVisitWindow({ itemId: 'MLB999999999', payload: { ...base, total_visits: 1 }, expectedStart: '2026-04-14', expectedEnd: '2026-09-11' }).complete, false);
  assert.equal(performance.parseMlVisitWindow({ itemId: base.item_id, payload: { ...base, total_visits: 1, date_from: '2026-04-15T00:00:00Z' }, expectedStart: '2026-04-14', expectedEnd: '2026-09-11' }).complete, false);
});

test('calcula 30/90/150 sem misturar economia e deduplica pedidos do grupo', () => {
  const start = '2026-04-14';
  const end = '2026-09-11';
  const itemIds = ['MLB100000001', 'MLB100000002'];
  const visitPoints = [...points(itemIds[0], start, end, 1), ...points(itemIds[1], start, end, 2)];
  const windows = performance.buildPricingPerformanceWindows({
    endDate: end,
    itemIds,
    visitPoints,
    visitCoverages: itemIds.map((itemId) => ({ itemId, complete: true, start, end })),
    salesCoverageStart: '2026-04-01',
    salesDataComplete: true,
    sales: [
      { orderId: 'ORDER-1', itemId: itemIds[0], soldAt: '2026-09-01', quantity: 1, revenueCents: 1000, buyerId: 'BUYER-A' },
      { orderId: 'ORDER-1', itemId: itemIds[1], soldAt: '2026-09-01', quantity: 2, revenueCents: 2000, buyerId: 'BUYER-A' },
      { orderId: 'ORDER-2', itemId: itemIds[0], soldAt: '2026-09-02', quantity: 3, revenueCents: 3000, buyerId: 'BUYER-A' },
    ],
  });
  assert.deepEqual(windows.map((window) => window.days), [30, 90, 150]);
  const window30 = windows[0];
  assert.equal(window30.status, 'DISPONIVEL');
  assert.equal(window30.visits, 90);
  assert.equal(window30.sales, 2);
  assert.equal(window30.units, 6);
  assert.equal(window30.revenueCents, 6000);
  assert.equal(window30.uniqueBuyers, 1);
  assert.equal(window30.repeatBuyers, 1);
  assert.equal(window30.conversionRate, 2 / 90);
  assert.equal(window30.recurrenceRate, 1);
});

test('distingue zero comprovado de janela sem amostra', () => {
  const start = '2026-04-14';
  const end = '2026-09-11';
  const itemId = 'MLB100000003';
  const complete = performance.buildPricingPerformanceWindows({
    endDate: end,
    itemIds: [itemId],
    visitPoints: points(itemId, start, end, 0),
    visitCoverages: [{ itemId, complete: true, start, end }],
    sales: [],
    salesCoverageStart: '2026-04-01',
  });
  assert.equal(complete[0].status, 'DISPONIVEL');
  assert.equal(complete[0].visits, 0);
  assert.equal(complete[0].sales, 0);
  assert.equal(complete[0].conversionRate, null);

  const partial = performance.buildPricingPerformanceWindows({
    endDate: end,
    itemIds: [itemId],
    visitPoints: points(itemId, '2026-08-13', end, 0),
    visitCoverages: [{ itemId, complete: false, start: '2026-08-13', end }],
    sales: [],
    salesCoverageStart: null,
  });
  assert.equal(partial[0].status, 'SEM_AMOSTRA');
  assert.equal(partial[0].visits, null);
  assert.equal(partial[0].coverage.visits, 'PARCIAL');
  assert.equal(partial[0].coverage.sales, 'INDISPONIVEL');
});

test('não inventa recorrência quando a venda não identifica o comprador', () => {
  const start = '2026-04-14';
  const end = '2026-09-11';
  const itemId = 'MLB100000004';
  const [window30] = performance.buildPricingPerformanceWindows({
    endDate: end,
    itemIds: [itemId],
    visitPoints: points(itemId, start, end, 1),
    visitCoverages: [{ itemId, complete: true, start, end }],
    salesCoverageStart: '2026-04-01',
    sales: [{ orderId: 'ORDER-3', itemId, soldAt: '2026-09-01', quantity: 1, revenueCents: 1000, buyerId: null }],
  });
  assert.equal(window30.status, 'DISPONIVEL');
  assert.equal(window30.sales, 1);
  assert.equal(window30.uniqueBuyers, null);
  assert.equal(window30.repeatBuyers, null);
  assert.equal(window30.recurrenceRate, null);
});

test('usa dias completos no fuso de São Paulo', () => {
  const period = performance.performancePeriod(30, '2026-09-11');
  assert.equal(period.startDate, '2026-08-12');
  assert.equal(period.periodStart, '2026-08-12T03:00:00.000Z');
  assert.equal(period.periodEnd, '2026-09-11T03:00:00.000Z');
});

test('rota exige permissão, valida entrada e não contém operação comercial', () => {
  const route = fs.readFileSync('src/app/api/ml/anuncio/desempenho/route.ts', 'utf8');
  const service = fs.readFileSync('src/services/pricing-performance.ts', 'utf8');
  const sync = fs.readFileSync('src/app/api/sync/anuncios/route.ts', 'utf8');
  assert.match(route, /authorizeApiRequest\(request, 'pricing\.read'\)/);
  assert.match(route, /forceRefresh/);
  assert.match(service, /visits\/time_window\?last=149&unit=day/);
  assert.match(sync, /\/visits\/items\?ids=/);
  assert.match(service, /ownedItem\.data\.seller_id/);
  assert.match(service, /group\.sellerId === sellerId/);
  assert.match(service, /\.neq\('pedido\.situacao', 'cancelado'\)/);
  assert.doesNotMatch(service, /atualizar-preco|pricing_operations|anuncios_ml_outbox|method:\s*['"]PUT['"]/);
});

test('migration protege tabelas e persiste a janela atomicamente', () => {
  const migration = fs.readFileSync('supabase/migrations/20260911190000_bnt_pricing_v2_09_performance.sql', 'utf8');
  assert.match(migration, /create table public\.ml_listing_visit_days/);
  assert.match(migration, /primary key \(seller_id, ml_item_id, metric_date\)/);
  assert.match(migration, /on conflict \(seller_id, ml_item_id, metric_date\) do update/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant execute on function public\.persist_ml_listing_visit_window[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.ml_listing_visit/);
  assert.doesNotMatch(migration, /grant (select|execute)[\s\S]*to authenticated/);
});
