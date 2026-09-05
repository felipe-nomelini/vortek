#!/usr/bin/env node
if (require.main === module) throw new Error('M2M: execução legada aposentada. Usar Radar e simulação/aprovação canônica; histórico preservado.');
/* Phase 6C/6D/6E: sequential, refined safe-publication candidates. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  TAX_RATE,
  attributeValue,
  buildCatalogAttributes,
  canonicalHash,
  extractShippingCost,
  financialAt,
  missingRequiredAttributes,
  normalize,
  normalizeGtin,
  requiredAttributeIds,
  roundMoney,
} = require('./lib/ml-p0-phase6a');
const { entityHasGtin } = require('./lib/ml-p0-phase6b');
const PHASE = String(process.env.ML_P0_PHASE || '6C').toUpperCase();
if (!['6C', '6D', '6E', '6E2'].includes(PHASE)) throw new Error(`unsupported_phase:${PHASE}`);
const PHASE_LOWER = PHASE.toLowerCase();
const phaseModule = require(`./lib/ml-p0-phase${PHASE_LOWER}`);
const {
  buildManualAttributes,
  buildPersistenceSql,
  classifyRemoteIdentity,
  exactCatalogIdentity,
  feeComponents,
  protectivePrice,
} = phaseModule;
let ALLOWED = phaseModule.ALLOWED || [];

dotenv.config({ path: '.env.local', quiet: true });

const SELLER_ID = 3294514937;
const REPORT_DIR = path.resolve(`reports/ml-p0-phase${PHASE_LOWER}`);
let SELECTED = ALLOWED.length;
const HOLD = PHASE === '6E2' ? 'P0 PHASE 6E.2 — SEMANTIC ALTERNATIVES WRITE RESUME HOLD' : PHASE === '6E' ? 'P0 PHASE 6E — 200 SKU INDUSTRIAL SAFE PUBLICATION BATCH HOLD' : PHASE === '6D' ? 'P0 PHASE 6D — 100 SKU REFINED SAFE PUBLICATION BATCH HOLD' : 'P0 PHASE 6C — 50 SKU REFINED SAFE PUBLICATION BATCH HOLD';
const SSH_HOST = '192.168.1.160';
const DB_CONTAINER = 'supabase-db';
const LISTING_TYPE = 'gold_special';
const TARGET_POST_MARGIN = 0.5;
const TARGET_REPROTECTION_MARGIN = 0.505;
const ATTRIBUTES_ARTIFACT = ['6D', '6E', '6E2'].includes(PHASE) ? 'required-attributes.json' : 'attributes.json';
const STANDARD_ARTIFACTS = ['summary.json', 'local-baseline.json', 'fast-gate.json', 'identity.json', 'gtin.json', 'duplicate-check.json', 'category.json', 'catalog.json', ATTRIBUTES_ARTIFACT, 'image-audit.json', 'payload.json', 'post-response.json', 'remote-readback.json', 'shipping-pre.json', 'shipping-post.json', 'protective-pricing.json', 'price-update.json', 'propagation.json', 'local-persistence.json', 'local-remote-diff.json', 'sanitation.json'];
const PHASE6E2_ARTIFACTS = ['summary.json', 'local-readback.json', 'identity-recheck.json', 'gtin-recheck.json', 'semantic-alternative.json', 'semantic-recheck.json', 'category-tree.json', 'catalog-validation.json', 'required-attributes.json', 'duplicate-check.json', 'image-audit.json', 'payload.json', 'protective-pricing-pre.json', 'post-response.json', 'remote-readback.json', 'post-semantic-validation.json', 'shipping-post.json', 'protective-pricing-post.json', 'price-update.json', 'propagation.json', 'local-persistence.json', 'local-remote-diff.json'];
const ARTIFACTS = PHASE === '6E2' ? PHASE6E2_ARTIFACTS : STANDARD_ARTIFACTS;
const FINAL_STATES = new Set(['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT', 'SKIPPED_ALREADY_LINKED', 'SKIPPED_KNOWN_BLOCK', 'BLOCK_LOCAL_STATE', 'BLOCK_IDENTITY', 'BLOCK_GTIN', 'BLOCK_GTIN_BRAND_CONFLICT', 'BLOCK_GTIN_MODEL_CONFLICT', 'BLOCK_GTIN_UNIT_CONFLICT', 'BLOCK_LOCAL_DUPLICATE', 'BLOCK_REMOTE_DUPLICATE', 'BLOCK_SEMANTIC_CATEGORY_MISMATCH', 'BLOCK_CATEGORY', 'BLOCK_CATALOG_IDENTITY', 'BLOCK_REQUIRED_ATTRIBUTE', 'BLOCK_REQUIRED_ATTRIBUTE_EVIDENCE', 'BLOCK_IMAGE', 'BLOCK_API_CONTRACT', 'BLOCK_PROTECTIVE_PRICE_ENGINE', 'BLOCK_PERSISTENCE', 'SOURCE_DEFERRED', 'API_TRANSIENT_ERROR', 'REMOTE_PROPAGATION_PENDING', 'REMOTE_WRONG_CATEGORY_CREATED']);
const now = () => new Date().toISOString();
const localTime = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date()).replace(' ', 'T');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metrics = { selected: SELECTED, processed: 0, fast_rejected: 0, expensive_lookups_saved: 0, layer2: 0, payloads_built: 0, created: 0, persisted: 0, already_consistent: 0, skipped_linked: 0, blocked: 0, ml_gets: 0, diagnostic_posts: 0, item_posts: 0, price_puts: 0, local_reads: 0, local_transactions: 0, rollbacks: 0, source_lookups: 0, false_positive_duplicates: 0, propagation_wait_ms: 0, started_at: now() };
const stop = { triggered: false, reason: null, wrong_identity_publications: 0, wrong_semantic_category_publications: 0, duplicate_creations: 0, wrong_catalog_publications: 0, consecutive_pricing_failures: 0, consecutive_persistence_failures: 0, structural_400: {} };
let lastMlAt = 0;
let selectionInfo = null;

fs.mkdirSync(REPORT_DIR, { recursive: true });
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function skuDir(sku) { const dir = path.join(REPORT_DIR, sku); fs.mkdirSync(dir, { recursive: true }); return dir; }
function artifact(sku, name, value) { writeJson(path.join(skuDir(sku), name), value); }
function fillArtifacts(sku, result) { for (const name of ARTIFACTS) if (!fs.existsSync(path.join(skuDir(sku), name))) artifact(sku, name, { status: 'not_executed', reason: result }); }

function dbClient() {
  const url = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('AUTH_SYSTEMIC_FAILURE:supabase_configuration_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function select(db, table, columns, configure) {
  metrics.local_reads += 1;
  let query = db.from(table).select(columns);
  if (configure) query = configure(query);
  const { data, error } = await query;
  if (error) throw new Error(`supabase_${table}:${error.message}`);
  return data || [];
}

async function selectAll(db, table, columns, configure, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    metrics.local_reads += 1;
    let query = db.from(table).select(columns).order('id').range(from, from + pageSize - 1);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`supabase_${table}:${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function ml(token, resource, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const conditional = /^\/categories\/MLB\d+\/attributes\/conditional$/.test(resource);
  if (!['GET', 'POST', 'PUT'].includes(method)) throw new Error(`ml_method_forbidden:${method}`);
  if (method === 'POST' && resource !== '/items' && !conditional) throw new Error(`ml_post_forbidden:${resource}`);
  if (method === 'PUT' && !/^\/items\/MLB\d+$/.test(resource)) throw new Error(`ml_put_forbidden:${resource}`);
  if (method === 'GET' && /performance|health|recommendation|description|price_to_win|buy_box/i.test(resource)) throw new Error(`out_of_scope_read_forbidden:${resource}`);
  const wait = 130 - (Date.now() - lastMlAt); if (wait > 0) await sleep(wait); lastMlAt = Date.now();
  if (method === 'GET') metrics.ml_gets += 1;
  else if (conditional) metrics.diagnostic_posts += 1;
  else if (method === 'POST') metrics.item_posts += 1;
  else if (method === 'PUT') metrics.price_puts += 1;
  const response = await fetch(`https://api.mercadolibre.com${resource}`, { method, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers), data };
}

async function scanInventory(token) {
  const ids = []; let scrollId = ''; let expected = null; let pages = 0; const seen = new Set();
  while (pages < 1000) {
    const query = scrollId ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}` : 'search_type=scan&limit=100';
    const response = await ml(token, `/users/${SELLER_ID}/items/search?${query}`);
    if (!response.ok) throw new Error(`AUTH_SYSTEMIC_FAILURE:remote_inventory_http_${response.status}`);
    pages += 1; if (expected === null) expected = Number(response.data?.paging?.total || 0);
    const rows = (response.data?.results || []).map(String); ids.push(...rows);
    if (!rows.length || new Set(ids).size >= expected || !response.data.scroll_id || seen.has(response.data.scroll_id)) break;
    seen.add(response.data.scroll_id); scrollId = response.data.scroll_id;
  }
  const unique = [...new Set(ids)]; const items = [];
  const fields = 'id,title,status,sub_status,seller_id,seller_custom_field,user_product_id,family_id,family_name,catalog_product_id,category_id,attributes,price,available_quantity,sold_quantity,listing_type_id,catalog_listing,permalink,pictures,thumbnail,condition,shipping,date_created,last_updated';
  for (let index = 0; index < unique.length; index += 20) {
    const response = await ml(token, `/items?ids=${unique.slice(index, index + 20).join(',')}&attributes=${fields}`);
    if (!response.ok) throw new Error(`AUTH_SYSTEMIC_FAILURE:remote_inventory_multiget_${response.status}`);
    for (const row of response.data || []) if (Number(row.code) === 200 && row.body?.id) items.push(row.body);
  }
  if (unique.length !== expected || items.length !== unique.length) throw new Error(`${PHASE === '6E' ? 'BATCH_ABORT_REMOTE_INVENTORY_UNRELIABLE' : 'AUTH_SYSTEMIC_FAILURE:remote_inventory_unreliable'}:${unique.length}/${expected}/${items.length}`);
  return { expected, captured: unique.length, pages, reliable: true, timestamp: now(), items };
}

function remoteMatches(items, config) {
  return items.filter((item) => {
    if ((config.ignoreRemoteItemIds || []).includes(item.id)) return false;
    const sku = item.seller_custom_field || attributeValue(item, 'SELLER_SKU');
    return normalize(sku) === normalize(config.sku) || entityHasGtin(item, config.gtin) || (config.catalogProductId && item.catalog_product_id === config.catalogProductId);
  });
}

async function dsliteProduct(integration, offer) {
  metrics.source_lookups += 1;
  const url = `${String(integration.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`;
  const response = await fetch(url, { headers: { Token: integration.access_token }, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`dslite_http_${response.status}`);
  const product = (data?.produtos || []).find((row) => String(row.produtoid) === String(offer.dslite_produto_id)) || data?.produtos?.[0];
  if (!product) throw new Error('dslite_product_missing');
  return { url, consulted_at: now(), product };
}

function shippingDimensions(product) {
  const values = [Number(product.altura_embalagem), Number(product.largura_embalagem), Number(product.profundidade_embalagem), Math.ceil(Number(product.peso_embalagem) * 1000)];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
  return `${Math.ceil(values[0])}x${Math.ceil(values[1])}x${Math.ceil(values[2])},${values[3]}`;
}

async function auditImages(urls, limit) {
  const rows = [];
  for (const [index, originalUrl] of (urls || []).slice(0, limit).entries()) {
    try {
      const response = await fetch(originalUrl, { redirect: 'follow', signal: AbortSignal.timeout(45000) });
      const buffer = Buffer.from(await response.arrayBuffer()); const type = response.headers.get('content-type') || '';
      const metadata = response.ok && type.startsWith('image/') ? await sharp(buffer).metadata() : {};
      const finalUrl = response.url || originalUrl; const approved = response.ok && finalUrl.startsWith('https://') && type.startsWith('image/') && Number(metadata.width) >= 250 && Number(metadata.height) >= 250;
      rows.push({ index: index + 1, original_url: originalUrl, final_url: finalUrl, redirected: finalUrl !== originalUrl, http_status: response.status, content_type: type, width: metadata.width || null, height: metadata.height || null, classification: approved ? 'APPROVED' : response.ok ? 'REJECT_QUALITY' : 'REJECT_ACCESS' });
    } catch (error) { rows.push({ index: index + 1, original_url: originalUrl, classification: 'REJECT_ACCESS', error: error.message }); }
  }
  return { rows, approved: rows.filter((row) => row.classification === 'APPROVED'), main_approved: rows[0]?.classification === 'APPROVED' };
}

async function quote(token, config, price, dimensions, cost, itemId = null) {
  const feeParams = new URLSearchParams({ price: Number(price).toFixed(2), category_id: config.categoryId, listing_type_id: LISTING_TYPE, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
  const feeResponse = await ml(token, `/sites/MLB/listing_prices?${feeParams}`);
  if (!feeResponse.ok) throw new Error(`fee_quote_http_${feeResponse.status}`);
  const rows = Array.isArray(feeResponse.data) ? feeResponse.data : [feeResponse.data]; const fee = rows.find((row) => row?.listing_type_id === LISTING_TYPE) || rows[0];
  const shippingParams = new URLSearchParams({ ...(itemId ? { item_id: itemId } : { dimensions }), verbose: 'true', item_price: Number(price).toFixed(2), listing_type_id: LISTING_TYPE, mode: 'me2', condition: 'new', logistic_type: 'drop_off', free_shipping: 'true' });
  const shippingResponse = await ml(token, `/users/${SELLER_ID}/shipping_options/free?${shippingParams}`);
  if (!shippingResponse.ok) throw new Error(`shipping_quote_http_${shippingResponse.status}`);
  const shipping = extractShippingCost(shippingResponse.data); const commission = Number(fee?.sale_fee_amount);
  if (!Number.isFinite(shipping) || !Number.isFinite(commission)) throw new Error('financial_quote_incomplete');
  return { price: Number(price), fee, fee_components: feeComponents(fee, price), shipping_data: shippingResponse.data, financial: financialAt({ price, commission, shipping, cost }) };
}

async function planProtectiveQuote(token, config, dimensions, cost, targetMargin, itemId = null, floor = 0) {
  const seed = roundMoney(Math.max(Number(floor), Number(cost) * 4, 199.9));
  const seedQuote = await quote(token, config, seed, dimensions, cost, itemId);
  const components = seedQuote.fee_components;
  if (!Number.isFinite(components.rate)) throw new Error('commission_rate_unavailable');
  const planned = protectivePrice({ cost, shipping: seedQuote.financial.shipping, feeRate: components.rate, fixedFee: components.fixed, targetMargin, floor });
  const validation = await quote(token, config, planned, dimensions, cost, itemId);
  return { method: 'closed_form_then_single_validation', target_margin_percent: targetMargin * 100, seed_quote: seedQuote, planned_price: planned, validation, approved: validation.financial.margin_percent >= targetMargin * 100 };
}

function psql(sql) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', SSH_HOST, `docker exec -i ${DB_CONTAINER} psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At`], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`psql_failed:${String(result.stderr || result.stdout).trim()}`);
  const lines = String(result.stdout || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  return lines.length ? JSON.parse(lines.at(-1)) : null;
}

function localReadback(product, itemId) {
  metrics.local_reads += 1;
  return psql(`select json_build_object('product',(select row_to_json(p) from (select id,sku,gtin,ml_item_id,ml_status,estoque,custo,updated_at from public.produtos where id='${product.id}'::uuid)p),'listings',coalesce((select json_agg(row_to_json(a)) from (select id,ml_item_id,produto_id,sku,titulo,tipo,preco_ml,status,catalogo,thumbnail,permalink,qualidade,qualidade_info from public.anuncios_ml where ml_item_id='${itemId}' or produto_id='${product.id}'::uuid or sku='${product.sku}')a),'[]'::json),'other_products',coalesce((select json_agg(row_to_json(p)) from (select id,sku,ml_item_id from public.produtos where id<>'${product.id}'::uuid and ml_item_id='${itemId}')p),'[]'::json));`);
}

function localRemoteDiff(local, item, product) {
  const listing = (local.listings || []).find((row) => row.ml_item_id === item.id && row.produto_id === product.id && row.sku === product.sku);
  const mapType = ['gold_pro', 'gold_premium'].includes(item.listing_type_id) ? 'premium' : 'classico'; const mapStatus = item.status === 'active' ? 'ativo' : 'pausado';
  const fields = [['ml_item_id', item.id, local.product?.ml_item_id], ['sku', product.sku, listing?.sku], ['produto_id', product.id, listing?.produto_id], ['title', item.title, listing?.titulo], ['price', Number(item.price), Number(listing?.preco_ml)], ['status', mapStatus, listing?.status], ['listing_type', mapType, listing?.tipo], ['catalog', item.catalog_listing === true, listing?.catalogo], ['permalink', item.permalink, listing?.permalink]].map(([field, remote, localValue]) => ({ field, remote, local: localValue, status: String(remote) === String(localValue) ? 'MATCH' : 'DIVERGENT' }));
  const unique = local.listings?.length === 1 && local.other_products?.length === 0;
  return { fields, unique, material_drift: !unique || fields.some((row) => row.status === 'DIVERGENT') };
}

function stopLoss() {
  if (stop.wrong_semantic_category_publications >= 1) return 'STOP_LOSS_SEMANTIC_CATEGORY_PUBLICATION';
  if (stop.wrong_identity_publications >= 1) return 'WRONG_IDENTITY_PUBLICATION';
  if (stop.duplicate_creations >= 2) return 'DUPLICATE_CREATION_SYSTEMIC';
  if (stop.wrong_catalog_publications >= 1) return 'WRONG_CATALOG_PUBLICATION';
  if (stop.consecutive_pricing_failures >= 2) return 'PROTECTIVE_PRICING_SYSTEMIC_FAILURE';
  if (stop.consecutive_persistence_failures >= 2) return 'PERSISTENCE_SYSTEMIC_FAILURE';
  if (Math.max(0, ...Object.values(stop.structural_400)) >= 3) return 'PAYLOAD_SYSTEMIC_ERROR';
  return null;
}

function register400(data) {
  const fingerprint = String(data?.cause?.[0]?.code || data?.cause?.[0]?.message || data?.error || data?.message || 'unknown_400');
  stop.structural_400[fingerprint] = (stop.structural_400[fingerprint] || 0) + 1;
}

function sanitationFor(config, result) {
  if (config.sanitation) return config.sanitation;
  if (result === 'REMOTE_PROPAGATION_PENDING') return 'REMOTE_LINK_REVIEW';
  if (/GTIN/.test(result)) return 'GTIN_FIX_REQUIRED';
  if (/CATEGORY/.test(result)) return 'CATEGORY_FIX_REQUIRED';
  if (/CATALOG/.test(result)) return 'CATALOG_REVIEW_REQUIRED';
  if (/ATTRIBUTE/.test(result)) return 'REQUIRED_ATTRIBUTE_REQUIRED';
  if (/IMAGE/.test(result)) return 'IMAGE_FIX_REQUIRED';
  if (/DUPLICATE/.test(result)) return result.includes('LOCAL') ? 'LOCAL_DUPLICATE_REVIEW' : 'REMOTE_LINK_REVIEW';
  if (/PROTECTIVE_PRICE/.test(result)) return 'API_CONTRACT_REVIEW';
  return 'IDENTITY_FIX_REQUIRED';
}

function finish(base, config, started, result, observation, extra = {}) {
  if (!['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT'].includes(result)) metrics.blocked += 1;
  const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: extra.itemId || null, catalog_product_id: extra.catalogProductId ?? config.catalogProductId ?? null, protective_price: extra.price ?? null, margin_percent: extra.margin ?? null, persisted: result === 'SAFE_PUBLICATION_PERSIST_SUCCESS' || result === 'ALREADY_CONSISTENT', observation, sanitation: !['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT'].includes(result) ? sanitationFor(config, result) : null, backlogs: { quality_optimization_pending: ['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT'].includes(result), description_optimization_pending: ['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT'].includes(result), commercial_optimization_pending: ['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT'].includes(result), optional_catalog_optimization_pending: ['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT'].includes(result) && !config.catalogProductId } };
  artifact(config.sku, 'summary.json', summary);
  artifact(config.sku, 'sanitation.json', summary.sanitation ? { sku: config.sku, gate: result, evidence: observation, local_value: config.gtin, found_value: config.foundValue || null, suggested_action: summary.sanitation, source: config.source || null, timestamp: now() } : { status: 'not_applicable', reason: result });
  fillArtifacts(config.sku, result); return summary;
}

async function settleRemote(token, itemId) {
  const started = Date.now(); let last = null;
  const maxAttempts = ['6D', '6E'].includes(PHASE) ? 10 : 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await ml(token, `/items/${itemId}?include_internal_attributes=true`); last = response;
    const pending = response.data?.sub_status?.includes('picture_download_pending') || !response.data?.pictures?.length;
    if (response.ok && !pending) return { settled: true, attempts: attempt, elapsed_ms: Date.now() - started, response };
    if (attempt < maxAttempts) await sleep(3000);
  }
  metrics.propagation_wait_ms += Date.now() - started;
  return { settled: false, attempts: maxAttempts, elapsed_ms: Date.now() - started, response: last };
}

async function settleUserProductFamily(token, item) {
  if (!item?.user_product_id || !item?.family_id) return { settled: false, reason: 'missing_user_product_or_family_id', attempts: 0 };
  const started = Date.now(); let userProduct = null; let family = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    userProduct = await ml(token, `/user-products/${encodeURIComponent(item.user_product_id)}`);
    family = await ml(token, `/sites/MLB/user-products-families/${encodeURIComponent(item.family_id)}`);
    if (userProduct.ok && family.ok) return { settled: true, attempts: attempt, elapsed_ms: Date.now() - started, user_product: userProduct.data, family: family.data };
    if (attempt < 6) await sleep(3000);
  }
  metrics.propagation_wait_ms += Date.now() - started;
  return { settled: false, attempts: 6, elapsed_ms: Date.now() - started, user_product_http: userProduct?.status, family_http: family?.status, user_product: userProduct?.data, family: family?.data };
}

async function processSku(context) {
  const { db, token, inventory, allProducts, dsliteIntegration, index, baselineMap } = context;
  let config = context.config;
  const started = Date.now(); metrics.processed += 1;
  const base = { index, sku: config.sku, expected_gtin: config.gtin, started_at: now(), local_time: localTime() };
  const [products, listingRows] = await Promise.all([select(db, 'produtos', '*', (query) => query.eq('sku', config.sku).limit(2)), select(db, 'anuncios_ml', '*', (query) => query.eq('sku', config.sku))]);
  const product = products[0]; const offers = product ? await select(db, 'produto_fornecedor_ofertas', '*', (query) => query.eq('produto_id', product.id)) : []; const offer = offers.find((row) => row.id === product?.oferta_preferencial_id) || null;
  const normalizedExpectedGtin = normalizeGtin(config.gtin);
  const localDuplicates = product && normalizedExpectedGtin ? allProducts.filter((row) => row.id !== product.id && normalizeGtin(row.gtin) === normalizedExpectedGtin) : [];
  const remote = remoteMatches(inventory.items, config);
  const fast = { checked_at: now(), product_exists_once: products.length === 1, active: product?.ativo === true, stock_positive: Number(product?.estoque) > 0, cost_positive: Number(product?.custo) > 0, ml_item_id_null: product?.ml_item_id == null, ml_status_unlinked: product?.ml_status === 'sem_anuncio', gtin_present: Boolean(normalizeGtin(product?.gtin)), gtin_matches_authorized: normalizeGtin(product?.gtin) === normalizeGtin(config.gtin), identity_text_present: Boolean(product?.nome && product?.marca), preferred_offer_present: Boolean(offer), local_listing_absent: listingRows.length === 0, local_duplicates: localDuplicates.map((row) => ({ id: row.id, sku: row.sku, gtin: row.gtin })), remote_exact: remote.map((row) => ({ id: row.id, status: row.status, sku: row.seller_custom_field || attributeValue(row, 'SELLER_SKU'), gtin: attributeValue(row, 'GTIN'), catalog_product_id: row.catalog_product_id })), historical_decision: config.decision };
  artifact(config.sku, 'local-baseline.json', { captured_at: now(), initial_batch_baseline: baselineMap.get(config.sku) || null, current: product || null, preferred_offer: offer || null });
  if (PHASE === '6E2') artifact(config.sku, 'local-readback.json', { captured_at: now(), current: product || null, preferred_offer: offer || null, local_listings: listingRows });
  artifact(config.sku, 'fast-gate.json', fast);
  artifact(config.sku, 'gtin.json', { local: product?.gtin || null, authorized: config.gtin, normalized_local: normalizeGtin(product?.gtin), normalized_authorized: normalizeGtin(config.gtin), classification: normalizeGtin(product?.gtin) === normalizeGtin(config.gtin) ? (String(product?.gtin) === String(config.gtin) ? 'MATCH' : 'GTIN_LEADING_ZERO_NORMALIZATION') : 'CONFLICT' });
  if (PHASE === '6E2') {
    artifact(config.sku, 'gtin-recheck.json', { local: product?.gtin || null, authorized: config.gtin, normalized_local: normalizeGtin(product?.gtin), normalized_authorized: normalizeGtin(config.gtin), classification: normalizeGtin(product?.gtin) === normalizeGtin(config.gtin) ? (String(product?.gtin) === String(config.gtin) ? 'MATCH' : 'GTIN_LEADING_ZERO_NORMALIZATION') : 'CONFLICT' });
    artifact(config.sku, 'semantic-alternative.json', config.semanticAlternative || null);
  }
  artifact(config.sku, 'duplicate-check.json', { inventory_snapshot: { captured: inventory.captured, expected: inventory.expected, timestamp: inventory.timestamp }, local_duplicates: fast.local_duplicates, remote_matches: fast.remote_exact });

  let result = null; let observation = null;
  if (!product || products.length !== 1 || product.ativo !== true || Number(product.estoque) <= 0 || Number(product.custo) <= 0 || !offer) { result = 'BLOCK_LOCAL_STATE'; observation = 'local state or preferred offer gate failed'; }
  else if (product.ml_item_id) {
    const linkedRemote = inventory.items.find((row) => row.id === product.ml_item_id);
    const linkedListing = listingRows.find((row) => row.ml_item_id === product.ml_item_id && row.produto_id === product.id && row.sku === product.sku);
    if (linkedRemote && linkedListing && listingRows.length === 1) {
      metrics.persisted += 1; metrics.already_consistent += 1;
      return finish(base, config, started, 'ALREADY_CONSISTENT', 'existing local and remote 1:1 link is consistent', { itemId: product.ml_item_id, catalogProductId: linkedRemote.catalog_product_id, price: linkedRemote.price });
    }
    result = 'SKIPPED_ALREADY_LINKED'; observation = `already linked to ${product.ml_item_id} without a complete idempotent reconciliation`; metrics.skipped_linked += 1;
  }
  else if (product.ml_status !== 'sem_anuncio' || listingRows.length) { result = 'BLOCK_LOCAL_STATE'; observation = 'local listing/status conflict'; }
  else if (normalizeGtin(product.gtin) !== normalizeGtin(config.gtin)) { result = 'BLOCK_GTIN'; observation = 'local GTIN drift'; }
  else if (localDuplicates.length) { result = 'BLOCK_LOCAL_DUPLICATE'; observation = 'same normalized GTIN exists on another local product'; }
  else if (remote.length) { result = 'BLOCK_REMOTE_DUPLICATE'; observation = 'exact remote seller SKU, GTIN, or catalog match already exists'; }
  else if (config.decision !== 'PASS') { result = config.decision; observation = config.reason; }
  if (result) { metrics.fast_rejected += 1; metrics.expensive_lookups_saved += 1; return finish(base, config, started, result, observation, { catalogProductId: config.catalogProductId }); }

  metrics.layer2 += 1;
  const dslite = await dsliteProduct(dsliteIntegration, offer).catch((error) => ({ error: error.message }));
  if (dslite.error) return finish(base, config, started, 'SOURCE_DEFERRED', dslite.error);
  const productSearch = normalizeGtin(config.gtin)
    ? await ml(token, `/products/search?status=active&site_id=MLB&product_identifier=${config.gtin}`)
    : { ok: true, status: 200, data: { results: [], query_type: 'NO_GTIN' } };
  metrics.source_lookups += 1;
  if (!productSearch.ok) return finish(base, config, started, 'SOURCE_DEFERRED', `catalog search HTTP ${productSearch.status}`);
  const exactResults = productSearch.data?.results || [];
  if (typeof phaseModule.resolveDynamicConfig === 'function') {
    const resolved = await phaseModule.resolveDynamicConfig({ config, product, offer, dslite, exactResults, ml: (resource, options) => ml(token, resource, options) });
    Object.assign(context.config, resolved);
    config = context.config;
    if (config.decision !== 'PASS') {
      artifact(config.sku, 'identity.json', { checked_at: now(), product: { id: product.id, sku: product.sku, nome: product.nome, marca: product.marca, gtin: product.gtin }, dslite, resolution: resolved, catalog_results: exactResults });
      if (PHASE === '6E2') {
        artifact(config.sku, 'identity-recheck.json', { checked_at: now(), product: { id: product.id, sku: product.sku, nome: product.nome, marca: product.marca, gtin: product.gtin }, dslite, resolution: resolved, catalog_results: exactResults });
        artifact(config.sku, 'semantic-recheck.json', resolved.semanticRecheck || { passed: false, result: config.decision, reason: config.reason });
      }
      return finish(base, config, started, config.decision, config.reason, { catalogProductId: config.catalogProductId });
    }
  }
  artifact(config.sku, 'identity.json', { checked_at: now(), product: { id: product.id, sku: product.sku, nome: product.nome, marca: product.marca, gtin: product.gtin }, dslite, source: config.source, source_confidence: config.sourceConfidence || (/^https:\/\//.test(config.source || '') ? 'official' : config.catalogProductId ? 'ML catalog' : 'supplier'), identity_assessment: config.identityAssessment || null, catalog_results: exactResults });
  if (PHASE === '6E2') {
    artifact(config.sku, 'identity-recheck.json', { checked_at: now(), product: { id: product.id, sku: product.sku, nome: product.nome, marca: product.marca, gtin: product.gtin }, dslite, source: config.source, identity_confidence: config.identityConfidence, identity_assessment: config.identityAssessment || null, catalog_results: exactResults });
    artifact(config.sku, 'semantic-recheck.json', config.semanticRecheck);
    artifact(config.sku, 'category-tree.json', config.semanticRecheck?.category || config.semanticAlternative || null);
  }

  let catalogResult = null; let catalogIdentity = null;
  if (config.catalogProductId) {
    catalogResult = exactResults.find((row) => row.id === config.catalogProductId); catalogIdentity = exactCatalogIdentity(catalogResult, config);
    if (!catalogResult || !catalogIdentity.passed) return finish(base, config, started, 'BLOCK_CATALOG_IDENTITY', { expected: config.catalogProductId, identity: catalogIdentity, results: exactResults.map((row) => row.id) });
  } else if (!phaseModule.ignoreUnrelatedCatalogRequired && exactResults.some((row) => row?.settings?.listing_strategy === 'catalog_required')) {
    return finish(base, config, started, 'BLOCK_CATALOG_IDENTITY', 'catalog-required result exists but no exact catalog was homologated');
  }
  const detailProductId = config.catalogProductId || config.catalogEvidenceId;
  const [catalogDetail, categoryResponse, categoryAttrsResponse] = await Promise.all([detailProductId ? ml(token, `/products/${detailProductId}`) : Promise.resolve({ ok: true, data: null }), ml(token, `/categories/${config.categoryId}`), ml(token, `/categories/${config.categoryId}/attributes`)]);
  const category = categoryResponse.data; const categoryAttrs = categoryAttrsResponse.data || []; const expectedDomain = typeof phaseModule.expectedDomain === 'function' ? phaseModule.expectedDomain({ config, catalogResult, category, catalogDetail: catalogDetail.data }) : catalogResult?.domain_id || config.catalogEvidence?.domain_id || config.domainId;
  artifact(config.sku, 'catalog.json', { checked_at: now(), expected_catalog_product_id: config.catalogProductId || null, catalog_search_identity: catalogIdentity, catalog_detail: catalogDetail.data || null, strategy: catalogResult?.settings?.listing_strategy || 'optional_or_none', optional_catalog_optimization_pending: !config.catalogProductId });
  artifact(config.sku, 'category.json', { checked_at: now(), category_id: config.categoryId, confidence: categoryResponse.ok && category?.settings?.listing_allowed === true && category?.settings?.catalog_domain === expectedDomain ? 'HIGH' : 'LOW', category, expected_domain: expectedDomain });
  if (PHASE === '6E2') artifact(config.sku, 'catalog-validation.json', { checked_at: now(), expected_catalog_product_id: config.catalogProductId || null, catalog_search_identity: catalogIdentity, catalog_detail: catalogDetail.data || null, strategy: catalogResult?.settings?.listing_strategy || 'optional_or_none', optional_catalog_optimization_pending: !config.catalogProductId });
  if (!catalogDetail.ok || !categoryResponse.ok || !categoryAttrsResponse.ok || category?.settings?.status !== 'enabled' || category?.settings?.listing_allowed !== true || category?.settings?.catalog_domain !== expectedDomain) return finish(base, config, started, 'BLOCK_CATEGORY', 'category contract/domain is not a high-confidence match');

  const attributes = config.catalogProductId ? buildCatalogAttributes(catalogResult, categoryAttrs, config.sku) : buildManualAttributes(config, categoryAttrs, config.sku);
  const required = requiredAttributeIds(categoryAttrs); const missing = missingRequiredAttributes(attributes, required);
  artifact(config.sku, ATTRIBUTES_ARTIFACT, { checked_at: now(), category_attributes: categoryAttrs, sent: attributes, required, missing, parent_pk: categoryAttrs.filter((row) => row.tags?.product_pk || row.tags?.parent_pk).map((row) => row.id), child_pk: categoryAttrs.filter((row) => row.tags?.variation_attribute).map((row) => row.id) });
  if (missing.length) return finish(base, config, started, 'BLOCK_REQUIRED_ATTRIBUTE', `missing category-required attributes: ${missing.join(',')}`);

  const imageAudit = await auditImages(product.imagens, Number(category?.settings?.max_pictures_per_item || 12)); artifact(config.sku, 'image-audit.json', imageAudit);
  if (!imageAudit.main_approved || !imageAudit.approved.length) return finish(base, config, started, 'BLOCK_IMAGE', 'no usable primary HTTPS image');
  const dimensions = shippingDimensions(dslite.product);
  if (!dimensions) return finish(base, config, started, 'BLOCK_PROTECTIVE_PRICE_ENGINE', 'supplier package dimensions are incomplete');

  const reservations = await select(db, 'pedido_itens', 'pedido_id,seller_sku,quantidade', (query) => query.ilike('seller_sku', config.sku));
  const orderIds = [...new Set(reservations.map((row) => row.pedido_id).filter(Boolean))]; const orders = orderIds.length ? await select(db, 'pedidos', 'id,situacao', (query) => query.in('id', orderIds)) : []; const orderMap = new Map(orders.map((row) => [row.id, row])); const reserving = new Set(['aberto', 'pendente', 'faturado']);
  const reserved = reservations.filter((row) => reserving.has(orderMap.get(row.pedido_id)?.situacao)).reduce((sum, row) => sum + Number(row.quantidade || 0), 0);
  const stock = Math.max(0, Math.min(Number(product.estoque), Number(offer.estoque), Number(dslite.product.estoque)) - reserved);
  if (stock <= 0) return finish(base, config, started, 'BLOCK_LOCAL_STATE', 'publishable stock is zero');
  const cost = Number(offer.custo ?? product.custo); const targetPre = config.catalogProductId ? 0.55 : 0.52;
  const prePlan = await planProtectiveQuote(token, config, dimensions, cost, targetPre).catch((error) => ({ approved: false, error: error.message }));
  artifact(config.sku, 'shipping-pre.json', { dimensions, source: 'DSLITE_SUPPLIER_PACKAGE', target_buffer_percent: targetPre * 100, quote: prePlan.validation?.shipping_data || prePlan.seed_quote?.shipping_data || null });
  artifact(config.sku, 'protective-pricing.json', { tax_rate: TAX_RATE, target_final_percent: 50, target_pre_percent: targetPre * 100, cost, pre_item: prePlan });
  if (PHASE === '6E2') artifact(config.sku, 'protective-pricing-pre.json', { tax_rate: TAX_RATE, target_final_percent: 50, target_pre_percent: targetPre * 100, cost, pre_item: prePlan });
  if (!prePlan.approved) return finish(base, config, started, 'BLOCK_PROTECTIVE_PRICE_ENGINE', prePlan.error || prePlan, { price: prePlan.planned_price, margin: prePlan.validation?.financial?.margin_percent });

  const payload = { family_name: config.familyName, category_id: config.categoryId, ...(config.catalogProductId ? { catalog_product_id: config.catalogProductId, catalog_listing: true } : {}), price: prePlan.planned_price, currency_id: 'BRL', available_quantity: stock, buying_mode: 'buy_it_now', listing_type_id: LISTING_TYPE, condition: 'new', pictures: imageAudit.approved.map((row) => ({ source: row.final_url })), attributes, shipping: { mode: 'me2', local_pick_up: false, free_shipping: true }, seller_custom_field: config.sku };
  const conditional = await ml(token, `/categories/${config.categoryId}/attributes/conditional`, { method: 'POST', body: payload });
  const conditionalRequired = conditional.ok ? (conditional.data?.required_attributes || []).map((row) => row.id) : [];
  const conditionalMissing = missingRequiredAttributes(attributes, conditionalRequired);
  artifact(config.sku, ATTRIBUTES_ARTIFACT, { checked_at: now(), category_attributes: categoryAttrs, sent: attributes, required, missing, conditional: { http_status: conditional.status, response: conditional.data, required: conditionalRequired, missing: conditionalMissing }, parent_pk: categoryAttrs.filter((row) => row.tags?.product_pk || row.tags?.parent_pk).map((row) => row.id), child_pk: categoryAttrs.filter((row) => row.tags?.variation_attribute).map((row) => row.id) });
  if (!conditional.ok) return finish(base, config, started, 'BLOCK_API_CONTRACT', { gate: 'conditional_attributes', http: conditional.status, body: conditional.data });
  if (conditionalMissing.length) return finish(base, config, started, 'BLOCK_REQUIRED_ATTRIBUTE_EVIDENCE', `conditional attributes lack evidence: ${conditionalMissing.join(',')}`);

  const payloadHash = canonicalHash(payload); metrics.payloads_built += 1; artifact(config.sku, 'payload.json', { payload, sha256: payloadHash, family_name_sha256: canonicalHash(config.familyName), title_absent: !('title' in payload), description_absent: !('description' in payload) });
  const immediate = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`); let catalogOffers = { ok: true, status: 200, data: { results: [] } };
  if (config.catalogProductId) catalogOffers = await ml(token, `/products/${config.catalogProductId}/items?limit=100`);
  const noWinners = catalogOffers.status === 404 && catalogOffers.data?.message === 'No winners found'; const ownCatalog = (catalogOffers.data?.results || []).filter((row) => Number(row.seller_id) === SELLER_ID);
  if (!immediate.ok || (!catalogOffers.ok && !noWinners)) return finish(base, config, started, 'API_TRANSIENT_ERROR', 'immediate duplicate gate unavailable');
  if ((immediate.data?.results || []).length || ownCatalog.length) return finish(base, config, started, 'BLOCK_REMOTE_DUPLICATE', 'equivalent item appeared immediately before POST');

  const postStart = Date.now(); const post = await ml(token, '/items', { method: 'POST', body: payload }); let itemId = post.data?.id || null;
  artifact(config.sku, 'post-response.json', { attempted_at: now(), local_time: localTime(), endpoint: 'POST /items', request_id: post.headers['x-request-id'] || post.headers['x-requestid'] || null, http_status: post.status, elapsed_ms: Date.now() - postStart, payload_sha256: payloadHash, body: post.data });
  if (post.status === 400) { register400(post.data); return finish(base, config, started, 'BLOCK_API_CONTRACT', post.data, { price: payload.price, margin: prePlan.validation.financial.margin_percent }); }
  if (post.status >= 500) {
    const ghost = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`); itemId = ghost.data?.results?.[0] || null;
    if (!itemId) return finish(base, config, started, 'API_TRANSIENT_ERROR', post.data, { price: payload.price, margin: prePlan.validation.financial.margin_percent });
  } else if (post.status !== 201 || !itemId) return finish(base, config, started, 'BLOCK_API_CONTRACT', post.data, { price: payload.price, margin: prePlan.validation.financial.margin_percent });
  metrics.created += 1;

  const settled = await settleRemote(token, itemId); let item = settled.response?.data; metrics.propagation_wait_ms += settled.elapsed_ms;
  if (!settled.settled) { artifact(config.sku, 'propagation.json', { item: settled }); artifact(config.sku, 'remote-readback.json', { propagation: settled, item }); return finish(base, config, started, 'REMOTE_PROPAGATION_PENDING', 'picture propagation did not settle within bounded read-only polling', { itemId, price: item?.price || payload.price }); }
  const relations = await settleUserProductFamily(token, item);
  artifact(config.sku, 'propagation.json', { item: settled, user_product_family: relations });
  if (!relations.settled) { artifact(config.sku, 'remote-readback.json', { propagation: { item: settled, user_product_family: relations }, item }); return finish(base, config, started, 'REMOTE_PROPAGATION_PENDING', 'User Product/family propagation did not settle within bounded read-only polling', { itemId, price: item?.price || payload.price }); }
  if (typeof phaseModule.postSemanticValidation === 'function') {
    const postSemantic = await phaseModule.postSemanticValidation({ config, item, ml: (resource, options) => ml(token, resource, options) });
    artifact(config.sku, 'post-semantic-validation.json', postSemantic);
    if (!postSemantic.passed) {
      stop.wrong_semantic_category_publications += 1;
      artifact(config.sku, 'remote-readback.json', { item, user_product: relations.user_product, family: relations.family, post_semantic_validation: postSemantic, propagation: { item: settled, user_product_family: relations } });
      return finish(base, config, started, 'REMOTE_WRONG_CATEGORY_CREATED', postSemantic, { itemId, catalogProductId: item.catalog_product_id, price: item.price });
    }
  }
  const expected = { ...config, sellerId: SELLER_ID, quantity: stock, listingTypeId: LISTING_TYPE }; let identity = classifyRemoteIdentity(item, expected);
  const duplicateRead = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`);
  if ((duplicateRead.data?.results || []).length > 1) { stop.duplicate_creations += 1; return finish(base, config, started, 'BLOCK_REMOTE_DUPLICATE', 'more than one remote item for seller SKU after POST', { itemId, price: item.price }); }
  if (!identity.passed || !['active', 'paused', 'under_review'].includes(item.status)) {
    stop.wrong_identity_publications += 1; if (config.catalogProductId && item.catalog_product_id !== config.catalogProductId) stop.wrong_catalog_publications += 1;
    artifact(config.sku, 'remote-readback.json', { item, identity, propagation: settled });
    return finish(base, config, started, 'BLOCK_IDENTITY', { identity, status: item.status }, { itemId, catalogProductId: item.catalog_product_id, price: item.price });
  }

  let postQuote = await quote(token, config, Number(item.price), dimensions, cost, itemId).catch((error) => ({ error: error.message })); let priceUpdate = { executed: false, reason: 'not_required' };
  if (!postQuote.financial || postQuote.financial.margin_percent < TARGET_POST_MARGIN * 100) {
    const plan = await planProtectiveQuote(token, config, dimensions, cost, TARGET_REPROTECTION_MARGIN, itemId, Number(item.price)).catch((error) => ({ approved: false, error: error.message }));
    if (!plan.approved) { stop.consecutive_pricing_failures += 1; return finish(base, config, started, 'BLOCK_PROTECTIVE_PRICE_ENGINE', plan, { itemId, price: item.price, margin: postQuote.financial?.margin_percent }); }
    const update = await ml(token, `/items/${itemId}`, { method: 'PUT', body: { price: plan.planned_price } });
    priceUpdate = { executed: true, endpoint: `PUT /items/${itemId}`, request_id: update.headers['x-request-id'] || null, http_status: update.status, target: plan.planned_price, body: update.data };
    if (!update.ok) { artifact(config.sku, 'price-update.json', priceUpdate); stop.consecutive_pricing_failures += 1; return finish(base, config, started, 'BLOCK_PROTECTIVE_PRICE_ENGINE', update.data, { itemId, price: item.price, margin: postQuote.financial?.margin_percent }); }
    const reread = await ml(token, `/items/${itemId}?include_internal_attributes=true`); item = reread.data; postQuote = await quote(token, config, Number(item.price), dimensions, cost, itemId);
  }
  artifact(config.sku, 'price-update.json', priceUpdate); artifact(config.sku, 'shipping-post.json', { item_id: itemId, source: 'POST_ITEM_SHIPPING_REFERENCE', quote: postQuote.shipping_data || null });
  artifact(config.sku, 'protective-pricing.json', { tax_rate: TAX_RATE, target_final_percent: 50, target_pre_percent: targetPre * 100, cost, pre_item: prePlan, post_item: postQuote, approved: postQuote.financial?.margin_percent >= 50 });
  if (PHASE === '6E2') artifact(config.sku, 'protective-pricing-post.json', { tax_rate: TAX_RATE, target_final_percent: 50, cost, post_item: postQuote, approved: postQuote.financial?.margin_percent >= 50 });
  if (!postQuote.financial || postQuote.financial.margin_percent < 50) { stop.consecutive_pricing_failures += 1; return finish(base, config, started, 'BLOCK_PROTECTIVE_PRICE_ENGINE', postQuote, { itemId, price: item.price, margin: postQuote.financial?.margin_percent }); }
  stop.consecutive_pricing_failures = 0;

  identity = classifyRemoteIdentity(item, expected); artifact(config.sku, 'remote-readback.json', { checked_at: now(), item, user_product: relations.user_product, family: relations.family, identity, propagation: { item: settled, user_product_family: relations }, image_normalization: item.pictures?.every((picture) => /mlstatic\.com/.test(picture.secure_url || picture.url || '')) ? 'IMAGE_NORMALIZED_BY_ML' : 'SOURCE_PRESERVED' });
  if (!identity.passed) { stop.wrong_identity_publications += 1; return finish(base, config, started, 'BLOCK_IDENTITY', identity, { itemId, catalogProductId: item.catalog_product_id, price: item.price, margin: postQuote.financial.margin_percent }); }

  result = 'BLOCK_PERSISTENCE'; observation = null;
  try {
    metrics.local_transactions += 1; const transaction = psql(buildPersistenceSql({ product, item })); const local = localReadback(product, itemId); const diff = localRemoteDiff(local, item, product);
    artifact(config.sku, 'local-persistence.json', { executed: true, committed: true, transaction, quality_score_not_evaluated: true, quality_optimization_pending: true, description_optimization_pending: true, commercial_optimization_pending: true }); artifact(config.sku, 'local-remote-diff.json', diff);
    if (diff.material_drift) { result = 'BLOCK_PERSISTENCE'; observation = diff; stop.consecutive_persistence_failures += 1; }
    else { result = transaction?.result === 'ALREADY_CONSISTENT' ? 'ALREADY_CONSISTENT' : 'SAFE_PUBLICATION_PERSIST_SUCCESS'; metrics.persisted += 1; if (result === 'ALREADY_CONSISTENT') metrics.already_consistent += 1; stop.consecutive_persistence_failures = 0; inventory.items.push(item); }
  } catch (error) { metrics.rollbacks += 1; stop.consecutive_persistence_failures += 1; observation = error.message; artifact(config.sku, 'local-persistence.json', { executed: true, committed: false, error: error.message }); }
  return finish(base, config, started, result, observation, { itemId, catalogProductId: item.catalog_product_id, price: Number(item.price), margin: postQuote.financial.margin_percent });
}

function quoteCsv(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function writeCheckpoint(results, inventory, completed) {
  if (PHASE !== '6E') return;
  const file = path.join(REPORT_DIR, 'checkpoints.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { phase: PHASE, selection_sha256: selectionInfo?.freeze?.sha256 || null, rows: [] };
  const checkpoint = {
    classified: completed, generated_at: now(), last_sku: results.at(-1)?.sku || null,
    counts: results.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] || 0) + 1 }), {}),
    writes: { posts: metrics.item_posts, puts: metrics.price_puts, commits: metrics.local_transactions - metrics.rollbacks, rollbacks: metrics.rollbacks },
    remote_inventory: { captured: inventory.captured, expected: inventory.expected, reliable: inventory.reliable },
  };
  current.rows = [...current.rows.filter((row) => row.classified !== completed), checkpoint].sort((left, right) => left.classified - right.classified);
  writeJson(file, current);
}
function writeConsolidated(results, inventory) {
  metrics.completed_at = now(); metrics.elapsed_ms = Date.now() - Date.parse(metrics.started_at); metrics.mean_sku_ms = results.length ? Math.round(results.reduce((sum, row) => sum + Number(row.elapsed_ms || 0), 0) / results.length) : 0; metrics.success_rate_percent = results.length ? roundMoney(results.filter((row) => row.result === 'SAFE_PUBLICATION_PERSIST_SUCCESS').length / results.length * 100) : 0; metrics.post_success_rate_percent = metrics.item_posts ? roundMoney(metrics.persisted / metrics.item_posts * 100) : 0; metrics.protection_put_rate_percent = metrics.created ? roundMoney(metrics.price_puts / metrics.created * 100) : 0;
  const counts = results.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] || 0) + 1 }), {}); const blocks = results.filter((row) => !['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT'].includes(row.result)); const published = results.filter((row) => row.persisted);
  const summary = { phase: PHASE === '6E2' ? '6E.2' : PHASE, mode: PHASE === '6E2' ? 'SEMANTIC_ALTERNATIVES_CONTROLLED_WRITE_RESUME' : PHASE === '6E' ? 'INDUSTRIAL_SAFE_PUBLICATION_DYNAMIC_FROZEN_SEQUENTIAL' : 'REFINED_SAFE_PUBLICATION_BATCH_SEQUENTIAL', generated_at: now(), authorized_skus: ALLOWED.map((row) => row.sku), processed: results.length, unprocessed: ALLOWED.slice(results.length).map((row) => row.sku), counts, metrics, stop_loss: stop, selection: PHASE === '6E2' ? phaseModule.SELECTION_INFO : selectionInfo ? { ...selectionInfo.freeze, resumed: selectionInfo.resumed, exclusions: selectionInfo.exclusions.length } : null, inventory: { expected: inventory.expected, captured: inventory.captured, pages: inventory.pages, timestamp: inventory.timestamp, reliable: inventory.reliable }, results, hold: HOLD, invariants: { all_authorized_classified: results.length === SELECTED, max_authorized: results.length <= SELECTED, no_unauthorized_sku: true, writes_sequential: true, no_reprocessing: true, no_quality_calls: true, no_description_calls: true, no_competition_calls: true, protective_margin_min_percent: 50, selection_frozen: PHASE !== '6E' || Boolean(selectionInfo?.freeze?.sha256), semantic_source_count_seven: PHASE !== '6E2' || ALLOWED.length === 7, excluded_incidents_untouched: PHASE !== '6E2' || !ALLOWED.some((row) => ['VTK017508', 'VTK012864'].includes(row.sku)), vtk017508_excluded: !['6E', '6E2'].includes(PHASE) || !ALLOWED.some((row) => row.sku === 'VTK017508') } };
  writeJson(path.join(REPORT_DIR, 'summary.json'), summary);
  fs.writeFileSync(path.join(REPORT_DIR, 'batch-results.csv'), `${['index,sku,state,item_id,catalog_product_id,price,margin_percent,persisted,observation', ...results.map((row) => [row.index, row.sku, row.result, row.item_id, row.catalog_product_id, row.protective_price, row.margin_percent, row.persisted, JSON.stringify(row.observation ?? '')].map(quoteCsv).join(','))].join('\n')}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'batch-blocks.csv'), `${['sku,gate,local,evidence,sanitation', ...blocks.map((row) => [row.sku, row.result, row.expected_gtin, JSON.stringify(row.observation ?? ''), row.sanitation].map(quoteCsv).join(','))].join('\n')}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'sanitation-queue.csv'), `${['sku,gate,evidence,local_value,found_value,suggested_action', ...blocks.map((row) => [row.sku, row.result, JSON.stringify(row.observation ?? ''), row.expected_gtin, '', row.sanitation].map(quoteCsv).join(','))].join('\n')}\n`);
  const financeRows = published.map((row) => {
    const pricing = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, row.sku, 'protective-pricing.json'), 'utf8'));
    const financial = pricing.post_item?.financial || {};
    return { sku: row.sku, item_id: row.item_id, cost: pricing.cost, protective_price: row.protective_price, commission: financial.commission, shipping: financial.shipping, tax: financial.tax, protected_profit: financial.profit, margin_percent: row.margin_percent };
  });
  const total = (field) => roundMoney(financeRows.reduce((sum, row) => sum + Number(row[field] || 0), 0));
  writeJson(path.join(REPORT_DIR, 'batch-financial.json'), { generated_at: now(), target_margin_percent: 50, tax_rate: TAX_RATE, rows: financeRows, summary: { cost_total: total('cost'), price_total: total('protective_price'), commission_total: total('commission'), shipping_total: total('shipping'), tax_total: total('tax'), protected_profit_total: total('protected_profit'), min_margin: financeRows.length ? Math.min(...financeRows.map((row) => row.margin_percent)) : null, max_margin: financeRows.length ? Math.max(...financeRows.map((row) => row.margin_percent)) : null, mean_margin: financeRows.length ? roundMoney(financeRows.reduce((sum, row) => sum + Number(row.margin_percent), 0) / financeRows.length) : null } });
  writeJson(path.join(REPORT_DIR, 'batch-metrics.json'), metrics); writeJson(path.join(REPORT_DIR, 'batch-api-errors.json'), { rows: blocks.filter((row) => ['BLOCK_API_CONTRACT', 'API_TRANSIENT_ERROR'].includes(row.result)) });
  writeJson(path.join(REPORT_DIR, 'propagation-pending.csv.json'), { rows: blocks.filter((row) => row.result === 'REMOTE_PROPAGATION_PENDING') });
  fs.writeFileSync(path.join(REPORT_DIR, 'propagation-pending.csv'), `${['sku,item_id,state,problem,safe,next_action', ...blocks.filter((row) => row.result === 'REMOTE_PROPAGATION_PENDING').map((row) => [row.sku, row.item_id, row.result, JSON.stringify(row.observation ?? ''), true, 'REMOTE_LINK_REVIEW'].map(quoteCsv).join(','))].join('\n')}\n`);
  writeJson(path.join(REPORT_DIR, 'source-ledger.json'), { generated_at: now(), rows: ALLOWED.map((row) => ({ sku: row.sku, source: row.source || null, source_type: row.sourceConfidence || (/^https:\/\//.test(row.source || '') ? 'official' : row.catalogProductId || row.catalogEvidenceId ? 'ML_catalog_and_supplier' : 'supplier_or_local'), consulted_at: now(), supported_fields: row.decision === 'PASS' ? ['identity', 'GTIN', 'model_or_family'] : [], decision: row.decision })) });
  if (PHASE === '6E2') {
    const semanticRows = results.filter((row) => row.item_id).map((row) => {
      const validation = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, row.sku, 'post-semantic-validation.json'), 'utf8'));
      return { sku: row.sku, expected_category: validation.expected_category_id || null, remote_category: validation.remote_category_id || null, semantic_match: validation.passed === true };
    });
    fs.writeFileSync(path.join(REPORT_DIR, 'semantic-post-validation.csv'), `${['sku,expected_category,remote_category,semantic_match', ...semanticRows.map((row) => [row.sku, row.expected_category, row.remote_category, row.semantic_match].map(quoteCsv).join(','))].join('\n')}\n`);
  }
  if (PHASE === '6E') writeCheckpoint(results, inventory, results.length);
  writeJson(path.join(REPORT_DIR, 'full-report.json'), { ...summary, official_contracts: { user_products: 'https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products', catalog_required: 'https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/publicacoes-necessarias-do-catalogo', catalog_publish: 'https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo', attributes: 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos', conditional_attributes: 'https://developers.mercadolivre.com.br/pt_br/recurso-visits/atributos', fees: 'https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos/comissao-por-vender', shipping: 'https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/custos-de-envio', dslite: 'https://documenter.getpostman.com/view/5316990/RWaRNkaA', supabase: 'https://supabase.com/docs/guides/database/connecting-to-postgres' }, substitutions: { firecrawl: 'Codex web search/open', supabase_cloud: 'self-hosted PostgreSQL over authorized SSH' } });
}

async function main() {
  const expectedCount = PHASE === '6E2' ? 7 : PHASE === '6E' ? 200 : PHASE === '6D' ? 100 : 50;
  if (PHASE !== '6E' && (ALLOWED.length !== expectedCount || new Set(ALLOWED.map((row) => row.sku)).size !== expectedCount)) throw new Error('authorized_batch_invariant_failed');
  if (PHASE === '6E2' && typeof phaseModule.freezeSelection === 'function') phaseModule.freezeSelection(REPORT_DIR);
  const db = dbClient(); const [integrations, allProducts, allOffers] = await Promise.all([
    select(db, 'integracoes', 'tipo,url,access_token,conectado', (query) => query.in('tipo', ['mercadolivre', 'dslite'])),
    selectAll(db, 'produtos', ['6E', '6E2'].includes(PHASE) ? '*' : 'id,sku,nome,marca,gtin,estoque,custo,ativo,ml_item_id,ml_status,dslite_fornecedor_id,dslite_produto_id,oferta_preferencial_id'),
    ['6E', '6E2'].includes(PHASE) ? selectAll(db, 'produto_fornecedor_ofertas', '*') : Promise.resolve([]),
  ]);
  const byType = Object.fromEntries(integrations.map((row) => [row.tipo, row])); if (!byType.mercadolivre?.conectado || !byType.dslite?.conectado) throw new Error('AUTH_SYSTEMIC_FAILURE:integration_disconnected');
  const account = await assertAllowedMercadoLivreToken(byType.mercadolivre.access_token, `ml-p0-phase${PHASE_LOWER}`); if (Number(account.userId) !== SELLER_ID) throw new Error(`AUTH_SYSTEMIC_FAILURE:seller_${account.userId}`);
  if (PHASE === '6E') {
    selectionInfo = phaseModule.prepareSelection({ allProducts, allOffers, reportsRoot: path.resolve('reports'), reportDir: REPORT_DIR });
    ALLOWED = selectionInfo.selected; SELECTED = ALLOWED.length; metrics.selected = SELECTED;
    if (!SELECTED || SELECTED > expectedCount || new Set(ALLOWED.map((row) => row.sku)).size !== SELECTED || ALLOWED.some((row) => row.sku === 'VTK017508')) throw new Error('dynamic_selection_invariant_failed');
  }
  if (PHASE === '6E2') {
    if (ALLOWED.length !== 7 || new Set(ALLOWED.map((row) => row.sku)).size !== 7) throw new Error('ABORT_SEMANTIC_ALTERNATIVE_COUNT_DRIFT');
    if (ALLOWED.some((row) => ['VTK017508', 'VTK012864'].includes(row.sku))) throw new Error('AUTHORIZATION_SCOPE_VIOLATION');
    try { psql("select json_build_object('transaction_channel','READY','read_only_probe',true);"); }
    catch (error) { throw new Error(`AUTH_SYSTEMIC_FAILURE:persistence_channel_unavailable:${error.message}`); }
  }
  const baselineRows = allProducts.filter((row) => ALLOWED.some((config) => config.sku === row.sku)); if (baselineRows.length !== SELECTED) throw new Error(`baseline_population_mismatch:${baselineRows.length}/${SELECTED}`); const baselineMap = new Map(baselineRows.map((row) => [row.sku, row]));
  const inventory = await scanInventory(byType.mercadolivre.access_token); const results = [];
  for (let index = 0; index < ALLOWED.length; index += 1) {
    const config = ALLOWED[index]; console.log(JSON.stringify({ event: `phase${PHASE_LOWER}_sku_start`, index: index + 1, sku: config.sku, at: now() })); let row;
    if (PHASE === '6E') {
      const priorFile = path.join(REPORT_DIR, config.sku, 'summary.json');
      if (fs.existsSync(priorFile)) {
        const prior = JSON.parse(fs.readFileSync(priorFile, 'utf8'));
        if (FINAL_STATES.has(prior.result)) {
          row = prior; results.push(row); metrics.processed += 1; if (row.persisted) metrics.persisted += 1;
          console.log(JSON.stringify({ event: 'phase6e_sku_recovered', sku: config.sku, result: row.result }));
          if ((index + 1) % 25 === 0) writeCheckpoint(results, inventory, index + 1);
          continue;
        }
      }
    }
    try { row = await processSku({ db, token: byType.mercadolivre.access_token, inventory, allProducts, dsliteIntegration: byType.dslite, config, index: index + 1, baselineMap }); }
    catch (error) { const systemic = /AUTH_SYSTEMIC_FAILURE|BATCH_ABORT_REMOTE_INVENTORY_UNRELIABLE|remote_inventory_unreliable|supabase_/.test(error.message); row = finish({ index: index + 1, sku: config.sku, expected_gtin: config.gtin, started_at: now() }, config, Date.now(), 'API_TRANSIENT_ERROR', error.message); if (systemic) { stop.triggered = true; stop.reason = error.message; results.push(row); break; } }
    if (!FINAL_STATES.has(row.result)) throw new Error(`invalid_final_state:${config.sku}:${row.result}`); results.push(row); console.log(JSON.stringify({ event: `phase${PHASE_LOWER}_sku_done`, sku: config.sku, result: row.result, item_id: row.item_id || null })); const reason = stopLoss(); if (reason) { stop.triggered = true; stop.reason = reason; break; }
    if (PHASE === '6E' && (index + 1) % 25 === 0) writeCheckpoint(results, inventory, index + 1);
  }
  writeConsolidated(results, inventory); console.log(JSON.stringify({ event: `phase${PHASE_LOWER}_complete`, processed: results.length, counts: results.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] || 0) + 1 }), {}), posts: metrics.item_posts, puts: metrics.price_puts, persisted: metrics.persisted, stop_loss: stop, hold: HOLD }));
}

main().catch((error) => { const failed = { phase: PHASE, generated_at: now(), result: 'SYSTEMIC_ABORT', error: error.message, metrics, stop_loss: { ...stop, triggered: true, reason: error.message }, hold: HOLD }; writeJson(path.join(REPORT_DIR, 'summary.json'), failed); writeJson(path.join(REPORT_DIR, 'full-report.json'), failed); console.error(JSON.stringify({ event: `phase${PHASE_LOWER}_failed`, error: error.message })); process.exitCode = 1; });
