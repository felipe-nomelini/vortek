const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CATALOG_REFRESH_BATCH_SIZE,
  CATALOG_REFRESH_ITEM_MAX_ATTEMPTS,
  CATALOG_REFRESH_MAX_FAILURES,
  calculateCatalogRefreshProgress,
  calculateCatalogRefreshOutcome,
  getCatalogRefreshFailureStage,
  normalizeCatalogRefreshItemIds,
  splitCatalogRefreshFailures,
} = require('../src/lib/catalogo/refresh-batch.ts');
const { presentCatalogRefresh } = require('../src/lib/catalogo/refresh-presentation.ts');

test('refresh completo usa lotes pequenos e retomáveis', () => {
  assert.equal(CATALOG_REFRESH_BATCH_SIZE, 100);
  assert.equal(CATALOG_REFRESH_MAX_FAILURES, 3);
  assert.equal(CATALOG_REFRESH_ITEM_MAX_ATTEMPTS, 3);
});

test('cada anúncio tem até três tentativas antes de encerrar com os dados anteriores', () => {
  assert.deepEqual(
    splitCatalogRefreshFailures([
      { ml_item_id: 'MLB1', attempts: 0 },
      { ml_item_id: 'MLB2', attempts: 1 },
      { ml_item_id: 'MLB3', attempts: 2 },
      { ml_item_id: 'MLB4', attempts: 8 },
    ], ['MLB1', 'MLB2', 'MLB3', 'MLB4']),
    { retryable: ['MLB1', 'MLB2'], exhausted: ['MLB3', 'MLB4'] },
  );
});

test('apresentação do resultado não expõe estados internos', () => {
  const running = presentCatalogRefresh({ status: 'on_hold', processed: 100, total: 500 });
  const partial = presentCatalogRefresh({ status: 'completo_parcial', processed: 500, total: 500, detailsUnavailable: 2 });
  const failed = presentCatalogRefresh({ status: 'erro', processed: 500, total: 500 });

  assert.equal(running.tone, 'info');
  assert.equal(partial.tone, 'warning');
  assert.match(partial.description, /dados anteriores foram preservados/i);
  assert.equal(failed.tone, 'error');
  assert.doesNotMatch(JSON.stringify([running, partial, failed]), /on_hold|completo_parcial|refresh|snapshot|job/i);
});

test('resultado distingue sucesso, pendência parcial e falha total', () => {
  assert.deepEqual(
    calculateCatalogRefreshOutcome({ total: 100, detailsUnavailable: 0, competitionUnavailable: 0 }),
    { status: 'completo', total: 100, updated: 100, detailsUnavailable: 0, competitionUnavailable: 0, issues: 0 },
  );
  assert.deepEqual(
    calculateCatalogRefreshOutcome({ total: 100, detailsUnavailable: 2, competitionUnavailable: 3 }),
    { status: 'completo_parcial', total: 100, updated: 98, detailsUnavailable: 2, competitionUnavailable: 3, issues: 5 },
  );
  assert.deepEqual(
    calculateCatalogRefreshOutcome({ total: 100, detailsUnavailable: 100, competitionUnavailable: 0 }),
    { status: 'erro', total: 100, updated: 0, detailsUnavailable: 100, competitionUnavailable: 0, issues: 100 },
  );
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

test('falha fica associada ao último estágio conhecido do refresh', () => {
  assert.equal(getCatalogRefreshFailureStage([
    { stage: 'scan_catalog', event_type: 'catalog_refresh_progress' },
  ]), 'scan_catalog');
  assert.equal(getCatalogRefreshFailureStage([
    { stage: 'scan_catalog', event_type: 'catalog_refresh_progress' },
    { stage: 'fetch_details', event_type: 'catalog_refresh_progress' },
  ]), 'fetch_details');
  assert.equal(getCatalogRefreshFailureStage([
    { stage: 'fetch_details', event_type: 'catalog_refresh_progress' },
    { stage: 'fetch_price_to_win', event_type: 'catalog_refresh_batch_completed' },
  ]), 'fetch_price_to_win');
});

test('falha ignora completed e usa fallback quando não há estágio conhecido', () => {
  assert.equal(getCatalogRefreshFailureStage([
    { stage: 'fetch_price_to_win', event_type: 'catalog_refresh_batch_completed' },
    { stage: 'completed', event_type: 'catalog_refresh_progress' },
  ]), 'fetch_price_to_win');
  assert.equal(getCatalogRefreshFailureStage([{ stage: '  ' }, null]), 'scan_catalog');
  assert.equal(getCatalogRefreshFailureStage([]), 'scan_catalog');
  assert.equal(getCatalogRefreshFailureStage('invalid'), 'scan_catalog');
});

test('tratamento da falha usa o estágio calculado em vez de constante', () => {
  const jobSource = fs.readFileSync(
    path.join(__dirname, '../src/services/catalog-refresh-job.ts'),
    'utf8',
  );
  const failureHandler = jobSource.slice(
    jobSource.indexOf('async function markJobFailure'),
    jobSource.indexOf('async function finalizeRefresh'),
  );

  assert.match(failureHandler, /const failureStage = getCatalogRefreshFailureStage\(logs\)/);
  assert.match(failureHandler, /stage: failureStage/);
  assert.doesNotMatch(failureHandler, /stage: ['"]fetch_price_to_win['"]/);
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
    catalogViewSource.match(/\['pendente', 'rodando', 'on_hold'\]\.includes/g)?.length >= 2,
    'polling e retomada devem tratar on_hold como ativo',
  );
  assert.match(statusRouteSource, /presentCatalogRefresh/);
  assert.doesNotMatch(catalogViewSource, /Atualização do catálogo · \$\{refreshPayload\.job\.status/);
  assert.doesNotMatch(catalogViewSource, /refreshPayload\.job\.last_event\?\.message/);
  assert.doesNotMatch(catalogViewSource, /refreshPayload\.failures\?\.\[0\]/);
});

test('contagem final não soma a mesma falha de detalhe duas vezes', () => {
  const jobSource = fs.readFileSync(
    path.join(__dirname, '../src/services/catalog-refresh-job.ts'),
    'utf8',
  );

  assert.match(jobSource, /detailsUnavailableCount/);
  assert.match(jobSource, /competition_unavailable_count/);
  assert.doesNotMatch(jobSource, /warningCount \|\| 0\) \+ upstreamWarningCount/);
  assert.match(jobSource, /splitCatalogRefreshFailures/);
});
