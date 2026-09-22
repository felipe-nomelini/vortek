const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20260922160000_ui_catalog_read_models.sql');
const worker = read('src/services/ui-read-model.ts');
const query = read('src/services/ui-read-model-query.ts');
const refreshRoute = read('src/app/api/ops/read-model/refresh/route.ts');
const cronRoute = read('src/app/api/sync/cron-dispatch/route.ts');
const proxy = read('src/proxy.ts');
const productsPage = read('src/app/(app)/produtos/page.tsx');
const listingsPage = read('src/app/(app)/anuncios/page.tsx');

test('projeções usam geração atômica e nunca ativam uma reconstrução incompleta', () => {
  assert.match(migration, /active_generation integer/);
  assert.match(migration, /target_generation integer/);
  assert.match(migration, /ui_read_model_generation_incomplete/);
  assert.match(migration, /projected_products <> source_products/);
  assert.match(migration, /projected_listings <> source_listings/);
  assert.match(migration, /where projection\.generation = v_generation/);
});

test('fila persistente deduplica, versiona, recupera claims e preserva a última projeção', () => {
  assert.match(migration, /primary key \(scope, generation, entity_kind, entity_key\)/);
  assert.match(migration, /version = public\.ui_read_model_queue\.version \+ 1/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /claimed_at < clock_timestamp\(\) - interval '5 minutes'/);
  assert.match(migration, /available_at = clock_timestamp\(\) \+ make_interval/);
  assert.match(migration, /where public\.ui_product_projection\.queue_version <= excluded\.queue_version/);
  assert.match(migration, /where public\.ui_listing_projection\.queue_version <= excluded\.queue_version/);
});

test('triggers apenas invalidam e o worker reutiliza os cálculos canônicos fora da transação', () => {
  assert.match(migration, /perform public\.enqueue_ui_read_model/);
  assert.doesNotMatch(migration, /loadProductPricing|loadProductFulfillmentCapacities/);
  for (const loader of [
    'loadProductPricing',
    'loadProductFulfillmentCapacities',
    'loadKitSupplySources',
    'loadProductMlListings',
  ]) assert.match(worker, new RegExp(loader));
  assert.match(worker, /currentPriceCents: listing\.price/);
});

test('consultas normais fazem uma RPC paginada e PDFs percorrem somente a projeção', () => {
  assert.match(query, /if \(!allRows\) return result/);
  assert.equal((query.match(/rpc\('search_ui_product_projection'/g) || []).length, 2);
  assert.equal((query.match(/rpc\('search_ui_listing_projection'/g) || []).length, 2);
  assert.match(query, /const pageSize = allRows \? 500/);
  assert.doesNotMatch(query, /search_produtos_paginated|search_ml_listings_paginated/);
});

test('processamento fica no agendador e a drenagem operacional exige segredo', () => {
  assert.match(cronRoute, /processUiReadModelBatch\(serviceClient, 100\)/);
  assert.match(refreshRoute, /process\.env\.API_SECRET_KEY/);
  assert.match(refreshRoute, /request\.headers\.get\('x-api-key'\)/);
  assert.match(refreshRoute, /maxDurationMs: 240_000/);
  assert.match(proxy, /pathname === "\/api\/ops\/read-model\/refresh"/);
  assert.match(proxy, /isInternalReadModelRoute/);
});

test('telas conservam a última página completa e sinalizam atraso sem dados parciais', () => {
  assert.match(productsPage, /setFreshness\(json\?\.freshness/);
  assert.match(productsPage, /freshness\?\.state === 'delayed'/);
  assert.doesNotMatch(productsPage, /\/api\/produtos\/resumo/);
  assert.match(listingsPage, /setFreshness\(payload\.freshness/);
  assert.match(listingsPage, /freshness\?\.state === 'delayed'/);
});

test('RLS e privilégios impedem uso das projeções como autorização do cliente', () => {
  for (const table of ['ui_read_model_state', 'ui_product_projection', 'ui_listing_projection', 'ui_read_model_queue']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /revoke all on public\.ui_read_model_state[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select, insert, update, delete[\s\S]*to service_role/);
  assert.match(migration, /nunca autoriza operacoes/);
});
