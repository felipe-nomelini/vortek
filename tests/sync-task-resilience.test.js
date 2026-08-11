const assert = require('node:assert/strict');
const test = require('node:test');

const { getSyncTaskByKey } = require('../src/lib/sync/registry.ts');

test('jobs lentos usam timeout próprio e retornam para fila após falha transitória', () => {
  const dslite = getSyncTaskByKey('sync_dslite_pedidos_compra');
  const mlObserved = getSyncTaskByKey('sync_ml_listings_observed');
  const mlPublish = getSyncTaskByKey('sync_ml_listings_publish');

  assert.equal(dslite?.requestTimeoutMs, 180_000);
  assert.equal(dslite?.retryOnFailure, true);
  assert.equal(mlObserved?.requestTimeoutMs, 300_000);
  assert.equal(mlObserved?.retryOnFailure, true);
  assert.equal(mlPublish?.requestTimeoutMs, 180_000);
  assert.equal(mlPublish?.retryOnFailure, true);
});

test('publicação ML limita cada execução a vinte itens', () => {
  const mlPublish = getSyncTaskByKey('sync_ml_listings_publish');

  assert.deepEqual(mlPublish?.defaultBody, { limit: 20 });
});

test('preço e estoque DSLite permanecem agendados a cada dois minutos', () => {
  const dsliteStock = getSyncTaskByKey('sync_dslite_preco_estoque');

  assert.deepEqual(dsliteStock?.schedule, {
    businessMinutes: 2,
    offHoursMinutes: 2,
  });
});
