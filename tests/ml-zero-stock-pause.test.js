const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const load = require('./helpers/load-integration-module');

const {
  isProtectiveZeroStockPause,
  shouldSkipManuallyBlockedStockUpdate,
} = require('../src/lib/ml/protective-stock.ts');

const protective = {
  desiredStatus: 'pausado',
  desiredQuantity: 0,
  appliesPrice: false,
  appliesQuantityPricing: false,
  appliesQuantity: true,
  appliesStatus: true,
};

test('estoque zero e pausa formam operação protetiva independentemente da origem', () => {
  assert.equal(isProtectiveZeroStockPause(protective), true);
  assert.equal(shouldSkipManuallyBlockedStockUpdate({
    manuallyBlocked: true,
    desiredStatus: 'pausado',
    desiredQuantity: 0,
  }), false);
});

test('bloqueio manual continua impedindo aumento e ativação', () => {
  assert.equal(shouldSkipManuallyBlockedStockUpdate({
    manuallyBlocked: true,
    desiredStatus: 'ativo',
    desiredQuantity: 4,
  }), true);
  for (const invalid of [
    { ...protective, desiredQuantity: 1 },
    { ...protective, desiredStatus: 'ativo' },
    { ...protective, appliesPrice: true },
    { ...protective, appliesQuantity: false },
    { ...protective, appliesStatus: false },
  ]) assert.equal(isProtectiveZeroStockPause(invalid), false);
});

test('todos os produtores e o worker preservam a pausa obrigatória', () => {
  const stockSync = fs.readFileSync('src/app/api/sync/preco-estoque/route.ts', 'utf8');
  const internalStock = fs.readFileSync('src/lib/estoque-interno.ts', 'utf8');
  const backfill = fs.readFileSync('src/app/api/sync/anuncios/backfill-estoque-status/route.ts', 'utf8');
  const observedSync = fs.readFileSync('src/app/api/sync/anuncios/route.ts', 'utf8');
  const worker = fs.readFileSync('src/app/api/sync/anuncios/publish/route.ts', 'utf8');
  assert.match(stockSync, /shouldSkipManuallyBlockedStockUpdate/);
  assert.match(stockSync, /manual_block_bypassed_for_zero_stock/);
  assert.doesNotMatch(internalStock, /if \(produto\.ativo === false\)[\s\S]{0,120}return/);
  assert.match(internalStock, /shouldSkipManuallyBlockedStockUpdate/);
  assert.match(backfill, /zeroStockOnly/);
  assert.match(backfill, /forceStatusPublish: estoque <= 0 && observedActive/);
  assert.match(observedSync, /if \(produtoId && \['active', 'paused'\]\.includes\(observedStatus\)\)/);
  assert.doesNotMatch(observedSync, /produto\?\.ativo !== false && \['active', 'paused'\]/);
  assert.match(worker, /isProtectiveZeroStockPause/);
});

test('alerta conta anúncio ativo pela capacidade segura, sem depender de produtos.ml_status', () => {
  const alerts = fs.readFileSync('src/lib/ml/zero-stock-alerts.ts', 'utf8');
  const route = fs.readFileSync('src/app/api/ml/anuncios/alertas/route.ts', 'utf8');
  assert.match(alerts, /loadProductFulfillmentCapacities/);
  assert.match(alerts, /\.from\('anuncios_ml'\)/);
  assert.match(alerts, /\.eq\('status', 'ativo'\)/);
  assert.doesNotMatch(alerts, /ml_status/);
  assert.match(route, /loadActiveZeroSafeStockAlerts/);
});

test('alerta remove falso positivo com capacidade e conta múltiplos anúncios reais', async () => {
  const products = [
    { id: 'P0', sku: 'ZERO', nome: 'Sem estoque', estoque: 0, ativo: true },
    { id: 'P1', sku: 'INTERNO', nome: 'Com estoque interno', estoque: 0, ativo: true },
  ];
  const listings = [
    { produto_id: 'P0', ml_item_id: 'MLB1', status: 'ativo', updated_at: '2026-09-14T12:00:00Z' },
    { produto_id: 'P0', ml_item_id: 'MLB2', status: 'ativo', updated_at: '2026-09-14T13:00:00Z' },
    { produto_id: 'P1', ml_item_id: 'MLB3', status: 'ativo', updated_at: '2026-09-14T14:00:00Z' },
    { produto_id: 'P0', ml_item_id: 'MLB4', status: 'pausado', updated_at: '2026-09-14T15:00:00Z' },
  ];
  const client = { from(table) {
    const rows = table === 'produtos' ? products : listings;
    const filters = [];
    const query = {
      select() { return query; }, not() { return query; }, order() { return query; }, range() { return query; },
      in(column, values) { filters.push(row => values.includes(row[column])); return query; },
      eq(column, value) { filters.push(row => row[column] === value); return query; },
      then(resolve) { return Promise.resolve({ data: rows.filter(row => filters.every(filter => filter(row))), error: null }).then(resolve); },
    };
    return query;
  } };
  const { loadActiveZeroSafeStockAlerts } = load('src/lib/ml/zero-stock-alerts.ts', {
    '@/lib/orders/fulfillment-capacity-loader': {
      loadProductFulfillmentCapacities: async () => new Map([
        ['P0', { internal: 0, supplier: 0, safe: 0 }],
        ['P1', { internal: 1, supplier: 0, safe: 1 }],
      ]),
    },
  });

  const result = await loadActiveZeroSafeStockAlerts(client, 10);
  assert.equal(result.count, 2);
  assert.deepEqual(result.items.map(item => item.ml_item_id), ['MLB2', 'MLB1']);
});
