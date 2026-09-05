#!/usr/bin/env node
/* Phase 5D.1: GET-only remote validation and one local PostgreSQL transaction. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { attributeValue, extractShippingCost, normalize } = require('./lib/ml-p0-phase5c');
const { EXPECTED, financialAt, validateIdentity } = require('./lib/ml-p0-phase5d');
const { buildTransactionSql, compareLocalRemote, localReadbackSql } = require('./lib/ml-p0-phase5d1');

dotenv.config({ path: '.env.local', quiet: true });
const REPORT_DIR = path.resolve('reports/ml-p0-phase5d1');
const HOLD = 'P0 PHASE 5D.1 — SAFE PUBLICATION PERSISTENCE HOLD';
const SSH_HOST = '192.168.1.160';
const DB_CONTAINER = 'supabase-db';
const KNOWN_MAX_SHIPPING = 68.65;
const now = () => new Date().toISOString();
const metrics = { ml_gets: 0, ml_writes: 0, supabase_reads: 0, postgres_transactions: 0, second_sku_actions: 0 };

fs.mkdirSync(REPORT_DIR, { recursive: true });
const writeJson = (name, value) => fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);

async function mlGet(token, resource, allowError = false) {
  const method = 'GET';
  if (method !== 'GET') throw new Error('remote_write_forbidden');
  metrics.ml_gets += 1;
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok && !allowError) throw new Error(`ml_http_${response.status}:${resource}:${data?.message || data?.error || 'unknown'}`);
  return { ok: response.ok, status: response.status, data };
}

function createDb() {
  const url = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_configuration_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function dbSelect(db, table, select, configure) {
  metrics.supabase_reads += 1;
  let query = db.from(table).select(select);
  if (configure) query = configure(query);
  const { data, error } = await query;
  if (error) throw new Error(`supabase_${table}:${error.message}`);
  return data || [];
}

function psql(sql) {
  const command = `docker exec -i ${DB_CONTAINER} psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At`;
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', SSH_HOST, command], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = new Error(`psql_failed:${String(result.stderr || result.stdout).trim()}`);
    error.stderr = result.stderr;
    throw error;
  }
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('psql_json_output_missing');
  return JSON.parse(lines.at(-1));
}

async function scanInventory(token) {
  const ids = [];
  const seen = new Set();
  let scrollId = '';
  let expectedTotal = null;
  let pages = 0;
  while (pages < 1000) {
    const query = scrollId ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}` : 'search_type=scan&limit=100';
    const page = (await mlGet(token, `/users/${EXPECTED.sellerId}/items/search?${query}`)).data;
    pages += 1;
    if (expectedTotal === null) expectedTotal = Number(page?.paging?.total || 0);
    ids.push(...(page?.results || []).map(String));
    if (!(page?.results || []).length || new Set(ids).size >= expectedTotal || !page.scroll_id || seen.has(page.scroll_id)) break;
    seen.add(page.scroll_id);
    scrollId = page.scroll_id;
  }
  const unique = [...new Set(ids)];
  const items = [];
  const fields = 'body.title,body.status,body.seller_custom_field,body.user_product_id,body.family_id,body.catalog_product_id,body.category_id,body.attributes';
  for (let index = 0; index < unique.length; index += 20) {
    const rows = (await mlGet(token, `/items/bulk?ids=${unique.slice(index, index + 20).join(',')}&attributes=${fields}`)).data;
    for (const row of rows || []) if (Number(row.status_code) === 200 && row.id && row.body) items.push({ ...row.body, id: String(row.id) });
  }
  if (unique.length !== expectedTotal || items.length !== unique.length) throw new Error(`remote_inventory_unreliable:${unique.length}/${expectedTotal}/${items.length}`);
  return { expected_total: expectedTotal, captured: unique.length, detailed: items.length, pages, items };
}

function isEquivalent(item) {
  const checks = {
    sku: normalize(item.seller_custom_field || attributeValue(item, 'SELLER_SKU')) === normalize(EXPECTED.sku),
    gtin: normalize(attributeValue(item, 'GTIN')) === normalize(EXPECTED.gtin),
    catalog: String(item.catalog_product_id || '') === EXPECTED.catalogProductId,
    brand: normalize(attributeValue(item, 'BRAND')) === normalize(EXPECTED.brand),
    model: normalize(attributeValue(item, 'MODEL')).includes(normalize(EXPECTED.model)),
    voltage: normalize(attributeValue(item, 'VOLTAGE')) === normalize(EXPECTED.voltage),
  };
  return { checks, equivalent: checks.sku || checks.gtin || checks.catalog };
}

async function duplicateAudit(token) {
  const inventory = await scanInventory(token);
  const matches = inventory.items.map((item) => ({ item, identity: isEquivalent(item) }))
    .filter((row) => row.identity.equivalent)
    .map((row) => ({ item_id: row.item.id, status: row.item.status, title: row.item.title, ...row.identity }));
  return {
    checked_at: now(),
    inventory: { expected_total: inventory.expected_total, captured: inventory.captured, detailed: inventory.detailed, pages: inventory.pages, reliable: true },
    matches,
    target_present: matches.some((row) => row.item_id === EXPECTED.itemId),
    competing_matches: matches.filter((row) => row.item_id !== EXPECTED.itemId),
  };
}

async function financialValidation(token, item, cost) {
  const feeParams = new URLSearchParams({
    price: Number(item.price).toFixed(2), category_id: item.category_id, listing_type_id: item.listing_type_id,
    currency_id: 'BRL', logistic_type: item.shipping?.logistic_type || 'xd_drop_off', shipping_mode: item.shipping?.mode || 'me2',
  });
  const feeData = (await mlGet(token, `/sites/MLB/listing_prices?${feeParams}`)).data;
  const feeRows = Array.isArray(feeData) ? feeData : [feeData];
  const feeQuote = feeRows.find((row) => row?.listing_type_id === item.listing_type_id) || feeRows[0];
  const commission = Number(feeQuote?.sale_fee_amount);
  if (!Number.isFinite(commission)) throw new Error('commission_quote_missing');

  const shippingParams = new URLSearchParams({
    item_id: EXPECTED.itemId, verbose: 'true', item_price: Number(item.price).toFixed(2),
    listing_type_id: item.listing_type_id, mode: item.shipping?.mode || 'me2', condition: item.condition,
    logistic_type: item.shipping?.logistic_type || 'xd_drop_off', free_shipping: String(item.shipping?.free_shipping === true),
  });
  const shippingData = (await mlGet(token, `/users/${EXPECTED.sellerId}/shipping_options/free?${shippingParams}`)).data;
  const quotedShipping = extractShippingCost(shippingData);
  if (!Number.isFinite(quotedShipping)) throw new Error('shipping_quote_missing');
  const shippingUsed = Math.max(KNOWN_MAX_SHIPPING, quotedShipping);
  const values = financialAt({ price: Number(item.price), fee: commission, shipping: shippingUsed, cost });
  return {
    checked_at: now(), price_mode: 'PROTECTIVE_PRICE', known_max_shipping: KNOWN_MAX_SHIPPING,
    quoted_shipping: quotedShipping, shipping_used: shippingUsed, commission_quote: feeQuote,
    shipping_quote: shippingData, values, target_margin_percent: 50, approved: values.margin_percent + 1e-9 >= 50,
  };
}

function preLocalClassification(local) {
  const product = local.product;
  const exact = (local.item_listings || []).find((row) => row.produto_id === EXPECTED.productId && row.sku === EXPECTED.sku);
  const already = product?.ml_item_id === EXPECTED.itemId && exact
    && local.item_listings.length === 1 && local.product_listings.length === 1 && local.products_pointing_to_item.length === 1;
  if (already) return 'ALREADY_CONSISTENT';
  const clear = product?.id === EXPECTED.productId && product?.sku === EXPECTED.sku
    && !product?.ml_item_id && product?.ml_status === 'sem_anuncio'
    && local.item_listings.length === 0 && local.product_listings.length === 0 && local.products_pointing_to_item.length === 0;
  return clear ? 'CLEAR' : 'CONCURRENT_LINK';
}

async function main() {
  const startedAt = now();
  const db = createDb();
  const integrations = await dbSelect(db, 'integracoes', 'tipo,access_token,conectado', (query) => query.eq('tipo', 'mercadolivre'));
  const integration = integrations[0];
  if (!integration?.conectado || !integration?.access_token) throw new Error('ml_integration_unavailable');
  const account = await assertAllowedMercadoLivreToken(integration.access_token, 'ml-p0-phase5d1');
  if (Number(account.userId) !== EXPECTED.sellerId) throw new Error(`seller_mismatch:${account.userId}`);
  const token = integration.access_token;

  const [products, offers] = await Promise.all([
    dbSelect(db, 'produtos', '*', (query) => query.eq('id', EXPECTED.productId)),
    dbSelect(db, 'produto_fornecedor_ofertas', '*', (query) => query.eq('produto_id', EXPECTED.productId)),
  ]);
  const product = products[0];
  const offer = offers.find((row) => row.id === product?.oferta_preferencial_id) || null;
  const cost = Number(offer?.custo ?? product?.custo);
  if (!product || product.sku !== EXPECTED.sku || normalize(product.gtin) !== normalize(EXPECTED.gtin)) throw new Error('LOCAL_PERSIST_ABORT_IDENTITY_DRIFT:local_product');
  if (Math.abs(cost - EXPECTED.cost) > 0.01) throw new Error(`LOCAL_PERSIST_ABORT_PROTECTIVE_MARGIN:cost_drift:${cost}`);

  const remoteBefore = (await mlGet(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`)).data;
  const identity = validateIdentity(remoteBefore);
  const catalog = {
    catalog_listing: remoteBefore.catalog_listing === true,
    catalog_product_id: remoteBefore.catalog_product_id === EXPECTED.catalogProductId,
  };
  const duplicate = await duplicateAudit(token);
  const financial = await financialValidation(token, remoteBefore, cost);
  const localBefore = psql(localReadbackSql());
  const localState = preLocalClassification(localBefore);

  writeJson('remote-readback.json', { checked_at: now(), item: remoteBefore, identity, catalog, duplicate });
  writeJson('protective-margin-validation.json', financial);
  writeJson('pre-write-product.json', { captured_at: now(), product: localBefore.product });
  writeJson('pre-write-listing-state.json', {
    captured_at: now(), item_listings: localBefore.item_listings, product_listings: localBefore.product_listings,
    products_pointing_to_item: localBefore.products_pointing_to_item, classification: localState,
  });

  let abort = null;
  if (!identity.passed) abort = 'LOCAL_PERSIST_ABORT_IDENTITY_DRIFT';
  else if (!catalog.catalog_listing || !catalog.catalog_product_id) abort = 'LOCAL_PERSIST_ABORT_CATALOG_DRIFT';
  else if (Number(remoteBefore.price) !== EXPECTED.authorizedFloor || Number(remoteBefore.available_quantity) !== EXPECTED.quantity || remoteBefore.status !== 'active') abort = 'LOCAL_PERSIST_ABORT_IDENTITY_DRIFT';
  else if (!duplicate.target_present || duplicate.competing_matches.length) abort = 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK';
  else if (!financial.approved) abort = 'LOCAL_PERSIST_ABORT_PROTECTIVE_MARGIN';
  else if (localState === 'CONCURRENT_LINK') abort = 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK';

  if (abort) {
    const summary = { phase: '5D.1', generated_at: now(), result: abort, sku: EXPECTED.sku, item_id: EXPECTED.itemId, identity, catalog, financial, local_state: localState, writes: { mercado_livre: 0, postgres_transactions: 0 }, quality_optimization_pending: true, commercial_optimization_pending: true, hold: HOLD };
    writeJson('local-persistence.json', { executed: false, result: abort });
    writeJson('local-readback.json', localBefore);
    writeJson('local-remote-diff.json', { fields: [], material_drift: null, reason: abort });
    writeJson('summary.json', summary);
    writeJson('full-report.json', { ...summary, started_at: startedAt, completed_at: now(), remote: remoteBefore, duplicate, local_before: localBefore });
    console.log(JSON.stringify({ event: 'p0_phase5d1_aborted', result: abort, ml_writes: 0 }));
    return;
  }

  metrics.postgres_transactions += 1;
  const transaction = psql(buildTransactionSql(remoteBefore));
  const localAfter = psql(localReadbackSql());
  const remoteAfter = (await mlGet(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`)).data;
  const remoteAfterIdentity = validateIdentity(remoteAfter);
  const reconciliation = compareLocalRemote(localAfter, remoteAfter);
  const finalResult = transaction.result === 'LOCAL_PERSIST_ALREADY_CONSISTENT' && !reconciliation.material_drift
    ? 'LOCAL_PERSIST_ALREADY_CONSISTENT'
    : transaction.result === 'SAFE_PUBLICATION_PERSIST_SUCCESS' && !reconciliation.material_drift
      ? 'SAFE_PUBLICATION_PERSIST_SUCCESS'
      : 'LOCAL_PERSIST_DRIFT';

  writeJson('local-persistence.json', {
    executed: true, result: finalResult, transaction,
    quality_storage: { qualidade: localAfter.item_listings?.[0]?.qualidade ?? null, meaning: 'schema_default_sentinel_not_official_score', qualidade_info: localAfter.item_listings?.[0]?.qualidade_info ?? null },
  });
  writeJson('local-readback.json', localAfter);
  writeJson('local-remote-diff.json', reconciliation);

  const summary = {
    phase: '5D.1', generated_at: now(), result: finalResult,
    identity: { sku: EXPECTED.sku, produto_id: EXPECTED.productId, item_id: EXPECTED.itemId, user_product_id: EXPECTED.userProductId, catalog_product_id: EXPECTED.catalogProductId, valid: remoteAfterIdentity.passed },
    protection: { price_mode: 'PROTECTIVE_PRICE', ...financial.values, shipping_used: financial.shipping_used, status: 'PROTECTIVE_PRICE_OK' },
    persistence: { transaction_id: transaction.transaction_id, listing_id: transaction.listing_id, product_ml_item_id: localAfter.product?.ml_item_id, unique: reconciliation.unique, idempotency: transaction.result },
    reconciliation,
    quality_optimization_pending: true,
    commercial_optimization_pending: true,
    metrics,
    invariants: { mercado_livre_writes: metrics.ml_writes, no_second_sku: metrics.second_sku_actions === 0, no_master_data_update: true },
    hold: HOLD,
  };
  writeJson('summary.json', summary);
  writeJson('full-report.json', {
    ...summary, started_at: startedAt, completed_at: now(), remote_before: remoteBefore, remote_after: remoteAfter,
    duplicate, financial, local_before: localBefore, transaction, local_after: localAfter,
    official_contracts: {
      items: 'https://developers.mercadolivre.com.br/pt_br/itens-e-buscas',
      shipping: 'https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/custos-de-envio',
      fees: 'https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos/comissao-por-vender',
      supabase_postgres: 'https://supabase.com/docs/guides/database/connecting-to-postgres',
    },
  });
  console.log(JSON.stringify({ event: 'p0_phase5d1_complete', result: finalResult, transaction_id: transaction.transaction_id, listing_id: transaction.listing_id, margin: financial.values.margin_percent, ml_writes: 0, quality_requests: 0 }));
}

main().catch((error) => {
  const message = String(error.message || error);
  const result = message.includes('IDENTITY_DRIFT') ? 'LOCAL_PERSIST_ABORT_IDENTITY_DRIFT'
    : message.includes('CATALOG_DRIFT') ? 'LOCAL_PERSIST_ABORT_CATALOG_DRIFT'
      : message.includes('PROTECTIVE_MARGIN') ? 'LOCAL_PERSIST_ABORT_PROTECTIVE_MARGIN'
        : message.includes('CONCURRENT_LINK') ? 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK'
          : message.startsWith('psql_failed') ? 'LOCAL_PERSIST_TRANSACTION_FAILED' : 'LOCAL_PERSIST_TRANSACTION_FAILED';
  const summary = { phase: '5D.1', generated_at: now(), result, error: message, sku: EXPECTED.sku, item_id: EXPECTED.itemId, metrics, quality_optimization_pending: true, commercial_optimization_pending: true, hold: HOLD };
  writeJson('summary.json', summary);
  writeJson('full-report.json', summary);
  for (const name of ['remote-readback.json', 'protective-margin-validation.json', 'pre-write-product.json', 'pre-write-listing-state.json', 'local-persistence.json', 'local-readback.json', 'local-remote-diff.json']) {
    if (!fs.existsSync(path.join(REPORT_DIR, name))) writeJson(name, { result: 'NOT_REACHED', error: message });
  }
  console.error(JSON.stringify({ event: 'p0_phase5d1_failed', result, error: message, ml_writes: metrics.ml_writes }));
  process.exitCode = 1;
});
