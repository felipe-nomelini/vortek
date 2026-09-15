#!/usr/bin/env node

const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  assessCatalogIdentity,
  catalogIdentityFingerprint,
  CATALOG_IDENTITY_RULE_VERSION,
} = require('../src/lib/catalog-identity.ts');
const {
  buildMlItemsBulkPath,
  getMlItemsBulkBody,
} = require('../src/lib/ml/items-bulk.ts');

const EXPECTED_SHA256 = '59cdbbc17ae5d991a036b5fd4e0d584fa791f6747cab871b57424c220bc76d38';
const EXPECTED_ROWS = 1_550;
const EXPECTED_SKUS = 1_549;
const EXPECTED_DUPLICATE_SKU = 'VTK009697';
const EXPECTED_DUPLICATE_ITEMS = ['MLB4907843137', 'MLB7210717968'];
const REQUIRED_HEADERS = [
  'sku',
  'ml_item_id',
  'standard_item_id',
  'catalog_product_id',
  'ml_state',
  'current_price',
  'price_to_win',
  'source_page',
];
const SOURCE_ORIGIN = 'baseline_canonico';
const DB_QUERY_CHUNK = 150;
const ML_ITEM_BATCH = 20;
const ML_CONCURRENCY = 5;
const MIN_TOKEN_TTL_MS = 45 * 60 * 1_000;
const ML_BASE_URL = 'https://api.mercadolibre.com';
const DEFAULT_ALLOWED_ML_USER_IDS = ['3294514937'];
const ARTIFACT_NAMES = [
  '01_catalog_identity_audit.csv',
  '02_conflicts_confirmed.csv',
  '03_pending_validation.csv',
  '04_ml_state_anomalies.csv',
  '05_corrected_relations.csv',
  '06_buy_box_economic_conflicts.csv',
  '07_buy_box_attackable_after_cleanup.csv',
  '08_execution_errors.csv',
  '09_before_after_summary.md',
  '10_rollback_manifest.json',
];

const CSV_COLUMNS = [
  'sku', 'produto_id', 'ml_item_id', 'standard_item_id', 'catalog_product_id', 'pricing_group_id',
  'identity_state_before', 'identity_state_after', 'conflict_type', 'evidence', 'comparisons',
  'action', 'action_result', 'old_relation', 'new_relation', 'old_price', 'new_price',
  'pricing_source', 'rule_id', 'job_id', 'actor', 'started_at', 'finished_at', 'ml_readback',
  'error', 'error_type', 'risk_tier', 'gap_pct', 'reason_code', 'source_origin', 'source_page',
  'baseline_ml_state', 'live_ml_state', 'baseline_current_price', 'live_current_price',
  'baseline_price_to_win', 'live_price_to_win', 'local_product', 'local_listing', 'catalog_snapshot',
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
}

function stableJson(value, spacing = 0) {
  return JSON.stringify(stableValue(value), null, spacing);
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (character === '\r' || character === '\n')) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('canonical_csv_unclosed_quote');
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function parseBrl(value, field, rowNumber, nullable = false) {
  const source = String(value || '').trim();
  if (!source && nullable) return null;
  if (!source || !/^(?:0|[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*)(?:,\d{1,2})?$/.test(source)) {
    throw new Error(`canonical_${field}_invalid:${rowNumber}`);
  }
  const result = Number(source.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(result) || result <= 0) throw new Error(`canonical_${field}_invalid:${rowNumber}`);
  return Number(result.toFixed(2));
}

function parseCanonicalCsv(buffer) {
  const digest = sha256(buffer);
  if (digest !== EXPECTED_SHA256) throw new Error(`canonical_sha256_mismatch:${digest}`);
  const source = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const table = parseCsv(source);
  if (!table.length || stableJson(table[0]) !== stableJson(REQUIRED_HEADERS)) {
    throw new Error('canonical_headers_invalid');
  }
  const rows = table.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== REQUIRED_HEADERS.length) throw new Error(`canonical_column_count_invalid:${rowNumber}`);
    const raw = Object.fromEntries(REQUIRED_HEADERS.map((header, column) => [header, String(values[column] || '').trim()]));
    const sku = raw.sku.toUpperCase();
    const mlItemId = raw.ml_item_id.toUpperCase();
    const standardItemId = raw.standard_item_id ? raw.standard_item_id.toUpperCase() : null;
    const catalogProductId = raw.catalog_product_id.toUpperCase();
    if (!sku) throw new Error(`canonical_sku_missing:${rowNumber}`);
    if (!/^MLB\d+$/.test(mlItemId)) throw new Error(`canonical_ml_item_id_invalid:${rowNumber}`);
    if (standardItemId && !/^MLB\d+$/.test(standardItemId)) throw new Error(`canonical_standard_item_id_invalid:${rowNumber}`);
    if (!/^MLB\d+$/.test(catalogProductId)) throw new Error(`canonical_catalog_product_id_invalid:${rowNumber}`);
    if (!['winning', 'sharing_first_place', 'competing', 'listed', 'não informado'].includes(raw.ml_state)) {
      throw new Error(`canonical_ml_state_invalid:${rowNumber}`);
    }
    const sourcePage = Number(raw.source_page);
    if (!Number.isInteger(sourcePage) || sourcePage <= 0) throw new Error(`canonical_source_page_invalid:${rowNumber}`);
    return {
      ordinal: index,
      sku,
      ml_item_id: mlItemId,
      standard_item_id: standardItemId,
      catalog_product_id: catalogProductId,
      ml_state: raw.ml_state,
      current_price: parseBrl(raw.current_price, 'current_price', rowNumber),
      price_to_win: parseBrl(raw.price_to_win, 'price_to_win', rowNumber, true),
      source_page: sourcePage,
      input_row: raw,
    };
  });
  if (rows.length !== EXPECTED_ROWS) throw new Error(`canonical_row_count_invalid:${rows.length}`);
  if (new Set(rows.map((row) => row.ml_item_id)).size !== EXPECTED_ROWS) throw new Error('canonical_ml_item_id_not_unique');
  const skuGroups = Map.groupBy(rows, (row) => row.sku);
  if (skuGroups.size !== EXPECTED_SKUS) throw new Error(`canonical_sku_count_invalid:${skuGroups.size}`);
  const duplicates = [...skuGroups.entries()].filter(([, entries]) => entries.length > 1);
  if (duplicates.length !== 1 || duplicates[0][0] !== EXPECTED_DUPLICATE_SKU
    || stableJson(duplicates[0][1].map((row) => row.ml_item_id).sort()) !== stableJson(EXPECTED_DUPLICATE_ITEMS)) {
    throw new Error('canonical_duplicate_sku_invalid');
  }
  return { rows, sha256: digest };
}

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function mapLimit(values, concurrency, worker) {
  const results = new Array(values.length);
  let next = 0;
  async function run() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

function getRequestMethod(input, init) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
}

function createReadOnlyFetchTracker(fetchImpl = global.fetch) {
  const stats = { get: 0, head: 0, blocked_mutation_attempts: 0 };
  const readonlyFetch = async (input, init) => {
    const method = getRequestMethod(input, init);
    if (!['GET', 'HEAD'].includes(method)) {
      stats.blocked_mutation_attempts += 1;
      throw new Error(`readonly_http_method_blocked:${method}`);
    }
    stats[method.toLowerCase()] += 1;
    return fetchImpl(input, { ...init, method });
  };
  return { readonlyFetch, stats };
}

async function assertProductionDatabaseTarget(serviceUrl) {
  const parsed = new URL(serviceUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('supabase_protocol_invalid');
  if (parsed.hostname === '192.168.1.160') throw new Error('legacy_supabase_target_forbidden');
  if (parsed.hostname === '192.168.1.162') return { configured_host: parsed.hostname, resolved_addresses: [parsed.hostname] };
  if (parsed.hostname !== 'supabase.bentevi.shop') throw new Error(`supabase_target_not_production:${parsed.hostname}`);
  const resolved = await dns.lookup(parsed.hostname, { all: true });
  const addresses = [...new Set(resolved.map((entry) => entry.address))];
  if (!addresses.includes('192.168.1.162')) throw new Error(`supabase_target_resolution_invalid:${addresses.join(',')}`);
  return { configured_host: parsed.hostname, resolved_addresses: addresses };
}

async function fetchRowsByValues(client, table, select, column, values) {
  const result = [];
  for (const batch of chunks([...new Set(values.filter(Boolean))], DB_QUERY_CHUNK)) {
    const response = await client.from(table).select(select).in(column, batch);
    if (response.error) throw new Error(`readonly_${table}_query_failed:${response.error.code || 'unknown'}`);
    result.push(...(response.data || []));
  }
  return result;
}

async function countTable(client, table) {
  const response = await client.from(table).select('*', { count: 'exact', head: true });
  if (response.error) throw new Error(`readonly_${table}_count_failed:${response.error.code || 'unknown'}`);
  return Number(response.count || 0);
}

async function loadLedgerCounts(client) {
  const names = ['ml_catalog_identity_runs', 'ml_catalog_identity_audits', 'ml_catalog_identity_current', 'ml_catalog_identity_actions'];
  const values = await Promise.all(names.map(async (name) => [name, await countTable(client, name)]));
  return Object.fromEntries(values);
}

async function loadDatabaseSnapshot(client, baselineRows) {
  const itemIds = baselineRows.map((row) => row.ml_item_id);
  const [listings, snapshots, pricingMembers] = await Promise.all([
    fetchRowsByValues(client, 'anuncios_ml',
      'ml_item_id,produto_id,sku,titulo,tipo,preco_ml,status,catalogo,qualidade,qualidade_info,updated_at',
      'ml_item_id', itemIds),
    fetchRowsByValues(client, 'catalogo_ml_snapshot',
      'ml_item_id,seller_id,produto_id,sku_local,seller_sku,related_item_id,catalog_product_id,buy_box_status,buy_box_winning,price,price_to_win,status,title,synced_at,last_updated_ml',
      'ml_item_id', itemIds),
    fetchRowsByValues(client, 'ml_pricing_group_members', 'ml_item_id,group_id,is_current', 'ml_item_id', itemIds),
  ]);
  const listingById = new Map(listings.map((row) => [String(row.ml_item_id), row]));
  const snapshotById = new Map(snapshots.map((row) => [String(row.ml_item_id), row]));
  const relatedIds = [...new Set(baselineRows.flatMap((row) => [row.standard_item_id, snapshotById.get(row.ml_item_id)?.related_item_id]).filter(Boolean))];
  const relatedListings = await fetchRowsByValues(client, 'anuncios_ml',
    'ml_item_id,produto_id,sku,titulo,tipo,preco_ml,status,catalogo,qualidade,qualidade_info,updated_at',
    'ml_item_id', relatedIds);
  const relatedListingById = new Map(relatedListings.map((row) => [String(row.ml_item_id), row]));
  const productIds = [...new Set([...listings, ...snapshots, ...relatedListings].map((row) => row.produto_id).filter(Boolean))];
  const fallbackSkus = baselineRows.filter((row) => !listingById.get(row.ml_item_id)?.produto_id).map((row) => row.sku);
  const productSelect = 'id,sku,nome,descricao,marca,gtin,custo,estoque,custom_price,fornecedor,dslite_fornecedor_id,dslite_produto_id,ativo,ncm,oferta_preferencial_id,updated_at';
  const [productsByIdRows, productsBySkuRows] = await Promise.all([
    fetchRowsByValues(client, 'produtos', productSelect, 'id', productIds),
    fetchRowsByValues(client, 'produtos', productSelect, 'sku', fallbackSkus),
  ]);
  const productById = new Map(productsByIdRows.map((row) => [String(row.id), row]));
  const productsBySku = Map.groupBy(productsBySkuRows, (row) => String(row.sku || '').trim().toUpperCase());
  const groupByItemId = new Map(pricingMembers.filter((row) => row.is_current)
    .map((row) => [String(row.ml_item_id), String(row.group_id)]));
  return {
    listings,
    listingById,
    snapshots,
    snapshotById,
    relatedListings,
    relatedListingById,
    productsByIdRows,
    productById,
    productsBySku,
    groupByItemId,
  };
}

function operationalProjection(databaseSnapshot) {
  return {
    listings: databaseSnapshot.listings.map((row) => ({
      ml_item_id: row.ml_item_id,
      produto_id: row.produto_id,
      sku: row.sku,
      preco_ml: row.preco_ml,
    })).sort((left, right) => left.ml_item_id.localeCompare(right.ml_item_id)),
    products: databaseSnapshot.productsByIdRows.map((row) => ({
      id: row.id,
      sku: row.sku,
      ativo: row.ativo,
      custom_price: row.custom_price,
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function compareOperationalProjection(before, after) {
  const beforeListings = new Map(before.listings.map((row) => [row.ml_item_id, row]));
  const beforeProducts = new Map(before.products.map((row) => [row.id, row]));
  const listingRelationChanges = after.listings.filter((row) => {
    const previous = beforeListings.get(row.ml_item_id);
    return !previous || previous.produto_id !== row.produto_id || previous.sku !== row.sku;
  });
  const listingObservedPriceChanges = after.listings.filter((row) => beforeListings.get(row.ml_item_id)?.preco_ml !== row.preco_ml);
  const productActiveChanges = after.products.filter((row) => beforeProducts.get(row.id)?.ativo !== row.ativo);
  const productCustomPriceChanges = after.products.filter((row) => beforeProducts.get(row.id)?.custom_price !== row.custom_price);
  return {
    listing_relation_changes: listingRelationChanges.length,
    listing_observed_price_changes: listingObservedPriceChanges.length,
    produtos_ativo_changes: productActiveChanges.length,
    produtos_custom_price_changes: productCustomPriceChanges.length,
  };
}

function allowedMlUserIds() {
  const configured = process.env.ML_ALLOWED_USER_IDS;
  return configured === undefined
    ? DEFAULT_ALLOWED_ML_USER_IDS
    : configured.split(',').map((value) => value.trim()).filter(Boolean);
}

async function loadReadOnlyMlToken(client) {
  const response = await client.from('integracoes').select('access_token,token_expires_at,conectado')
    .eq('tipo', 'mercadolivre').maybeSingle();
  if (response.error) throw new Error(`readonly_ml_integration_query_failed:${response.error.code || 'unknown'}`);
  const token = String(response.data?.access_token || '');
  const expiresAt = response.data?.token_expires_at ? new Date(response.data.token_expires_at).getTime() : 0;
  const ttlMs = expiresAt - Date.now();
  if (!response.data?.conectado || !token || !Number.isFinite(expiresAt)) throw new Error('readonly_ml_token_unavailable');
  if (ttlMs < MIN_TOKEN_TTL_MS) throw new Error(`readonly_ml_token_ttl_insufficient:${Math.floor(ttlMs / 60_000)}`);
  return { token, token_expires_at: new Date(expiresAt).toISOString(), ttl_minutes_at_start: Math.floor(ttlMs / 60_000) };
}

function safeMlError(body, status) {
  return {
    status,
    code: String(body?.code || body?.error || `http_${status}`).slice(0, 120),
    message: String(body?.message || body?.error_description || `Mercado Livre HTTP ${status}`).slice(0, 300),
  };
}

function createMlReadOnlyClient(token, fetchTracker) {
  const request = async (endpoint) => {
    const url = new URL(endpoint, ML_BASE_URL);
    if (url.origin !== ML_BASE_URL) throw new Error('readonly_ml_origin_forbidden');
    let last = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response;
      try {
        response = await fetchTracker.readonlyFetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
      } catch (error) {
        last = { ok: false, status: null, data: null, error: { status: null, code: 'network_error', message: String(error?.message || error) }, category: 'transport' };
        if (attempt === 3) return last;
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** attempt)));
        continue;
      }
      const body = await response.json().catch(() => null);
      if (response.ok) return { ok: true, status: response.status, data: body, error: null, category: null };
      const error = safeMlError(body, response.status);
      if (response.status === 401 || response.status === 403) return { ok: false, status: response.status, data: null, error, category: 'auth_fatal' };
      if (response.status === 429 || response.status >= 500) {
        last = { ok: false, status: response.status, data: null, error, category: 'retryable' };
        if (attempt === 3) return last;
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1_000, 10_000) : 1_000 * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      return { ok: false, status: response.status, data: null, error, category: 'expected_operational' };
    }
    return last;
  };
  return { request };
}

function sanitizeMlEntity(entity) {
  if (!entity || typeof entity !== 'object') return null;
  return {
    id: entity.id || null,
    name: entity.name || null,
    title: entity.title || null,
    seller_id: entity.seller_id || null,
    status: entity.status || null,
    catalog_listing: entity.catalog_listing ?? null,
    catalog_product_id: entity.catalog_product_id || null,
    category_id: entity.category_id || null,
    domain_id: entity.domain_id || null,
    seller_custom_field: entity.seller_custom_field || null,
    item_relations: entity.item_relations || [],
    attributes: Array.isArray(entity.attributes) ? entity.attributes.map((attribute) => ({
      id: attribute.id || null,
      name: attribute.name || null,
      value_id: attribute.value_id || null,
      value_name: attribute.value_name || null,
      values: attribute.values || [],
    })) : [],
    price: entity.price ?? null,
    last_updated: entity.last_updated || null,
  };
}

async function loadLiveMlUniverse(ml, baselineRows, onProgress = () => {}) {
  const itemById = new Map();
  const technicalErrors = [];
  const batches = chunks(baselineRows, ML_ITEM_BATCH);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const endpoint = buildMlItemsBulkPath(batch.map((row) => row.ml_item_id), [
      'seller_id', 'title', 'status', 'price', 'catalog_listing', 'catalog_product_id', 'category_id',
      'domain_id', 'item_relations', 'attributes', 'seller_custom_field', 'last_updated',
    ]);
    const result = await ml.request(endpoint);
    if (!result.ok && result.category === 'auth_fatal') throw new Error('ML_AUTHENTICATION_FAILURE');
    if (!result.ok) {
      technicalErrors.push(...batch.map((row) => ({ ml_item_id: row.ml_item_id, endpoint: 'items_bulk', ...result.error })));
    } else if (Array.isArray(result.data)) {
      for (const entry of result.data) {
        const item = getMlItemsBulkBody(entry);
        if (item) itemById.set(item.id, item);
        else technicalErrors.push({ ml_item_id: String(entry?.id || ''), endpoint: 'items_bulk', status: entry?.status_code || null,
          code: `item_status_${entry?.status_code || 'unknown'}`, message: 'Item não retornado com status individual 200.' });
      }
    } else {
      technicalErrors.push(...batch.map((row) => ({ ml_item_id: row.ml_item_id, endpoint: 'items_bulk', status: result.status,
        code: 'items_bulk_contract_invalid', message: 'Resposta bulk não é uma lista.' })));
    }
    const batchTechnical = technicalErrors.filter((entry) => batch.some((row) => row.ml_item_id === entry.ml_item_id)
      && (['network_error', 'items_bulk_contract_invalid'].includes(entry.code)
        || entry.status === 429 || entry.status >= 500));
    if (batchTechnical.length / batch.length > 0.05) throw new Error(`ML_ERROR_RATE_EXCEEDED:items_batch_${batchIndex + 1}`);
    onProgress({ stage: 'items', current: batchIndex + 1, total: batches.length });
  }

  const relatedIds = [...new Set(baselineRows.flatMap((row) => {
    const item = itemById.get(row.ml_item_id);
    return [row.standard_item_id, ...(Array.isArray(item?.item_relations) ? item.item_relations.map((relation) => relation?.id) : [])];
  }).filter(Boolean))];
  const relatedById = new Map();
  const relatedBatches = chunks(relatedIds, ML_ITEM_BATCH);
  for (let batchIndex = 0; batchIndex < relatedBatches.length; batchIndex += 1) {
    const ids = relatedBatches[batchIndex];
    const result = await ml.request(buildMlItemsBulkPath(ids, [
      'seller_id', 'title', 'status', 'catalog_listing', 'catalog_product_id', 'category_id',
      'domain_id', 'item_relations', 'attributes', 'seller_custom_field', 'last_updated',
    ]));
    if (!result.ok && result.category === 'auth_fatal') throw new Error('ML_AUTHENTICATION_FAILURE');
    if (result.ok && Array.isArray(result.data)) {
      for (const entry of result.data) {
        const item = getMlItemsBulkBody(entry);
        if (item) relatedById.set(item.id, item);
      }
    }
    onProgress({ stage: 'related_items', current: batchIndex + 1, total: relatedBatches.length });
  }

  const catalogProductIds = [...new Set(baselineRows.flatMap((row) => [
    row.catalog_product_id,
    itemById.get(row.ml_item_id)?.catalog_product_id,
  ]).filter(Boolean))];
  const catalogById = new Map();
  const catalogBatches = chunks(catalogProductIds, ML_ITEM_BATCH);
  for (let batchIndex = 0; batchIndex < catalogBatches.length; batchIndex += 1) {
    const batch = catalogBatches[batchIndex];
    const results = await mapLimit(batch, ML_CONCURRENCY, async (catalogProductId) => ({
      catalogProductId,
      result: await ml.request(`/products/${encodeURIComponent(catalogProductId)}`),
    }));
    let fatal = false;
    let technical = 0;
    for (const entry of results) {
      catalogById.set(entry.catalogProductId, entry.result);
      if (entry.result.category === 'auth_fatal') fatal = true;
      if (['transport', 'retryable'].includes(entry.result.category)) technical += 1;
    }
    if (fatal) throw new Error('ML_AUTHENTICATION_FAILURE');
    if (technical / batch.length > 0.05) throw new Error(`ML_ERROR_RATE_EXCEEDED:catalog_batch_${batchIndex + 1}`);
    onProgress({ stage: 'catalog_products', current: batchIndex + 1, total: catalogBatches.length });
  }

  const competitionById = new Map();
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const results = await mapLimit(batch, ML_CONCURRENCY, async (row) => ({
      ml_item_id: row.ml_item_id,
      result: await ml.request(`/items/${encodeURIComponent(row.ml_item_id)}/price_to_win?version=v2`),
    }));
    let fatal = false;
    let technical = 0;
    for (const entry of results) {
      competitionById.set(entry.ml_item_id, entry.result);
      if (entry.result.category === 'auth_fatal') fatal = true;
      if (['transport', 'retryable'].includes(entry.result.category)) technical += 1;
    }
    if (fatal) throw new Error('ML_AUTHENTICATION_FAILURE');
    if (technical / batch.length > 0.05) throw new Error(`ML_ERROR_RATE_EXCEEDED:competition_batch_${batchIndex + 1}`);
    onProgress({ stage: 'competition', current: batchIndex + 1, total: batches.length });
  }
  return { itemById, relatedById, catalogById, competitionById, technicalErrors };
}

function sameIdentifier(left, right) {
  return String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
}

function materialStateOverrides(base, context) {
  const comparisons = [...base.comparisons];
  const add = (field, local, remote, status, reason) => comparisons.push({
    field, local: local || null, remote: remote || null, status, reason,
  });
  if (context.localListing && !sameIdentifier(context.baseline.sku, context.localListing.sku)) {
    add('BASELINE_SKU', context.baseline.sku, context.localListing.sku, 'conflict', 'BASELINE_SKU_DIVERGENTE');
  }
  if (context.snapshot && !sameIdentifier(context.baseline.catalog_product_id, context.snapshot.catalog_product_id)) {
    add('BASELINE_CATALOG_PRODUCT_ID', context.baseline.catalog_product_id, context.snapshot.catalog_product_id,
      'conflict', 'BASELINE_CATALOG_PRODUCT_ID_DIVERGENTE');
  }
  if (context.item && !sameIdentifier(context.baseline.catalog_product_id, context.item.catalog_product_id)) {
    add('LIVE_CATALOG_PRODUCT_ID', context.baseline.catalog_product_id, context.item.catalog_product_id,
      'conflict', 'LIVE_CATALOG_PRODUCT_ID_DIVERGENTE');
  }
  const observedRelated = context.item?.item_relations?.[0]?.id || context.snapshot?.related_item_id || null;
  if (context.baseline.standard_item_id && !sameIdentifier(context.baseline.standard_item_id, observedRelated)) {
    add('STANDARD_ITEM_ID', context.baseline.standard_item_id, observedRelated, 'conflict', 'STANDARD_ITEM_ID_DIVERGENTE');
  }
  const relationEvidenceConflict = comparisons.some((row) => [
    'BASELINE_SKU', 'BASELINE_CATALOG_PRODUCT_ID', 'LIVE_CATALOG_PRODUCT_ID', 'STANDARD_ITEM_ID',
  ].includes(row.field) && row.status === 'conflict');
  if (base.identityState === 'SEM_CONFLITO' && relationEvidenceConflict) {
    return {
      ...base,
      identityState: 'PENDENCIA_VALIDACAO',
      reasonCode: 'RELACAO_BASELINE_VIVA_DIVERGENTE',
      blockPriceWrite: true,
      blockBuyBoxChase: true,
      comparisons,
    };
  }
  return { ...base, comparisons };
}

function classifyUniverse(baselineRows, database, live, startedAt) {
  const rows = [];
  for (const baseline of baselineRows) {
    const localListing = database.listingById.get(baseline.ml_item_id) || null;
    const snapshot = database.snapshotById.get(baseline.ml_item_id) || null;
    const directProductId = localListing?.produto_id || null;
    let localProduct = directProductId ? database.productById.get(String(directProductId)) || null : null;
    let fallbackError = null;
    if (!directProductId) {
      const candidates = database.productsBySku.get(baseline.sku) || [];
      if (candidates.length === 1) localProduct = candidates[0];
      else fallbackError = candidates.length ? 'sku_fallback_ambiguous' : 'sku_fallback_not_found';
    }
    const item = live.itemById.get(baseline.ml_item_id) || null;
    const liveCatalogProductId = String(item?.catalog_product_id || snapshot?.catalog_product_id || baseline.catalog_product_id || '');
    const catalogResult = live.catalogById.get(liveCatalogProductId) || { ok: false, data: null, error: { code: 'catalog_product_unavailable' }, category: 'expected_operational' };
    const competitionResult = live.competitionById.get(baseline.ml_item_id) || { ok: false, data: null, error: { code: 'competition_unavailable' }, category: 'expected_operational' };
    const competitionStatus = String(competitionResult.data?.status || competitionResult.data?.buy_box_status || '').trim();
    const liveAvailable = Boolean(item && liveCatalogProductId && catalogResult.ok && competitionResult.ok && competitionStatus);
    const observedRelatedId = String(item?.item_relations?.[0]?.id || snapshot?.related_item_id || baseline.standard_item_id || '');
    const relatedLocal = database.relatedListingById.get(observedRelatedId) || null;
    const relatedLive = live.relatedById.get(observedRelatedId) || null;
    const owners = [...new Set([
      localListing?.produto_id,
      snapshot?.produto_id,
      relatedLocal?.produto_id,
    ].filter(Boolean))];
    const currentPrice = competitionResult.data?.current_price ?? item?.price ?? snapshot?.price ?? baseline.current_price;
    const priceToWin = competitionResult.data?.price_to_win ?? null;
    let assessment = assessCatalogIdentity({
      item,
      catalogProduct: catalogResult.data,
      localProduct,
      relatedListing: relatedLocal || relatedLive || localListing,
      localOwners: owners,
      priceToWin,
      currentPrice,
      liveAvailable,
    });
    assessment = materialStateOverrides(assessment, { baseline, localListing, snapshot, item });
    const errorParts = [
      fallbackError,
      item ? null : 'ml_item_unavailable',
      catalogResult.ok ? null : catalogResult.error?.code || 'catalog_product_unavailable',
      competitionResult.ok ? null : competitionResult.error?.code || 'competition_unavailable',
      competitionStatus ? null : 'competition_state_unavailable',
    ].filter(Boolean);
    const errorType = errorParts.length
      ? (['transport', 'retryable', 'auth_fatal'].includes(catalogResult.category)
        || ['transport', 'retryable', 'auth_fatal'].includes(competitionResult.category) ? 'API_ERROR' : 'SOURCE_UNAVAILABLE')
      : null;
    const action = assessment.identityState === 'SEM_CONFLITO' ? 'NO_ACTION_CANDIDATE'
      : assessment.identityState === 'CONFLITO_CONFIRMADO' ? 'REVIEW_OR_REMOVE_INCORRECT_CATALOG_RELATION'
        : assessment.identityState === 'INCONCLUSIVO' ? 'REFRESH_OR_MANUAL_REVIEW' : 'MANUAL_REVIEW';
    const actionResult = assessment.identityState === 'SEM_CONFLITO' ? 'NO_CHANGE' : 'REQUIRES_CONFIRMATION';
    const finishedAt = new Date().toISOString();
    const oldRelation = {
      produto_id: localListing?.produto_id || null,
      sku: localListing?.sku || null,
      standard_item_id: observedRelatedId || null,
      catalog_product_id: liveCatalogProductId || null,
    };
    const evidence = {
      baseline,
      local_listing: localListing,
      related_local_listing: relatedLocal,
      catalog_snapshot: snapshot,
      ml_item: sanitizeMlEntity(item),
      ml_related_item: sanitizeMlEntity(relatedLive),
      ml_catalog_product: sanitizeMlEntity(catalogResult.data),
      ml_competition: competitionResult.ok ? competitionResult.data : null,
      ml_failures: {
        catalog_product: catalogResult.ok ? null : catalogResult.error,
        competition: competitionResult.ok ? null : competitionResult.error,
      },
    };
    rows.push({
      sku: baseline.sku,
      produto_id: localProduct?.id || directProductId || null,
      ml_item_id: baseline.ml_item_id,
      standard_item_id: observedRelatedId || null,
      catalog_product_id: liveCatalogProductId || null,
      pricing_group_id: database.groupByItemId.get(baseline.ml_item_id) || null,
      identity_state_before: 'NAO_CLASSIFICADO',
      identity_state_after: assessment.identityState,
      conflict_type: assessment.conflictType,
      evidence,
      comparisons: assessment.comparisons,
      action,
      action_result: actionResult,
      old_relation: oldRelation,
      new_relation: {},
      old_price: Number(currentPrice) || null,
      new_price: Number(currentPrice) || null,
      pricing_source: 'mercado_livre_readonly',
      rule_id: 'BNT-ML-CATALOG-IDENTITY-01',
      job_id: null,
      actor: 'oraculo_readonly',
      started_at: startedAt,
      finished_at: finishedAt,
      ml_readback: item ? {
        item_id: item.id,
        seller_id: item.seller_id || null,
        catalog_product_id: item.catalog_product_id || null,
        status: item.status || null,
        competition_status: competitionStatus || null,
        current_price: currentPrice == null ? null : Number(currentPrice),
        price_to_win: priceToWin == null ? null : Number(priceToWin),
        observed_at: finishedAt,
      } : null,
      error: errorParts.join(',') || null,
      error_type: errorType,
      risk_tier: assessment.riskTier,
      gap_pct: assessment.gapPct,
      reason_code: assessment.reasonCode,
      source_origin: SOURCE_ORIGIN,
      source_page: baseline.source_page,
      baseline_ml_state: baseline.ml_state,
      live_ml_state: competitionStatus || null,
      baseline_current_price: baseline.current_price,
      live_current_price: currentPrice == null ? null : Number(currentPrice),
      baseline_price_to_win: baseline.price_to_win,
      live_price_to_win: priceToWin == null ? null : Number(priceToWin),
      local_product: localProduct,
      local_listing: localListing,
      catalog_snapshot: snapshot,
      material_fingerprint: catalogIdentityFingerprint({ evidence, comparisons: assessment.comparisons,
        identity_state: assessment.identityState, action, old_relation: oldRelation }),
      ordinal: baseline.ordinal,
    });
  }
  return rows.sort((left, right) => left.ordinal - right.ordinal);
}

function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? stableJson(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvContent(rows) {
  return `\uFEFF${[CSV_COLUMNS.map(csvCell).join(','), ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(','))].join('\r\n')}\r\n`;
}

function countBy(rows, key) {
  const result = {};
  for (const row of rows) result[row[key] || '<null>'] = (result[row[key] || '<null>'] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function stateTransitions(rows) {
  const result = {};
  for (const row of rows) {
    const key = `${row.baseline_ml_state} -> ${row.live_ml_state || 'não informado'}`;
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function changedMoney(rows, baselineField, liveField) {
  return rows.filter((row) => {
    if (row[baselineField] == null && row[liveField] == null) return false;
    if (row[baselineField] == null || row[liveField] == null) return true;
    return Math.abs(Number(row[baselineField]) - Number(row[liveField])) > 0.005;
  }).length;
}

function createSummaryMarkdown(context) {
  const { runId, source, rows, startedAt, finishedAt, databaseCoverage, invariants, readonlyStats, ledgerCountsBefore, ledgerCountsAfter } = context;
  const identity = countBy(rows, 'identity_state_after');
  const transitions = stateTransitions(rows);
  const lines = [
    '# Saneamento de identidade do catálogo Mercado Livre — dry-run P0', '',
    `- Execução: \`${runId}\``,
    `- Regra: \`${CATALOG_IDENTITY_RULE_VERSION}\``,
    `- Início: ${startedAt}`,
    `- Fim: ${finishedAt}`,
    `- SHA-256 da fonte: \`${source.sha256}\``,
    `- Total analisado: ${rows.length}`,
    `- SKUs distintos: ${new Set(rows.map((row) => row.sku)).size}`,
    `- Conflitos confirmados: ${identity.CONFLITO_CONFIRMADO || 0}`,
    `- Pendências de validação: ${identity.PENDENCIA_VALIDACAO || 0}`,
    `- Estados inconclusivos: ${identity.INCONCLUSIVO || 0}`,
    `- Candidatos liberáveis após aprovação/saneamento: ${identity.SEM_CONFLITO || 0}`,
    '- Anúncios efetivamente liberados para pricing nesta etapa: 0',
    `- Anúncios bloqueados para pricing nesta etapa: ${rows.length}`,
    `- Falhas/indisponibilidades registradas: ${rows.filter((row) => row.error).length}`,
    '- Conflitos corrigidos: 0',
    '- Alterações efetivas de vínculo: 0',
    '- Alterações de preço executadas: 0',
    `- Alterações observadas em produtos.ativo durante a janela: ${invariants.produtos_ativo_changes}`,
    `- Alterações observadas em produtos.custom_price durante a janela: ${invariants.produtos_custom_price_changes}`,
    `- Alterações observadas nos vínculos de anúncios durante a janela: ${invariants.listing_relation_changes}`,
    `- Atualizações observacionais de anuncios_ml.preco_ml durante a janela: ${invariants.listing_observed_price_changes}`, '',
    '## Cobertura do join local', '',
    `- anuncios_ml encontrados por ml_item_id: ${databaseCoverage.listings}`,
    `- catalogo_ml_snapshot encontrados por ml_item_id: ${databaseCoverage.snapshots}`,
    `- produtos resolvidos pelo produto_id do anúncio: ${databaseCoverage.direct_products}`,
    `- produtos resolvidos por fallback de SKU: ${databaseCoverage.fallback_products}`,
    `- itens sem produto local resolvido: ${databaseCoverage.unresolved_products}`, '',
    '## Classificação por identidade', '',
    ...Object.entries(identity).map(([state, total]) => `- ${state}: ${total}`), '',
    '## Mudanças de estado desde o relatório', '',
    ...Object.entries(transitions).map(([transition, total]) => `- ${transition}: ${total}`), '',
    `- Preço atual divergente do relatório: ${changedMoney(rows, 'baseline_current_price', 'live_current_price')}`,
    `- price_to_win divergente do relatório: ${changedMoney(rows, 'baseline_price_to_win', 'live_price_to_win')}`, '',
    '## Garantias de não mutação', '',
    '- Supabase e Mercado Livre foram acessados somente por GET/HEAD.',
    `- Requisições GET/HEAD: ${readonlyStats.get}/${readonlyStats.head}.`,
    `- Tentativas de método mutante bloqueadas: ${readonlyStats.blocked_mutation_attempts}.`,
    `- Contagens do ledger antes: \`${stableJson(ledgerCountsBefore)}\`.`,
    `- Contagens do ledger depois: \`${stableJson(ledgerCountsAfter)}\`.`,
    '- Nenhum job, run, auditoria ou projeção de pricing foi persistido.',
    '- Esta missão não executou repricing, correção de vínculo, alteração de estoque ou mudança no Mercado Livre.', '',
    'Os arquivos 05, 06 e 07 contêm somente cabeçalho: correções e filas econômicas dependem de aprovação posterior.', '',
  ];
  return lines.join('\n');
}

function ensureNewOutputDirectory(outputPath) {
  const resolved = path.resolve(outputPath);
  if (fs.existsSync(resolved)) throw new Error(`output_directory_already_exists:${resolved}`);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writeArtifacts(outputDirectory, rows, context) {
  const selections = {
    '01_catalog_identity_audit.csv': rows,
    '02_conflicts_confirmed.csv': rows.filter((row) => row.identity_state_after === 'CONFLITO_CONFIRMADO'),
    '03_pending_validation.csv': rows.filter((row) => ['PENDENCIA_VALIDACAO', 'INCONCLUSIVO'].includes(row.identity_state_after)),
    '04_ml_state_anomalies.csv': rows.filter((row) => !row.live_ml_state || ['listed', 'not_listed'].includes(row.live_ml_state)),
    '05_corrected_relations.csv': [],
    '06_buy_box_economic_conflicts.csv': [],
    '07_buy_box_attackable_after_cleanup.csv': [],
    '08_execution_errors.csv': rows.filter((row) => Boolean(row.error)),
  };
  const artifacts = {};
  for (const [name, selected] of Object.entries(selections)) {
    const content = csvContent(selected);
    fs.writeFileSync(path.join(outputDirectory, name), content, { flag: 'wx' });
    artifacts[name] = { rows: selected.length, sha256: sha256(content) };
  }
  const summary = createSummaryMarkdown({ ...context, rows });
  fs.writeFileSync(path.join(outputDirectory, '09_before_after_summary.md'), summary, { flag: 'wx' });
  artifacts['09_before_after_summary.md'] = { rows: null, sha256: sha256(summary) };
  const manifestPayload = {
    run_id: context.runId,
    rule_version: CATALOG_IDENTITY_RULE_VERSION,
    generated_at: context.finishedAt,
    source: {
      filename: path.basename(context.inputPath),
      sha256: context.source.sha256,
      rows: rows.length,
      distinct_skus: new Set(rows.map((row) => row.sku)).size,
      distinct_ml_item_ids: new Set(rows.map((row) => row.ml_item_id)).size,
    },
    database_target: context.databaseTarget,
    ml_token: { token_expires_at: context.mlToken.token_expires_at, ttl_minutes_at_start: context.mlToken.ttl_minutes_at_start },
    snapshot_window: { started_at: context.startedAt, finished_at: context.finishedAt },
    identity_counts: countBy(rows, 'identity_state_after'),
    manifest_hash: catalogIdentityFingerprint(rows.map((row) => ({
      ordinal: row.ordinal,
      ml_item_id: row.ml_item_id,
      identity_state: row.identity_state_after,
      reason_code: row.reason_code,
      action: row.action,
      old_relation: row.old_relation,
      new_relation: row.new_relation,
      material_fingerprint: row.material_fingerprint,
    }))),
    artifacts,
    readonly_enforcement: context.readonlyStats,
    invariants: context.invariants,
    ledger_counts_before: context.ledgerCountsBefore,
    ledger_counts_after: context.ledgerCountsAfter,
    applied_actions: [],
    proposed_actions: countBy(rows, 'action'),
    price_changes: 0,
    relation_changes: 0,
    produtos_ativo_changes_by_mission: 0,
    rollback_required: false,
    rollback_plan: 'Nenhuma mutação foi executada; remover somente os artefatos locais se necessário.',
  };
  const manifest = `${stableJson(manifestPayload, 2)}\n`;
  fs.writeFileSync(path.join(outputDirectory, '10_rollback_manifest.json'), manifest, { flag: 'wx' });
  return { artifacts, manifest: manifestPayload, manifest_file_sha256: sha256(manifest) };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--input', '--output'].includes(name) || !argv[index + 1]) throw new Error(`argument_invalid:${name}`);
    result[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!result.input || !result.output) throw new Error('arguments_input_output_required');
  return result;
}

async function runReadOnlyAudit(options, dependencies = {}) {
  const startedAt = new Date().toISOString();
  const inputPath = path.resolve(options.input);
  const sourceBuffer = fs.readFileSync(inputPath);
  const source = parseCanonicalCsv(sourceBuffer);
  const serviceUrl = dependencies.serviceUrl || process.env.SUPABASE_SERVICE_URL;
  const serviceKey = dependencies.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) throw new Error('supabase_service_environment_missing');
  const databaseTarget = await (dependencies.assertDatabaseTarget || assertProductionDatabaseTarget)(serviceUrl);
  const fetchTracker = dependencies.fetchTracker || createReadOnlyFetchTracker(dependencies.fetchImpl || global.fetch);
  const client = dependencies.client || createClient(serviceUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchTracker.readonlyFetch },
  });
  const ledgerCountsBefore = await loadLedgerCounts(client);
  const beforeDatabase = await loadDatabaseSnapshot(client, source.rows);
  if (beforeDatabase.listingById.size !== EXPECTED_ROWS) throw new Error(`database_listing_coverage_invalid:${beforeDatabase.listingById.size}`);
  if (beforeDatabase.snapshotById.size !== EXPECTED_ROWS) throw new Error(`database_snapshot_coverage_invalid:${beforeDatabase.snapshotById.size}`);
  const mlToken = await loadReadOnlyMlToken(client);
  const ml = dependencies.ml || createMlReadOnlyClient(mlToken.token, fetchTracker);
  const account = await ml.request('/users/me?attributes=id');
  const accountId = String(account.data?.id || '');
  if (!account.ok || !allowedMlUserIds().includes(accountId)) throw new Error('ML_AUTHENTICATION_FAILURE');
  const live = await loadLiveMlUniverse(ml, source.rows, dependencies.onProgress || ((progress) => {
    process.stdout.write(`${stableJson({ event: 'catalog_identity_read_progress', ...progress })}\n`);
  }));
  const rows = classifyUniverse(source.rows, beforeDatabase, live, startedAt);
  if (rows.length !== EXPECTED_ROWS || rows.some((row) => !row.identity_state_after)) throw new Error('classification_integrity_invalid');
  const afterDatabase = await loadDatabaseSnapshot(client, source.rows);
  const ledgerCountsAfter = await loadLedgerCounts(client);
  const invariants = compareOperationalProjection(operationalProjection(beforeDatabase), operationalProjection(afterDatabase));
  const readonlyStats = { ...fetchTracker.stats };
  if (readonlyStats.blocked_mutation_attempts !== 0) throw new Error('readonly_mutation_attempt_detected');
  if (stableJson(ledgerCountsBefore) !== stableJson(ledgerCountsAfter)) throw new Error('readonly_ledger_changed_during_run');
  if (invariants.produtos_ativo_changes || invariants.produtos_custom_price_changes || invariants.listing_relation_changes) {
    throw new Error(`readonly_operational_invariant_changed:${stableJson(invariants)}`);
  }
  const databaseCoverage = {
    listings: beforeDatabase.listingById.size,
    snapshots: beforeDatabase.snapshotById.size,
    direct_products: source.rows.filter((row) => {
      const productId = beforeDatabase.listingById.get(row.ml_item_id)?.produto_id;
      return productId && beforeDatabase.productById.has(String(productId));
    }).length,
    fallback_products: source.rows.filter((row) => {
      const listing = beforeDatabase.listingById.get(row.ml_item_id);
      return !listing?.produto_id && (beforeDatabase.productsBySku.get(row.sku) || []).length === 1;
    }).length,
    unresolved_products: rows.filter((row) => !row.produto_id).length,
  };
  const finishedAt = new Date().toISOString();
  const runId = `BNT-ML-CATALOG-IDENTITY-01-${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const outputDirectory = ensureNewOutputDirectory(options.output);
  const artifacts = writeArtifacts(outputDirectory, rows, {
    runId, inputPath, source, startedAt, finishedAt, databaseTarget, mlToken,
    databaseCoverage, invariants, readonlyStats, ledgerCountsBefore, ledgerCountsAfter,
  });
  return {
    run_id: runId,
    output_directory: outputDirectory,
    total: rows.length,
    identity_counts: countBy(rows, 'identity_state_after'),
    anomaly_count: rows.filter((row) => !row.live_ml_state || ['listed', 'not_listed'].includes(row.live_ml_state)).length,
    error_count: rows.filter((row) => row.error).length,
    manifest_hash: artifacts.manifest.manifest_hash,
    manifest_file_sha256: artifacts.manifest_file_sha256,
    invariants,
    readonly_stats: readonlyStats,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runReadOnlyAudit(args);
  process.stdout.write(`${stableJson({ event: 'catalog_identity_readonly_completed', ...result }, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${stableJson({ event: 'catalog_identity_readonly_failed', error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ARTIFACT_NAMES,
  CSV_COLUMNS,
  EXPECTED_SHA256,
  compareOperationalProjection,
  createReadOnlyFetchTracker,
  materialStateOverrides,
  parseArgs,
  parseBrl,
  parseCanonicalCsv,
  parseCsv,
  runReadOnlyAudit,
};
