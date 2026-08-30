const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('proxy permite somente a rota interna exata do worker do catálogo', () => {
  const proxySource = fs.readFileSync(
    path.join(__dirname, '../src/proxy.ts'),
    'utf8',
  );

  assert.match(
    proxySource,
    /"\/api\/catalogo\/no-catalogo\/refresh\/job\/worker"/,
  );
  assert.doesNotMatch(
    proxySource,
    /pathname\.startsWith\(["']\/api\/catalogo\/no-catalogo\/refresh/,
  );
});

test('dispatcher do catálogo usa URL do ambiente sem criar outro cron', () => {
  const migrationSource = fs.readFileSync(
    path.join(
      __dirname,
      '../supabase/migrations/20260830193000_repair_catalog_refresh_dispatch.sql',
    ),
    'utf8',
  );

  assert.match(migrationSource, /key = 'catalog_refresh_worker_url'/);
  assert.match(migrationSource, /key = 'catalog_refresh_worker_host'/);
  assert.match(migrationSource, /status in \('pendente', 'on_hold'\)/);
  assert.match(migrationSource, /raise exception 'dispatch_catalog_price_refresh_cron:/);
  assert.match(migrationSource, /'X-Forwarded-Proto', 'https'/);
  assert.match(migrationSource, /timeout_milliseconds := 300000/);
  assert.doesNotMatch(migrationSource, /https:\/\/app\.vortek\.shop/);
  assert.doesNotMatch(migrationSource, /cron\.(?:schedule|unschedule|alter_job)/);
});

test('status e tela preservam acompanhamento de job on_hold', () => {
  const statusRouteSource = fs.readFileSync(
    path.join(__dirname, '../src/app/api/catalogo/no-catalogo/refresh/status/route.ts'),
    'utf8',
  );
  const catalogViewSource = fs.readFileSync(
    path.join(__dirname, '../src/components/catalogo/CatalogoView.tsx'),
    'utf8',
  );

  assert.match(
    statusRouteSource,
    /\.in\('status', \['pendente', 'rodando', 'on_hold'\]\)/,
  );
  assert.ok(
    catalogViewSource.match(/status === 'on_hold'/g)?.length >= 3,
    'polling e retomada devem tratar on_hold como ativo',
  );
});
