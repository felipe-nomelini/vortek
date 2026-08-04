const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CATALOG_REFRESH_BATCH_SIZE,
  CATALOG_REFRESH_MAX_FAILURES,
  calculateCatalogRefreshProgress,
  normalizeCatalogRefreshItemIds,
} = require('../src/lib/catalogo/refresh-batch.ts');

test('refresh completo usa lotes pequenos e retomáveis', () => {
  assert.equal(CATALOG_REFRESH_BATCH_SIZE, 100);
  assert.equal(CATALOG_REFRESH_MAX_FAILURES, 3);
});

test('manifesto remove ids vazios e duplicados', () => {
  assert.deepEqual(
    normalizeCatalogRefreshItemIds(['MLB1', ' MLB2 ', 'MLB1', '', null]),
    ['MLB1', 'MLB2'],
  );
});

test('progresso do lote permanece entre etapas de consulta e finalização', () => {
  assert.equal(calculateCatalogRefreshProgress(0, 5000), 32);
  assert.equal(calculateCatalogRefreshProgress(2500, 5000), 60);
  assert.equal(calculateCatalogRefreshProgress(5000, 5000), 88);
  assert.equal(calculateCatalogRefreshProgress(6000, 5000), 88);
});
