const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CATALOG_REFRESH_BATCH_SIZE,
  CATALOG_REFRESH_MAX_FAILURES,
  calculateCatalogRefreshProgress,
  getCatalogRefreshFailureStage,
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

test('falha fica associada à etapa ativa do refresh', () => {
  assert.equal(getCatalogRefreshFailureStage([
    { stage: 'scan_catalog', event_type: 'catalog_refresh_progress' },
  ]), 'scan_catalog');
  assert.equal(getCatalogRefreshFailureStage([
    { stage: 'scan_catalog', event_type: 'catalog_refresh_progress' },
    { stage: 'fetch_price_to_win', event_type: 'catalog_refresh_batch_completed' },
  ]), 'fetch_price_to_win');
  assert.equal(getCatalogRefreshFailureStage([]), 'scan_catalog');
});

test('middleware permite somente a rota interna exata do worker do catálogo', () => {
  const middlewareSource = fs.readFileSync(
    path.join(__dirname, '../src/middleware.ts'),
    'utf8',
  );

  assert.match(
    middlewareSource,
    /"\/api\/catalogo\/no-catalogo\/refresh\/job\/worker"/,
  );
  assert.doesNotMatch(
    middlewareSource,
    /pathname\.startsWith\(["']\/api\/catalogo\/no-catalogo\/refresh/,
  );
});
