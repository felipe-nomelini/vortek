#!/usr/bin/env node
/* Phase 6A: exactly ten sequential safe-publication candidates. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  TARGET_MARGIN,
  TAX_RATE,
  attributeValue,
  buildCatalogAttributes,
  buildPersistenceSql,
  canonicalHash,
  classifyRemoteIdentity,
  extractShippingCost,
  financialAt,
  missingRequiredAttributes,
  nextProtectivePrice,
  normalize,
  normalizeGtin,
  requiredAttributeIds,
  roundMoney,
} = require('./lib/ml-p0-phase6a');

dotenv.config({ path: '.env.local', quiet: true });

const SELLER_ID = 3294514937;
const REPORT_DIR = path.resolve('reports/ml-p0-phase6a');
const HOLD = 'P0 PHASE 6A — 10 SKU SAFE PUBLICATION BATCH HOLD';
const SSH_HOST = '192.168.1.160';
const DB_CONTAINER = 'supabase-db';
const LISTING_TYPE = 'gold_special';
const ALLOWED = Object.freeze([
  { sku: 'VTK026045', gtin: '7908639903217', brand: 'C3 TECH', modelAliases: ['PH-380BK'], catalogProductId: 'MLB54158165', categoryId: 'MLB196208', familyName: 'Headset C3Tech PH-380', critical: { COLOR: ['Preto'] }, source: 'https://c3technology.com.br/fichatecnica/PH-380BK', decision: 'PASS' },
  { sku: 'VTK026046', gtin: '7898461978913', brand: 'VENTISOL', modelAliases: ['UV-04', 'UV-04 BIVOLT'], catalogProductId: 'MLB62224438', categoryId: 'MLB120425', familyName: 'Umidificador Ventisol UV-04 4 L', critical: { VOLTAGE: ['127/220V'], COLOR: ['Branco'], WATER_TANK_CAPACITY: ['4 L'] }, source: 'https://www.ventisol.com.br/umidificador/umidificador-ventisol-branco-bivolt-4-0l-nacional-mod-uv-04', decision: 'PASS' },
  { sku: 'VTK021013', gtin: '7896637609296', decision: 'BLOCK_IDENTITY', reason: 'exact_catalog_contains_technical_identity_conflicts_with_official_wired_unpowered_product', source: 'https://www.intelbras.com/pt-br/telefone-com-fio-pleno' },
  { sku: 'VTK017236', gtin: '4988028352812', decision: 'BLOCK_CATALOG_IDENTITY', reason: 'gtin_catalog_maps_to_vehicle_stereo_kit_model_6660_not_ts_1360br_speaker_pair', source: 'https://pioneer.com.br/produto/ts-1360br/' },
  { sku: 'VTK002141', gtin: '7898572866024', decision: 'BLOCK_GTIN', reason: 'local_model_pmg_10_but_exact_gtin_catalog_and_secondary_sources_identify_smg_10' },
  { sku: 'VTK026003', gtin: '7898572860541', decision: 'BLOCK_CATEGORY', reason: 'exact_catalog_domain_is_keyboard_stands_but_official_saty_product_is_slator_wall_string_instrument_support', source: 'https://saty.com.br/slatwall/' },
  { sku: 'VTK017506', gtin: '7891112359253', brand: 'TRAMONTINA', modelAliases: [], catalogProductId: 'MLB77404563', categoryId: 'MLB244658', familyName: 'Potes Tramontina MixColor 600 ml', critical: { COLOR: ['Preto'], VOLUME_CAPACITY: ['600 mL'], UNITS_PER_PACKAGE: ['3'] }, source: 'https://www.tramontina.com.br/conjunto-de-potes-tramontina-mixcolor-em-polipropileno-misto-com-tampa-transparente-600-ml-03-pecas/25099879.html', secondarySource: 'https://www.supertem.com.br/jg-pote-tramont-mixcolor-pto-3pc-600ml/p', decision: 'PASS' },
  { sku: 'VTK017211', gtin: '7898939972504', decision: 'BLOCK_CATALOG_IDENTITY', reason: 'exact_catalog_model_paptb100001_does_not_confirm_local_model_b10' },
  { sku: 'VTK025999', gtin: '6940651411548', decision: 'BLOCK_IDENTITY', reason: 'no_official_manufacturer_source_and_no_active_ml_catalog_product_confirmed' },
  { sku: 'VTK026000', gtin: '6940651411517', decision: 'BLOCK_CATALOG_IDENTITY', reason: 'catalog_identifies_acoustic_set_with_model_szste1sl_which_external_evidence_assigns_to_electric_009_042_set' },
]);

const FINAL_STATES = new Set(['SAFE_PUBLICATION_PERSIST_SUCCESS', 'SKIPPED_EXISTING_REMOTE', 'BLOCK_LOCAL_STATE', 'BLOCK_IDENTITY', 'BLOCK_GTIN', 'BLOCK_LOCAL_DUPLICATE', 'BLOCK_REMOTE_DUPLICATE', 'BLOCK_CATEGORY', 'BLOCK_CATALOG_IDENTITY', 'BLOCK_IMAGE', 'BLOCK_API_CONTRACT', 'BLOCK_PROTECTIVE_PRICE', 'BLOCK_PERSISTENCE', 'API_TRANSIENT_ERROR']);
const ARTIFACTS = ['summary.json', 'identity.json', 'duplicate-check.json', 'category-contract.json', 'payload.json', 'post-response.json', 'remote-readback.json', 'shipping.json', 'protective-pricing.json', 'price-update.json', 'local-persistence.json', 'local-remote-diff.json'];
const now = () => new Date().toISOString();
const localTime = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date()).replace(' ', 'T');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metrics = { attempted: 0, created: 0, persisted: 0, existing: 0, blocked_identity: 0, blocked_gtin: 0, blocked_duplicate: 0, blocked_contract: 0, blocked_financial: 0, api_errors: 0, ml_gets: 0, item_posts: 0, price_puts: 0, local_transactions: 0, rollbacks: 0, started_at: now() };
const stop = { structural400: 0, consecutivePricingFailures: 0, consecutivePersistenceFailures: 0, duplicateCreations: 0, wrongCatalogs: 0, triggered: false, reason: null };
let lastMlAt = 0;

fs.mkdirSync(REPORT_DIR, { recursive: true });
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function skuDir(sku) { const dir = path.join(REPORT_DIR, sku); fs.mkdirSync(dir, { recursive: true }); return dir; }
function artifact(sku, name, value) { writeJson(path.join(skuDir(sku), name), value); }
function fillArtifacts(sku, reached) { for (const name of ARTIFACTS) if (!fs.existsSync(path.join(skuDir(sku), name))) artifact(sku, name, { status: 'not_executed', reason: reached }); }

function dbClient() {
  const url = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_configuration_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function select(db, table, columns, configure) {
  let query = db.from(table).select(columns);
  if (configure) query = configure(query);
  const { data, error } = await query;
  if (error) throw new Error(`supabase_${table}:${error.message}`);
  return data || [];
}

async function selectAll(db, table, columns, configure, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = db.from(table).select(columns).range(from, from + pageSize - 1);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`supabase_${table}:${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function ml(token, resource, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT'].includes(method)) throw new Error(`ml_method_forbidden:${method}`);
  if (method === 'POST' && resource !== '/items') throw new Error(`ml_post_forbidden:${resource}`);
  if (method === 'PUT' && !/^\/items\/MLB\d+$/.test(resource)) throw new Error(`ml_put_forbidden:${resource}`);
  if (method === 'GET' && /performance|health|recommendation|description/i.test(resource)) throw new Error(`quality_or_description_forbidden:${resource}`);
  const delay = 110 - (Date.now() - lastMlAt); if (delay > 0) await sleep(delay); lastMlAt = Date.now();
  if (method === 'GET') metrics.ml_gets += 1;
  if (method === 'POST') metrics.item_posts += 1;
  if (method === 'PUT') metrics.price_puts += 1;
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers), data };
}

async function scanInventory(token) {
  const ids = []; let scrollId = ''; let expected = null; let pages = 0; const seen = new Set();
  while (pages < 1000) {
    const query = scrollId ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}` : 'search_type=scan&limit=100';
    const response = await ml(token, `/users/${SELLER_ID}/items/search?${query}`);
    if (!response.ok) throw new Error(`remote_inventory_http_${response.status}`);
    pages += 1; if (expected === null) expected = Number(response.data?.paging?.total || 0);
    const rows = (response.data?.results || []).map(String); ids.push(...rows);
    if (!rows.length || new Set(ids).size >= expected || !response.data.scroll_id || seen.has(response.data.scroll_id)) break;
    seen.add(response.data.scroll_id); scrollId = response.data.scroll_id;
  }
  const unique = [...new Set(ids)]; const items = [];
  const fields = 'id,title,status,sub_status,seller_id,seller_custom_field,user_product_id,family_id,family_name,catalog_product_id,category_id,attributes,price,available_quantity,sold_quantity,listing_type_id,catalog_listing,permalink,pictures,thumbnail,condition,shipping,date_created,last_updated';
  for (let index = 0; index < unique.length; index += 20) {
    const response = await ml(token, `/items?ids=${unique.slice(index, index + 20).join(',')}&attributes=${fields}`);
    if (!response.ok) throw new Error(`remote_inventory_multiget_${response.status}`);
    for (const row of response.data || []) if (Number(row.code) === 200 && row.body?.id) items.push(row.body);
  }
  if (unique.length !== expected || items.length !== unique.length) throw new Error(`remote_inventory_unreliable:${unique.length}/${expected}/${items.length}`);
  return { expected, captured: unique.length, pages, items, reliable: true };
}

function remoteMatches(items, config) {
  return items.filter((item) => {
    const sku = item.seller_custom_field || attributeValue(item, 'SELLER_SKU');
    return normalize(sku) === normalize(config.sku)
      || normalizeGtin(attributeValue(item, 'GTIN')) === normalizeGtin(config.gtin)
      || (config.catalogProductId && item.catalog_product_id === config.catalogProductId);
  });
}

async function dsliteProduct(integration, offer) {
  const url = `${String(integration.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`;
  const response = await fetch(url, { headers: { Token: integration.access_token }, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`dslite_http_${response.status}`);
  const product = (data?.produtos || []).find((row) => String(row.produtoid) === String(offer.dslite_produto_id)) || data?.produtos?.[0];
  if (!product) throw new Error('dslite_product_missing');
  return { url, consulted_at: now(), product };
}

function shippingDimensions(product) {
  const height = Number(product.altura_embalagem); const width = Number(product.largura_embalagem);
  const length = Number(product.profundidade_embalagem); const grams = Math.ceil(Number(product.peso_embalagem) * 1000);
  if (![height, width, length, grams].every((value) => Number.isFinite(value) && value > 0)) return null;
  return `${Math.ceil(height)}x${Math.ceil(width)}x${Math.ceil(length)},${grams}`;
}

async function auditImages(urls, limit) {
  const rows = [];
  for (const [index, url] of (urls || []).slice(0, limit).entries()) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45000) });
      const buffer = Buffer.from(await response.arrayBuffer()); const type = response.headers.get('content-type') || '';
      const metadata = response.ok && type.startsWith('image/') ? await sharp(buffer).metadata() : {};
      const approved = response.ok && type.startsWith('image/') && Number(metadata.width) >= 250 && Number(metadata.height) >= 250;
      rows.push({ index: index + 1, url, status: response.status, content_type: type, width: metadata.width || null, height: metadata.height || null, classification: approved ? 'APPROVED' : response.ok ? 'REJECT_QUALITY' : 'REJECT_ACCESS' });
    } catch (error) { rows.push({ index: index + 1, url, classification: 'REJECT_ACCESS', error: error.message }); }
  }
  return { rows, approved: rows.filter((row) => row.classification === 'APPROVED'), main_approved: rows[0]?.classification === 'APPROVED' };
}

async function quote(token, config, price, dimensions, cost, itemId = null) {
  const feeParams = new URLSearchParams({ price: Number(price).toFixed(2), category_id: config.categoryId, listing_type_id: LISTING_TYPE, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
  const feeResponse = await ml(token, `/sites/MLB/listing_prices?${feeParams}`);
  if (!feeResponse.ok) throw new Error(`fee_quote_http_${feeResponse.status}`);
  const feeRows = Array.isArray(feeResponse.data) ? feeResponse.data : [feeResponse.data];
  const fee = feeRows.find((row) => row?.listing_type_id === LISTING_TYPE) || feeRows[0];
  const shippingParams = new URLSearchParams({ ...(itemId ? { item_id: itemId } : { dimensions }), verbose: 'true', item_price: Number(price).toFixed(2), listing_type_id: LISTING_TYPE, mode: 'me2', condition: 'new', logistic_type: 'drop_off', free_shipping: 'true' });
  const shippingResponse = await ml(token, `/users/${SELLER_ID}/shipping_options/free?${shippingParams}`);
  if (!shippingResponse.ok) throw new Error(`shipping_quote_http_${shippingResponse.status}`);
  const shipping = extractShippingCost(shippingResponse.data); const commission = Number(fee?.sale_fee_amount);
  if (!Number.isFinite(shipping) || !Number.isFinite(commission)) throw new Error('financial_quote_incomplete');
  return { price: Number(price), fee, shipping_data: shippingResponse.data, financial: financialAt({ price, commission, shipping, cost }) };
}

async function protectiveQuote(token, config, dimensions, cost, itemId = null, floor = null) {
  let price = roundMoney(Math.max(Number(floor || 0), cost * 3, 99.9)); let current = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    current = await quote(token, config, price, dimensions, cost, itemId);
    if (current.financial.margin_percent >= 50.5) return { attempts: attempt, ...current, approved: true };
    const next = nextProtectivePrice({ cost, shipping: current.financial.shipping, commission: current.financial.commission, currentPrice: price });
    price = next > price ? next : roundMoney(price * 1.1);
  }
  return { attempts: 8, ...current, approved: current?.financial?.margin_percent >= 50, reason: 'iteration_limit' };
}

function catalogIdentity(result, config) {
  const fields = {
    catalog_id: result?.id === config.catalogProductId,
    strategy: result?.settings?.listing_strategy === 'catalog_required',
    gtin: normalizeGtin(attributeValue(result, 'GTIN')) === normalizeGtin(config.gtin),
    brand: normalize(attributeValue(result, 'BRAND')) === normalize(config.brand),
    model: !config.modelAliases?.length || config.modelAliases.some((value) => normalize(attributeValue(result, 'MODEL')).includes(normalize(value))),
  };
  const critical = {};
  for (const [id, aliases] of Object.entries(config.critical || {})) critical[id] = aliases.some((value) => normalize(attributeValue(result, id)) === normalize(value));
  return { fields, critical, passed: [...Object.values(fields), ...Object.values(critical)].every(Boolean) };
}

function psql(sql) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', SSH_HOST, `docker exec -i ${DB_CONTAINER} psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At`], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`psql_failed:${String(result.stderr || result.stdout).trim()}`);
  const lines = String(result.stdout || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  return lines.length ? JSON.parse(lines.at(-1)) : null;
}

function localReadback(product, itemId) {
  return psql(`select json_build_object('product',(select row_to_json(p) from (select id,sku,gtin,ml_item_id,ml_status,estoque,custo,updated_at from public.produtos where id='${product.id}'::uuid)p),'listings',coalesce((select json_agg(row_to_json(a)) from (select id,ml_item_id,produto_id,sku,titulo,tipo,preco_ml,status,catalogo,thumbnail,permalink,qualidade,qualidade_info from public.anuncios_ml where ml_item_id='${itemId}' or produto_id='${product.id}'::uuid or sku='${product.sku}')a),'[]'::json),'other_products',coalesce((select json_agg(row_to_json(p)) from (select id,sku,ml_item_id from public.produtos where id<>'${product.id}'::uuid and ml_item_id='${itemId}')p),'[]'::json));`);
}

function localRemoteDiff(local, item, product) {
  const listing = (local.listings || []).find((row) => row.ml_item_id === item.id && row.produto_id === product.id && row.sku === product.sku);
  const mapType = item.listing_type_id === 'gold_pro' || item.listing_type_id === 'gold_premium' ? 'premium' : 'classico';
  const mapStatus = item.status === 'active' ? 'ativo' : 'pausado';
  const fields = [['ml_item_id', item.id, local.product?.ml_item_id], ['sku', product.sku, listing?.sku], ['produto_id', product.id, listing?.produto_id], ['title', item.title, listing?.titulo], ['price', Number(item.price), Number(listing?.preco_ml)], ['status', mapStatus, listing?.status], ['listing_type', mapType, listing?.tipo], ['catalog', true, listing?.catalogo], ['permalink', item.permalink, listing?.permalink]].map(([field, remote, localValue]) => ({ field, remote, local: localValue, status: String(remote) === String(localValue) ? 'MATCH' : 'DIVERGENT' }));
  const unique = local.listings?.length === 1 && local.other_products?.length === 0;
  return { fields, unique, material_drift: !unique || fields.some((row) => row.status === 'DIVERGENT') };
}

function resultCounters(result) {
  if (result === 'SAFE_PUBLICATION_PERSIST_SUCCESS') metrics.persisted += 1;
  if (result === 'SKIPPED_EXISTING_REMOTE') metrics.existing += 1;
  if (result.includes('IDENTITY') || result === 'BLOCK_CATEGORY' || result === 'BLOCK_CATALOG_IDENTITY') metrics.blocked_identity += 1;
  if (result === 'BLOCK_GTIN') metrics.blocked_gtin += 1;
  if (result.includes('DUPLICATE')) metrics.blocked_duplicate += 1;
  if (result === 'BLOCK_API_CONTRACT') metrics.blocked_contract += 1;
  if (result === 'BLOCK_PROTECTIVE_PRICE') metrics.blocked_financial += 1;
  if (result === 'API_TRANSIENT_ERROR') metrics.api_errors += 1;
}

async function processSku({ db, token, inventory, allProducts, dsliteIntegration, config, index }) {
  const started = Date.now(); metrics.attempted += 1;
  const [products, listingRows] = await Promise.all([
    select(db, 'produtos', '*', (query) => query.eq('sku', config.sku).limit(2)),
    select(db, 'anuncios_ml', '*', (query) => query.eq('sku', config.sku)),
  ]);
  const product = products[0];
  const offers = product ? await select(db, 'produto_fornecedor_ofertas', '*', (query) => query.eq('produto_id', product.id)) : [];
  const offer = offers.find((row) => row.id === product?.oferta_preferencial_id) || null;
  const base = { index, sku: config.sku, started_at: now(), local_time: localTime(), expected_gtin: config.gtin };
  let result = null; let observation = null;
  if (!product || products.length !== 1 || product.ativo !== true || Number(product.estoque) <= 0 || Number(product.custo) <= 0 || product.ml_item_id || product.ml_status !== 'sem_anuncio' || !offer) {
    result = 'BLOCK_LOCAL_STATE'; observation = 'local_product_or_preferred_offer_gate_failed';
  }
  const dslite = product && offer ? await dsliteProduct(dsliteIntegration, offer).catch((error) => ({ error: error.message })) : null;
  const localDuplicates = product ? allProducts.filter((row) => row.id !== product.id && (normalizeGtin(row.gtin) === normalizeGtin(config.gtin) || (row.dslite_fornecedor_id && row.dslite_fornecedor_id === product.dslite_fornecedor_id && row.dslite_produto_id === product.dslite_produto_id))) : [];
  const existingRemote = remoteMatches(inventory.items, config);
  artifact(config.sku, 'duplicate-check.json', { checked_at: now(), inventory: { expected: inventory.expected, captured: inventory.captured, pages: inventory.pages, reliable: inventory.reliable }, local_duplicates: localDuplicates.map((row) => ({ id: row.id, sku: row.sku, nome: row.nome, gtin: row.gtin })), remote_matches: existingRemote.map((row) => ({ id: row.id, status: row.status, sku: row.seller_custom_field || attributeValue(row, 'SELLER_SKU'), gtin: attributeValue(row, 'GTIN'), catalog_product_id: row.catalog_product_id, title: row.title })) });
  if (!result && normalizeGtin(product.gtin) !== normalizeGtin(config.gtin)) { result = 'BLOCK_GTIN'; observation = 'local_gtin_drift'; }
  if (!result && localDuplicates.length) { result = 'BLOCK_LOCAL_DUPLICATE'; observation = 'same_physical_identity_in_local_catalog'; }
  if (!result && existingRemote.length) { result = 'SKIPPED_EXISTING_REMOTE'; observation = 'equivalent_remote_item_already_exists'; }

  const productSearch = await ml(token, `/products/search?status=active&site_id=MLB&product_identifier=${config.gtin}`);
  const exactResults = productSearch.ok ? productSearch.data?.results || [] : [];
  artifact(config.sku, 'identity.json', { ...base, product, preferred_offer: offer, dslite, configured_decision: config.decision, configured_reason: config.reason || null, evidence: { manufacturer_or_official: config.source || null, secondary: config.secondarySource || null, supplier: dslite?.url || null, ml_exact_lookup: `/products/search?status=active&site_id=MLB&product_identifier=${config.gtin}` }, catalog_results: exactResults });
  if (!result && config.decision !== 'PASS') { result = config.decision; observation = config.reason; }
  if (result) {
    const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: existingRemote[0]?.id || null, catalog_product_id: exactResults[0]?.id || null, protective_price: null, margin_percent: null, persisted: false, observation, backlogs: { quality_optimization_pending: false, description_optimization_pending: false, commercial_optimization_pending: false } };
    artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); resultCounters(result); return summary;
  }

  const catalogResult = exactResults.find((row) => row.id === config.catalogProductId);
  const identity = catalogIdentity(catalogResult, config);
  if (!catalogResult || !identity.passed) {
    result = 'BLOCK_CATALOG_IDENTITY'; observation = 'catalog_exact_identity_gate_failed';
  }
  const [catalogDetail, categoryResponse, categoryAttrsResponse] = result ? [{}, {}, {}] : await Promise.all([
    ml(token, `/products/${config.catalogProductId}`), ml(token, `/categories/${config.categoryId}`), ml(token, `/categories/${config.categoryId}/attributes`),
  ]);
  const category = categoryResponse.data; const categoryAttrs = categoryAttrsResponse.data || [];
  if (!result && (!catalogDetail.ok || !categoryResponse.ok || !categoryAttrsResponse.ok || category?.settings?.status !== 'enabled' || category?.settings?.listing_allowed !== true || category?.settings?.catalog_domain !== catalogResult.domain_id)) { result = 'BLOCK_CATEGORY'; observation = 'category_contract_or_catalog_domain_invalid'; }
  const attributes = result ? [] : buildCatalogAttributes(catalogResult, categoryAttrs, config.sku);
  const requiredIds = result ? [] : requiredAttributeIds(categoryAttrs);
  const missing = result ? [] : missingRequiredAttributes(attributes, requiredIds);
  artifact(config.sku, 'category-contract.json', { checked_at: now(), category, catalog_product: catalogDetail.data || null, catalog_search_identity: identity, required_ids: requiredIds, missing_required: missing, listing_strategy: catalogResult?.settings?.listing_strategy, endpoint: 'POST /items', user_products: { family_name: 'required', title: 'prohibited', description: 'separate_not_executed' } });
  if (!result && missing.length) { result = 'BLOCK_API_CONTRACT'; observation = `required_attributes_missing:${missing.join(',')}`; }
  const imageAudit = result ? { rows: [], approved: [], main_approved: false } : await auditImages(product.imagens, Number(category?.settings?.max_pictures_per_item || 12));
  if (!result && (!imageAudit.main_approved || !imageAudit.approved.length)) { result = 'BLOCK_IMAGE'; observation = 'no_valid_primary_image'; }
  const dimensions = dslite?.product ? shippingDimensions(dslite.product) : null;
  if (!result && !dimensions) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = 'supplier_shipping_dimensions_missing'; }
  const reservations = product ? await select(db, 'pedido_itens', 'pedido_id,seller_sku,quantidade', (query) => query.ilike('seller_sku', config.sku)) : [];
  const orderIds = [...new Set(reservations.map((row) => row.pedido_id).filter(Boolean))];
  const orders = orderIds.length ? await select(db, 'pedidos', 'id,situacao', (query) => query.in('id', orderIds)) : [];
  const reserving = new Set(['aberto', 'pendente', 'faturado']); const orderMap = new Map(orders.map((row) => [row.id, row]));
  const reserved = reservations.filter((row) => reserving.has(orderMap.get(row.pedido_id)?.situacao)).reduce((sum, row) => sum + Number(row.quantidade || 0), 0);
  const stock = dslite?.product ? Math.max(0, Math.min(Number(product.estoque), Number(offer.estoque), Number(dslite.product.estoque)) - reserved) : 0;
  if (!result && stock <= 0) { result = 'BLOCK_LOCAL_STATE'; observation = 'publishable_stock_zero'; }
  const cost = Number(offer?.custo ?? product?.custo);
  const preQuote = result ? null : await protectiveQuote(token, config, dimensions, cost).catch((error) => ({ approved: false, error: error.message }));
  if (!result && !preQuote?.approved) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = preQuote?.error || preQuote?.reason || 'pre_item_protective_quote_failed'; }
  artifact(config.sku, 'shipping.json', { dimensions, source: 'DSLITE_SUPPLIER_PACKAGE', pre_item: preQuote?.shipping_data || null, post_item: null });
  artifact(config.sku, 'protective-pricing.json', { tax_rate: TAX_RATE, target_margin_percent: 50, safety_target_percent: 50.5, cost, pre_item: preQuote });
  if (result) {
    const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: null, catalog_product_id: config.catalogProductId, protective_price: preQuote?.financial?.price || null, margin_percent: preQuote?.financial?.margin_percent || null, persisted: false, observation, backlogs: { quality_optimization_pending: false, description_optimization_pending: false, commercial_optimization_pending: false } };
    artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); resultCounters(result); return summary;
  }

  const pictures = imageAudit.approved.map((row) => ({ source: row.url }));
  const payload = { family_name: config.familyName, category_id: config.categoryId, catalog_product_id: config.catalogProductId, catalog_listing: true, price: preQuote.financial.price, currency_id: 'BRL', available_quantity: stock, buying_mode: 'buy_it_now', listing_type_id: LISTING_TYPE, condition: 'new', pictures, attributes, shipping: { mode: 'me2', local_pick_up: false, free_shipping: true }, seller_custom_field: config.sku };
  const payloadHash = canonicalHash(payload);
  artifact(config.sku, 'payload.json', { payload, sha256: payloadHash, title_absent: !('title' in payload), description_absent: !('description' in payload), attributes_count: attributes.length, pictures_count: pictures.length });

  const immediateSku = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`);
  const catalogOffers = await ml(token, `/products/${config.catalogProductId}/items?limit=100`);
  const catalogHasNoOffers = catalogOffers.status === 404 && catalogOffers.data?.message === 'No winners found';
  const concurrentCatalog = (catalogOffers.data?.results || []).filter((row) => Number(row.seller_id) === SELLER_ID);
  if (!immediateSku.ok || (!catalogOffers.ok && !catalogHasNoOffers)) { result = 'API_TRANSIENT_ERROR'; observation = 'immediate_duplicate_gate_unavailable'; }
  else if ((immediateSku.data?.results || []).length || concurrentCatalog.length) { result = 'BLOCK_REMOTE_DUPLICATE'; observation = 'equivalent_remote_created_after_inventory_snapshot'; }
  if (result) {
    const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: null, catalog_product_id: config.catalogProductId, protective_price: payload.price, margin_percent: preQuote.financial.margin_percent, persisted: false, observation };
    artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); resultCounters(result); return summary;
  }

  const postStarted = Date.now(); const post = await ml(token, '/items', { method: 'POST', body: payload });
  artifact(config.sku, 'post-response.json', { attempted_at: now(), local_time: localTime(), endpoint: 'POST /items', request_id: post.headers['x-request-id'] || post.headers['x-requestid'] || null, http_status: post.status, elapsed_ms: Date.now() - postStarted, payload_sha256: payloadHash, body: post.data });
  let itemId = post.data?.id || null;
  if (post.status === 400) { stop.structural400 += 1; result = 'BLOCK_API_CONTRACT'; observation = post.data; }
  else if (post.status >= 500) {
    await sleep(1000); const ghost = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`); itemId = ghost.data?.results?.[0] || null;
    if (!itemId) { result = 'API_TRANSIENT_ERROR'; observation = post.data; }
  } else if (post.status !== 201 || !itemId) { result = 'BLOCK_API_CONTRACT'; observation = post.data; }
  if (result) {
    const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: itemId, catalog_product_id: config.catalogProductId, protective_price: payload.price, margin_percent: preQuote.financial.margin_percent, persisted: false, observation };
    artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); resultCounters(result); return summary;
  }
  metrics.created += 1;

  let read = await ml(token, `/items/${itemId}?include_internal_attributes=true`); let item = read.data;
  const expected = { ...config, sellerId: SELLER_ID, quantity: stock, listingTypeId: LISTING_TYPE };
  let remoteIdentity = classifyRemoteIdentity(item, expected);
  if (!read.ok || !remoteIdentity.passed || !['active', 'paused', 'under_review'].includes(item.status)) { result = 'BLOCK_IDENTITY'; observation = { remoteIdentity, status: item?.status }; if (item?.catalog_product_id !== config.catalogProductId) stop.wrongCatalogs += 1; }
  if (result) {
    artifact(config.sku, 'remote-readback.json', { item, identity: remoteIdentity });
    const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: itemId, catalog_product_id: item?.catalog_product_id, protective_price: item?.price, margin_percent: null, persisted: false, observation };
    artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); resultCounters(result); return summary;
  }

  let postQuote = await quote(token, config, Number(item.price), dimensions, cost, itemId).catch((error) => ({ error: error.message }));
  let priceUpdate = { executed: false, reason: 'not_required' };
  if (!postQuote.financial || postQuote.financial.margin_percent < 50) {
    const reprotected = await protectiveQuote(token, config, dimensions, cost, itemId, Number(item.price)).catch((error) => ({ approved: false, error: error.message }));
    if (!reprotected.approved) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = reprotected; stop.consecutivePricingFailures += 1; }
    else {
      const update = await ml(token, `/items/${itemId}`, { method: 'PUT', body: { price: reprotected.financial.price } });
      priceUpdate = { executed: true, endpoint: `PUT /items/${itemId}`, request_id: update.headers['x-request-id'] || null, http_status: update.status, body: update.data, target: reprotected };
      if (!update.ok) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = update.data; stop.consecutivePricingFailures += 1; }
      else { read = await ml(token, `/items/${itemId}?include_internal_attributes=true`); item = read.data; postQuote = await quote(token, config, Number(item.price), dimensions, cost, itemId); }
    }
  }
  artifact(config.sku, 'price-update.json', priceUpdate);
  artifact(config.sku, 'shipping.json', { dimensions, source: 'DSLITE_SUPPLIER_PACKAGE', pre_item: preQuote.shipping_data, post_item: postQuote.shipping_data || null });
  artifact(config.sku, 'protective-pricing.json', { tax_rate: TAX_RATE, target_margin_percent: 50, safety_target_percent: 50.5, cost, pre_item: preQuote, post_item: postQuote, approved: postQuote.financial?.margin_percent >= 50 });
  if (!result && postQuote.financial?.margin_percent < 50) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = postQuote; stop.consecutivePricingFailures += 1; }
  else if (!result) stop.consecutivePricingFailures = 0;
  remoteIdentity = classifyRemoteIdentity(item, expected);
  artifact(config.sku, 'remote-readback.json', { checked_at: now(), item, identity: remoteIdentity, image_normalization: item.pictures?.every((picture) => /mlstatic\.com/.test(picture.secure_url || picture.url || '')) ? 'IMAGE_NORMALIZED_BY_ML' : 'SOURCE_PRESERVED' });
  if (!result && !remoteIdentity.passed) { result = 'BLOCK_IDENTITY'; observation = remoteIdentity; }
  if (result) {
    const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: itemId, catalog_product_id: item.catalog_product_id, protective_price: item.price, margin_percent: postQuote.financial?.margin_percent || null, persisted: false, observation };
    artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); resultCounters(result); return summary;
  }

  try {
    metrics.local_transactions += 1;
    const transaction = psql(buildPersistenceSql({ product, item }));
    const local = localReadback(product, itemId); const diff = localRemoteDiff(local, item, product);
    artifact(config.sku, 'local-persistence.json', { executed: true, transaction, quality_score_not_evaluated: true, quality_optimization_pending: true, description_optimization_pending: true, commercial_optimization_pending: true });
    artifact(config.sku, 'local-remote-diff.json', diff);
    if (diff.material_drift) { result = 'BLOCK_PERSISTENCE'; observation = diff; stop.consecutivePersistenceFailures += 1; }
    else { result = 'SAFE_PUBLICATION_PERSIST_SUCCESS'; stop.consecutivePersistenceFailures = 0; inventory.items.push(item); }
  } catch (error) {
    metrics.rollbacks += 1; stop.consecutivePersistenceFailures += 1; result = 'BLOCK_PERSISTENCE'; observation = error.message;
    artifact(config.sku, 'local-persistence.json', { executed: true, committed: false, error: error.message });
  }
  const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: itemId, user_product_id: item.user_product_id, family_id: item.family_id, catalog_product_id: item.catalog_product_id, protective_price: Number(item.price), margin_percent: postQuote.financial.margin_percent, persisted: result === 'SAFE_PUBLICATION_PERSIST_SUCCESS', observation, backlogs: { quality_optimization_pending: true, description_optimization_pending: true, commercial_optimization_pending: true, optional_catalog_optimization_pending: false } };
  artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); resultCounters(result); return summary;
}

function stopLoss() {
  if (stop.duplicateCreations >= 2) return 'DUPLICATE_CREATION_SYSTEMIC';
  if (stop.wrongCatalogs >= 2) return 'WRONG_CATALOG_SYSTEMIC';
  if (stop.consecutivePricingFailures >= 2) return 'PROTECTIVE_PRICING_SYSTEMIC_FAILURE';
  if (stop.consecutivePersistenceFailures >= 2) return 'PERSISTENCE_SYSTEMIC_FAILURE';
  if (stop.structural400 >= 3) return 'PAYLOAD_SYSTEMIC_ERROR';
  return null;
}

async function main() {
  if (ALLOWED.length !== 10 || new Set(ALLOWED.map((row) => row.sku)).size !== 10) throw new Error('authorized_batch_invariant_failed');
  const db = dbClient();
  const [integrations, allProducts] = await Promise.all([
    select(db, 'integracoes', 'tipo,url,access_token,conectado', (query) => query.in('tipo', ['mercadolivre', 'dslite'])),
    selectAll(db, 'produtos', 'id,sku,nome,marca,gtin,estoque,custo,ativo,ml_item_id,ml_status,dslite_fornecedor_id,dslite_produto_id,oferta_preferencial_id', (query) => query.order('id')),
  ]);
  const byType = Object.fromEntries(integrations.map((row) => [row.tipo, row]));
  if (!byType.mercadolivre?.conectado || !byType.dslite?.conectado) throw new Error('AUTH_SYSTEMIC_FAILURE:integration_disconnected');
  const account = await assertAllowedMercadoLivreToken(byType.mercadolivre.access_token, 'ml-p0-phase6a');
  if (Number(account.userId) !== SELLER_ID) throw new Error(`AUTH_SYSTEMIC_FAILURE:seller_${account.userId}`);
  const inventory = await scanInventory(byType.mercadolivre.access_token);
  const results = [];
  for (let index = 0; index < ALLOWED.length; index += 1) {
    const config = ALLOWED[index];
    console.log(JSON.stringify({ event: 'phase6a_sku_start', index: index + 1, sku: config.sku, at: now() }));
    let row;
    try { row = await processSku({ db, token: byType.mercadolivre.access_token, inventory, allProducts, dsliteIntegration: byType.dslite, config, index: index + 1 }); }
    catch (error) {
      const systemic = /AUTH_SYSTEMIC_FAILURE|remote_inventory_unreliable|supabase_/.test(error.message);
      row = { index: index + 1, sku: config.sku, result: systemic ? 'API_TRANSIENT_ERROR' : 'API_TRANSIENT_ERROR', error: error.message, item_id: null, persisted: false, elapsed_ms: 0 };
      artifact(config.sku, 'summary.json', row); fillArtifacts(config.sku, row.result); resultCounters(row.result);
      if (systemic) { stop.triggered = true; stop.reason = error.message; results.push(row); break; }
    }
    if (!FINAL_STATES.has(row.result)) throw new Error(`invalid_final_state:${config.sku}:${row.result}`);
    results.push(row); console.log(JSON.stringify({ event: 'phase6a_sku_done', sku: config.sku, result: row.result, item_id: row.item_id || null }));
    const reason = stopLoss(); if (reason) { stop.triggered = true; stop.reason = reason; break; }
  }
  metrics.completed_at = now(); metrics.elapsed_ms = Date.now() - Date.parse(metrics.started_at); metrics.mean_sku_ms = results.length ? Math.round(results.reduce((sum, row) => sum + Number(row.elapsed_ms || 0), 0) / results.length) : 0;
  const counts = results.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] || 0) + 1 }), {});
  const financial = results.filter((row) => row.item_id).map((row) => ({ sku: row.sku, item_id: row.item_id, protective_price: row.protective_price, margin_percent: row.margin_percent }));
  const summary = { phase: '6A', mode: 'SAFE_PUBLICATION_BATCH_SEQUENTIAL', generated_at: now(), authorized_skus: ALLOWED.map((row) => row.sku), processed: results.length, unprocessed: ALLOWED.slice(results.length).map((row) => row.sku), counts, stop_loss: stop, metrics, results, hold: HOLD, invariants: { max_ten: results.length <= 10, sequential: true, second_batch: false, no_quality_calls: true, no_description_calls: true, tax_rate: TAX_RATE, protective_margin_min_percent: TARGET_MARGIN * 100 } };
  writeJson(path.join(REPORT_DIR, 'summary.json'), summary);
  const csv = ['index,sku,state,item_id,catalog_product_id,protective_price,margin_percent,persisted,observation', ...results.map((row) => [row.index, row.sku, row.result, row.item_id || '', row.catalog_product_id || '', row.protective_price ?? '', row.margin_percent ?? '', row.persisted === true, JSON.stringify(row.observation ?? '')].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
  fs.writeFileSync(path.join(REPORT_DIR, 'batch-results.csv'), `${csv}\n`);
  writeJson(path.join(REPORT_DIR, 'batch-financial.json'), { generated_at: now(), target_margin_percent: 50, tax_rate: TAX_RATE, rows: financial });
  writeJson(path.join(REPORT_DIR, 'batch-errors.json'), { generated_at: now(), rows: results.filter((row) => row.result !== 'SAFE_PUBLICATION_PERSIST_SUCCESS' && row.result !== 'SKIPPED_EXISTING_REMOTE') });
  writeJson(path.join(REPORT_DIR, 'batch-metrics.json'), metrics);
  writeJson(path.join(REPORT_DIR, 'full-report.json'), { ...summary, inventory: { expected: inventory.expected, captured: inventory.captured, pages: inventory.pages, reliable: inventory.reliable }, official_contracts: { user_products: 'https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products', items: 'https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos', catalog_required: 'https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/publicacoes-necessarias-do-catalogo', catalog_publish: 'https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo', attributes: 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos', item_search: 'https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/itens-e-buscas', fees: 'https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos/comissao-por-vender', shipping: 'https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/custos-de-envio', dslite: 'https://documenter.getpostman.com/view/5316990/RWaRNkaA', supabase: 'https://supabase.com/docs/guides/database/connecting-to-postgres' }, substitutions: { firecrawl: 'Codex web search/open', supabase_cloud: 'self_hosted direct PostgreSQL over authorized SSH' } });
  console.log(JSON.stringify({ event: 'phase6a_complete', processed: results.length, counts, stop_loss: stop, item_posts: metrics.item_posts, price_puts: metrics.price_puts, persisted: metrics.persisted, hold: HOLD }));
}

main().catch((error) => {
  const failed = { phase: '6A', generated_at: now(), result: 'SYSTEMIC_ABORT', error: error.message, metrics, stop_loss: { ...stop, triggered: true, reason: error.message }, hold: HOLD };
  writeJson(path.join(REPORT_DIR, 'summary.json'), failed); writeJson(path.join(REPORT_DIR, 'full-report.json'), failed);
  console.error(JSON.stringify({ event: 'phase6a_failed', error: error.message })); process.exitCode = 1;
});
