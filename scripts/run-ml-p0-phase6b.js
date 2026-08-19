#!/usr/bin/env node
/* Phase 6B: exactly twenty sequential safe-publication candidates. */
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
  canonicalHash,
  extractShippingCost,
  financialAt,
  missingRequiredAttributes,
  nextProtectivePrice,
  normalize,
  normalizeGtin,
  requiredAttributeIds,
  roundMoney,
} = require('./lib/ml-p0-phase6a');
const {
  buildManualAttributes,
  buildPersistenceSql,
  classifyRemoteIdentity,
  entityHasGtin,
} = require('./lib/ml-p0-phase6b');

dotenv.config({ path: '.env.local', quiet: true });

const SELLER_ID = 3294514937;
const REPORT_DIR = path.resolve('reports/ml-p0-phase6b');
const HOLD = 'P0 PHASE 6B — 20 SKU SAFE PUBLICATION BATCH HOLD';
const SSH_HOST = '192.168.1.160';
const DB_CONTAINER = 'supabase-db';
const LISTING_TYPE = 'gold_special';
const ALLOWED = Object.freeze([
  { sku: 'VTK013008', gtin: '7898640365206', brand: 'Wireconex', modelAliases: ['cabo para guitarra'], catalogProductId: 'MLB41877035', categoryId: 'MLB420707', familyName: 'Conector P10 Mono Wireconex WC153 Kit 10', critical: { COLOR: ['Preto'], UNITS_PER_PACK: ['10'] }, source: 'DSLITE supplier SKU + exact ML catalog GTIN', decision: 'PASS' },
  { sku: 'VTK013007', gtin: '7898640365176', brand: 'Wireconex', modelAliases: ['Modelo Desconhecido'], catalogProductId: 'MLB49706888', categoryId: 'MLB420707', familyName: 'Conector P10 Stereo Wireconex WC244 Kit 10', critical: { COLOR: ['Prateado'], UNITS_PER_PACK: ['10'] }, source: 'DSLITE supplier SKU + exact ML catalog GTIN', decision: 'PASS' },
  { sku: 'VTK013088', gtin: '7898566200308', decision: 'BLOCK_CATEGORY', reason: 'exact_catalog_has_no_reliable_category_and_domain_discovery_maps_to_incompatible_portable_satellite_kit', source: 'DSLITE supplier + ML catalog MLB62704096' },
  { sku: 'VTK013087', gtin: '7898566200278', decision: 'BLOCK_CATEGORY', reason: 'no_exact_catalog_and_domain_discovery_maps_divider_to_incompatible_portable_satellite_kit', source: 'DSLITE supplier' },
  { sku: 'VTK017504', gtin: '7891112359222', brand: 'Tramontina', modelAliases: [], catalogProductId: 'MLB76738398', categoryId: 'MLB244658', familyName: 'Potes Tramontina MixColor 300 ml', critical: { COLOR: ['Preto'], VOLUME_CAPACITY: ['300 mL'], UNITS_PER_PACKAGE: ['3'] }, source: 'Tramontina MixColor official line + exact ML catalog GTIN', decision: 'PASS' },
  { sku: 'VTK017505', gtin: '7891112359246', brand: 'Tramontina', modelAliases: [], catalogProductId: null, categoryId: 'MLB244658', domainId: 'MLB-FOOD_STORAGE_CONTAINERS', familyName: 'Potes Tramontina MixColor 300 ml', critical: { COLOR: ['Vermelho'], VOLUME_CAPACITY: ['300 mL'], UNITS_PER_PACKAGE: ['3'] }, source: 'https://www.tramontina.com.br/', secondarySource: 'exact GTIN supplier evidence', manualAttributes: [{ id: 'BRAND', value_name: 'Tramontina' }, { id: 'GTIN', value_name: '7891112359246' }, { id: 'COLOR', value_id: '51993', value_name: 'Vermelho' }, { id: 'MAIN_COLOR', value_id: '2450307', value_name: 'Vermelho' }, { id: 'VOLUME_CAPACITY', value_name: '300 mL' }, { id: 'UNITS_PER_PACKAGE', value_name: '3' }, { id: 'MATERIAL', value_id: '2748302', value_name: 'Plástico' }], decision: 'PASS' },
  { sku: 'VTK017507', gtin: '7891112359277', brand: 'Tramontina', modelAliases: [], catalogProductId: null, categoryId: 'MLB244658', domainId: 'MLB-FOOD_STORAGE_CONTAINERS', familyName: 'Potes Tramontina MixColor 600 ml', critical: { COLOR: ['Vermelho'], VOLUME_CAPACITY: ['600 mL'], UNITS_PER_PACKAGE: ['3'] }, source: 'https://www.tramontina.com.br/', secondarySource: 'exact GTIN supplier evidence', manualAttributes: [{ id: 'BRAND', value_name: 'Tramontina' }, { id: 'GTIN', value_name: '7891112359277' }, { id: 'COLOR', value_id: '51993', value_name: 'Vermelho' }, { id: 'MAIN_COLOR', value_id: '2450307', value_name: 'Vermelho' }, { id: 'VOLUME_CAPACITY', value_name: '600 mL' }, { id: 'UNITS_PER_PACKAGE', value_name: '3' }, { id: 'MATERIAL', value_id: '2748302', value_name: 'Plástico' }], decision: 'PASS' },
  { sku: 'VTK019632', gtin: '7899471878941', brand: 'MXT', modelAliases: ['9v 1a'], catalogProductId: 'MLB32967972', categoryId: 'MLB420411', familyName: 'Fonte Chaveada MXT 9V 1A', critical: {}, source: 'DSLITE supplier + exact ML catalog GTIN', decision: 'PASS' },
  { sku: 'VTK017698', gtin: '7899471878965', decision: 'BLOCK_GTIN', reason: 'exact_gtin_catalog_identifies_lomes_product_instead_of_local_mxt_12v_2a', source: 'ML catalog MLB30453141' },
  { sku: 'VTK017336', gtin: '7898597131879', decision: 'BLOCK_IDENTITY', reason: 'manufacturer_identity_not_available_for_evus_p10_to_xlr_cable', source: 'DSLITE supplier only' },
  { sku: 'VTK026043', gtin: '7908324703320', brand: 'MXT', modelAliases: ['40cm'], catalogProductId: 'MLB26209409', categoryId: 'MLB235632', familyName: 'Abraçadeira Nylon MXT 40 cm Kit 100', critical: { COLOR: ['Preto'], UNITS_PER_PACKAGE: ['100'], LENGTH: ['40 cm'], WIDTH: ['4.8 mm'] }, source: 'DSLITE supplier + exact ML catalog GTIN', decision: 'PASS' },
  { sku: 'VTK026047', gtin: '097855181145', brand: 'Logitech', modelAliases: ['M110'], catalogProductId: 'MLB24551741', categoryId: 'MLB1714', familyName: 'Mouse Logitech M110 Silent Cinza', critical: { COLOR: ['Cinza'] }, source: 'https://www.logitech.com/pt-br/products/mice/m110-silent-corded-mouse.910-006759.html', decision: 'PASS' },
  { sku: 'VTK026048', gtin: '7897748700032', decision: 'BLOCK_GTIN', reason: 'exact_gtin_catalog_identifies_pioneer_radio_bundle_not_stetsom_control_alone', source: 'https://www.stetsom.com.br/produto/sx-wr/' },
  { sku: 'VTK017376', gtin: '7898419499132', brand: 'Proeletronic', modelAliases: ['Suporte Antena Externa'], catalogProductId: 'MLB21469644', categoryId: 'MLB11529', familyName: 'Mastro Proeletronic KTAA-2000', critical: {}, source: 'https://proeletronic.com.br/mastro-ktaa-2000/', decision: 'PASS' },
  { sku: 'VTK026007', gtin: '7898572882208', decision: 'BLOCK_IDENTITY', reason: 'official_saty_model_bgt_15_conflicts_with_local_and_catalog_gbt_15', source: 'https://saty.com.br/gakki/' },
  { sku: 'VTK026008', gtin: '7898572863009', decision: 'BLOCK_CATEGORY', reason: 'exact_catalog_domain_and_category_are_microphone_stands_but_product_is_wall_speaker_support', source: 'ML catalog MLB26686272' },
  { sku: 'VTK012909', gtin: '7898946772609', decision: 'BLOCK_GTIN', reason: 'exact_gtin_catalog_identifies_jpg_folk_guitar_cover_not_bkr1_classical_cover', source: 'ML catalog MLB33678717' },
  { sku: 'VTK017562', gtin: '7897013561269', brand: 'Elgin', modelAliases: ['46RCV2USB000'], catalogProductId: null, categoryId: 'MLB430121', domainId: 'MLB-MOBILE_DEVICE_CHARGERS', familyName: 'Carregador Veicular USB Elgin 2 Saídas', critical: { CONNECTOR_TYPE: ['USB'], INPUT_VOLTAGE: ['12V'], OUTPUT_VOLTAGE: ['5V'] }, source: 'https://www.elgin.com.br/', secondarySource: 'Elgin official catalog reference 46RCV2USB000', manualAttributes: [{ id: 'BRAND', value_name: 'Elgin' }, { id: 'MODEL', value_name: '46RCV2USB000' }, { id: 'GTIN', value_name: '7897013561269' }, { id: 'CONNECTOR_TYPE', value_id: '82230', value_name: 'USB' }, { id: 'INPUT_VOLTAGE', value_name: '12V' }, { id: 'OUTPUT_VOLTAGE', value_id: '2453518', value_name: '5V' }, { id: 'CHARGING_PORTS', value_name: '2' }], decision: 'PASS' },
  { sku: 'VTK017630', gtin: '7898911419904', decision: 'BLOCK_GTIN', reason: 'exact_gtin_catalog_identifies_peccinin_gate_motor_not_sulton_spw_700_sensor', source: 'https://sulton.com.br/produto/spw-700/' },
  { sku: 'VTK017637', gtin: '7898911419775', brand: 'Sulton', modelAliases: ['CLS 1400'], catalogProductId: 'MLB21757400', categoryId: 'MLB7070', familyName: 'Central de Alarme Sulton CLS 1400', critical: {}, source: 'https://sulton.com.br/produto/cls-1400/', decision: 'PASS' },
]);

const FINAL_STATES = new Set(['SAFE_PUBLICATION_PERSIST_SUCCESS', 'SKIPPED_EXISTING_REMOTE', 'BLOCK_LOCAL_STATE', 'BLOCK_IDENTITY', 'BLOCK_GTIN', 'BLOCK_LOCAL_DUPLICATE', 'BLOCK_REMOTE_DUPLICATE', 'BLOCK_CATEGORY', 'BLOCK_CATALOG_IDENTITY', 'BLOCK_IMAGE', 'BLOCK_API_CONTRACT', 'BLOCK_PROTECTIVE_PRICE', 'BLOCK_PERSISTENCE', 'API_TRANSIENT_ERROR']);
const ARTIFACTS = ['summary.json', 'identity.json', 'gtin.json', 'duplicate-check.json', 'category-contract.json', 'catalog-validation.json', 'payload.json', 'post-response.json', 'remote-readback.json', 'shipping.json', 'protective-pricing.json', 'price-update.json', 'local-persistence.json', 'local-remote-diff.json'];
const now = () => new Date().toISOString();
const localTime = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date()).replace(' ', 'T');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metrics = { selected: 20, processed: 0, created: 0, persisted: 0, existing: 0, blocked: 0, ml_gets: 0, item_posts: 0, price_puts: 0, local_reads: 0, local_transactions: 0, rollbacks: 0, source_lookups: 0, started_at: now() };
const stop = { structural400Fingerprints: {}, consecutivePricingFailures: 0, consecutivePersistenceFailures: 0, duplicateCreations: 0, wrongCatalogs: 0, triggered: false, reason: null };
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
  if (method === 'GET' && /performance|health|recommendation|description|price_to_win|buy_box/i.test(resource)) throw new Error(`out_of_scope_read_forbidden:${resource}`);
  const delay = 110 - (Date.now() - lastMlAt); if (delay > 0) await sleep(delay); lastMlAt = Date.now();
  if (method === 'GET') metrics.ml_gets += 1;
  if (method === 'POST') metrics.item_posts += 1;
  if (method === 'PUT') metrics.price_puts += 1;
  const response = await fetch(`https://api.mercadolibre.com${resource}`, { method, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(60000) });
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
      || entityHasGtin(item, config.gtin)
      || (config.catalogProductId && item.catalog_product_id === config.catalogProductId);
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
  const height = Number(product.altura_embalagem); const width = Number(product.largura_embalagem); const length = Number(product.profundidade_embalagem); const grams = Math.ceil(Number(product.peso_embalagem) * 1000);
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
  const feeRows = Array.isArray(feeResponse.data) ? feeResponse.data : [feeResponse.data]; const fee = feeRows.find((row) => row?.listing_type_id === LISTING_TYPE) || feeRows[0];
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
  const fields = { catalog_id: result?.id === config.catalogProductId, strategy: result?.settings?.listing_strategy === 'catalog_required', gtin: entityHasGtin(result, config.gtin), brand: normalize(attributeValue(result, 'BRAND')) === normalize(config.brand), model: !config.modelAliases?.length || config.modelAliases.some((value) => normalize(attributeValue(result, 'MODEL')).includes(normalize(value))) };
  const critical = {}; for (const [id, aliases] of Object.entries(config.critical || {})) critical[id] = aliases.some((value) => normalize(attributeValue(result, id)) === normalize(value));
  return { fields, critical, passed: [...Object.values(fields), ...Object.values(critical)].every(Boolean) };
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
  const mapType = item.listing_type_id === 'gold_pro' || item.listing_type_id === 'gold_premium' ? 'premium' : 'classico'; const mapStatus = item.status === 'active' ? 'ativo' : 'pausado';
  const fields = [['ml_item_id', item.id, local.product?.ml_item_id], ['sku', product.sku, listing?.sku], ['produto_id', product.id, listing?.produto_id], ['title', item.title, listing?.titulo], ['price', Number(item.price), Number(listing?.preco_ml)], ['status', mapStatus, listing?.status], ['listing_type', mapType, listing?.tipo], ['catalog', item.catalog_listing === true, listing?.catalogo], ['permalink', item.permalink, listing?.permalink]].map(([field, remote, localValue]) => ({ field, remote, local: localValue, status: String(remote) === String(localValue) ? 'MATCH' : 'DIVERGENT' }));
  const unique = local.listings?.length === 1 && local.other_products?.length === 0;
  return { fields, unique, material_drift: !unique || fields.some((row) => row.status === 'DIVERGENT') };
}

function register400(data) {
  const fingerprint = String(data?.cause?.[0]?.code || data?.cause?.[0]?.message || data?.error || data?.message || 'unknown_400');
  stop.structural400Fingerprints[fingerprint] = (stop.structural400Fingerprints[fingerprint] || 0) + 1;
}

function stopLoss() {
  if (stop.duplicateCreations >= 2) return 'DUPLICATE_CREATION_SYSTEMIC';
  if (stop.wrongCatalogs >= 2) return 'WRONG_CATALOG_SYSTEMIC';
  if (stop.consecutivePricingFailures >= 2) return 'PROTECTIVE_PRICING_SYSTEMIC_FAILURE';
  if (stop.consecutivePersistenceFailures >= 2) return 'PERSISTENCE_SYSTEMIC_FAILURE';
  if (Math.max(0, ...Object.values(stop.structural400Fingerprints)) >= 3) return 'PAYLOAD_SYSTEMIC_ERROR';
  return null;
}

async function finishBlocked(base, config, started, result, observation, existingRemote = [], extra = {}) {
  metrics.blocked += !['SAFE_PUBLICATION_PERSIST_SUCCESS', 'SKIPPED_EXISTING_REMOTE'].includes(result) ? 1 : 0;
  if (result === 'SKIPPED_EXISTING_REMOTE') metrics.existing += 1;
  const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: extra.itemId || existingRemote[0]?.id || null, catalog_product_id: extra.catalogProductId ?? config.catalogProductId ?? null, protective_price: extra.price ?? null, margin_percent: extra.margin ?? null, persisted: false, observation, backlogs: { quality_optimization_pending: false, description_optimization_pending: false, commercial_optimization_pending: false, optional_catalog_optimization_pending: !config.catalogProductId } };
  artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); return summary;
}

async function processSku({ db, token, inventory, allProducts, dsliteIntegration, config, index }) {
  const started = Date.now(); const before = { ml: metrics.ml_gets, local: metrics.local_reads, sources: metrics.source_lookups, posts: metrics.item_posts, puts: metrics.price_puts };
  metrics.processed += 1;
  const [products, listingRows] = await Promise.all([select(db, 'produtos', '*', (query) => query.eq('sku', config.sku).limit(2)), select(db, 'anuncios_ml', '*', (query) => query.eq('sku', config.sku))]);
  const product = products[0]; const offers = product ? await select(db, 'produto_fornecedor_ofertas', '*', (query) => query.eq('produto_id', product.id)) : []; const offer = offers.find((row) => row.id === product?.oferta_preferencial_id) || null;
  const base = { index, sku: config.sku, started_at: now(), local_time: localTime(), expected_gtin: config.gtin };
  let result = null; let observation = null;
  if (!product || products.length !== 1 || product.ativo !== true || Number(product.estoque) <= 0 || Number(product.custo) <= 0 || product.ml_item_id || product.ml_status !== 'sem_anuncio' || !offer || listingRows.length) { result = 'BLOCK_LOCAL_STATE'; observation = 'local_product_preferred_offer_or_listing_gate_failed'; }
  const dslite = product && offer ? await dsliteProduct(dsliteIntegration, offer).catch((error) => ({ error: error.message })) : null;
  const localDuplicates = product ? allProducts.filter((row) => row.id !== product.id && (normalizeGtin(row.gtin) === normalizeGtin(config.gtin) || (row.dslite_fornecedor_id && row.dslite_fornecedor_id === product.dslite_fornecedor_id && row.dslite_produto_id === product.dslite_produto_id))) : [];
  const existingRemote = remoteMatches(inventory.items, config);
  artifact(config.sku, 'gtin.json', { local: product?.gtin || null, expected: config.gtin, normalized_local: normalizeGtin(product?.gtin), normalized_expected: normalizeGtin(config.gtin), classification: normalizeGtin(product?.gtin) === normalizeGtin(config.gtin) ? (String(product?.gtin) === String(config.gtin) ? 'MATCH' : 'GTIN_LEADING_ZERO_NORMALIZATION') : 'CONFLICT' });
  artifact(config.sku, 'duplicate-check.json', { checked_at: now(), inventory: { expected: inventory.expected, captured: inventory.captured, pages: inventory.pages, reliable: inventory.reliable }, local_duplicates: localDuplicates.map((row) => ({ id: row.id, sku: row.sku, nome: row.nome, gtin: row.gtin })), remote_matches: existingRemote.map((row) => ({ id: row.id, status: row.status, sku: row.seller_custom_field || attributeValue(row, 'SELLER_SKU'), gtin: attributeValue(row, 'GTIN'), catalog_product_id: row.catalog_product_id, title: row.title })) });
  if (!result && normalizeGtin(product.gtin) !== normalizeGtin(config.gtin)) { result = 'BLOCK_GTIN'; observation = 'local_gtin_drift'; }
  if (!result && localDuplicates.length) { result = 'BLOCK_LOCAL_DUPLICATE'; observation = 'same_physical_identity_in_local_catalog'; }
  if (!result && existingRemote.length) { result = 'SKIPPED_EXISTING_REMOTE'; observation = 'equivalent_remote_item_already_exists'; }
  const productSearch = await ml(token, `/products/search?status=active&site_id=MLB&product_identifier=${config.gtin}`); metrics.source_lookups += 1;
  const exactResults = productSearch.ok ? productSearch.data?.results || [] : [];
  artifact(config.sku, 'identity.json', { ...base, product, preferred_offer: offer, dslite, configured_decision: config.decision, configured_reason: config.reason || null, evidence: { manufacturer_or_official: config.source || null, secondary: config.secondarySource || null, supplier: dslite?.url || null, ml_exact_lookup: `/products/search?status=active&site_id=MLB&product_identifier=${config.gtin}` }, catalog_results: exactResults });
  if (!result && config.decision !== 'PASS') { result = config.decision; observation = config.reason; }
  if (result) return finishBlocked(base, config, started, result, observation, existingRemote, { catalogProductId: exactResults[0]?.id || null });

  let catalogResult = null; let catalogIdentityResult = null;
  if (config.catalogProductId) {
    catalogResult = exactResults.find((row) => row.id === config.catalogProductId); catalogIdentityResult = catalogIdentity(catalogResult, config);
    if (!catalogResult || !catalogIdentityResult.passed) { result = 'BLOCK_CATALOG_IDENTITY'; observation = 'catalog_exact_identity_gate_failed'; }
  } else if (exactResults.some((row) => row?.settings?.listing_strategy === 'catalog_required')) { result = 'BLOCK_CATALOG_IDENTITY'; observation = 'new_catalog_required_product_requires_explicit_exact_revalidation'; }
  const responses = result ? [{}, {}, {}] : await Promise.all([config.catalogProductId ? ml(token, `/products/${config.catalogProductId}`) : Promise.resolve({ ok: true, data: null }), ml(token, `/categories/${config.categoryId}`), ml(token, `/categories/${config.categoryId}/attributes`)]);
  const [catalogDetail, categoryResponse, categoryAttrsResponse] = responses; const category = categoryResponse.data; const categoryAttrs = categoryAttrsResponse.data || [];
  const expectedDomain = catalogResult?.domain_id || config.domainId;
  if (!result && (!catalogDetail.ok || !categoryResponse.ok || !categoryAttrsResponse.ok || category?.settings?.status !== 'enabled' || category?.settings?.listing_allowed !== true || category?.settings?.catalog_domain !== expectedDomain)) { result = 'BLOCK_CATEGORY'; observation = 'category_contract_or_domain_invalid'; }
  const attributes = result ? [] : (config.catalogProductId ? buildCatalogAttributes(catalogResult, categoryAttrs, config.sku) : buildManualAttributes(config, categoryAttrs, config.sku));
  const requiredIds = result ? [] : requiredAttributeIds(categoryAttrs); const missing = result ? [] : missingRequiredAttributes(attributes, requiredIds);
  artifact(config.sku, 'catalog-validation.json', { checked_at: now(), expected_catalog_product_id: config.catalogProductId, catalog_search_identity: catalogIdentityResult, catalog_detail: catalogDetail.data || null, optional_catalog_optimization_pending: !config.catalogProductId });
  artifact(config.sku, 'category-contract.json', { checked_at: now(), category, required_ids: requiredIds, missing_required: missing, listing_strategy: catalogResult?.settings?.listing_strategy || 'optional_or_no_catalog', endpoint: 'POST /items', user_products: { family_name: 'required', title: 'prohibited', description: 'not_executed' }, attributes });
  if (!result && missing.length) { result = 'BLOCK_API_CONTRACT'; observation = `required_attributes_missing:${missing.join(',')}`; }
  const imageAudit = result ? { rows: [], approved: [], main_approved: false } : await auditImages(product.imagens, Number(category?.settings?.max_pictures_per_item || 12));
  if (!result && (!imageAudit.main_approved || !imageAudit.approved.length)) { result = 'BLOCK_IMAGE'; observation = 'no_valid_primary_image'; }
  const dimensions = dslite?.product ? shippingDimensions(dslite.product) : null;
  if (!result && !dimensions) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = 'supplier_shipping_dimensions_missing'; }
  const reservations = product ? await select(db, 'pedido_itens', 'pedido_id,seller_sku,quantidade', (query) => query.ilike('seller_sku', config.sku)) : [];
  const orderIds = [...new Set(reservations.map((row) => row.pedido_id).filter(Boolean))]; const orders = orderIds.length ? await select(db, 'pedidos', 'id,situacao', (query) => query.in('id', orderIds)) : []; const reserving = new Set(['aberto', 'pendente', 'faturado']); const orderMap = new Map(orders.map((row) => [row.id, row]));
  const reserved = reservations.filter((row) => reserving.has(orderMap.get(row.pedido_id)?.situacao)).reduce((sum, row) => sum + Number(row.quantidade || 0), 0);
  const stock = dslite?.product ? Math.max(0, Math.min(Number(product.estoque), Number(offer.estoque), Number(dslite.product.estoque)) - reserved) : 0;
  if (!result && stock <= 0) { result = 'BLOCK_LOCAL_STATE'; observation = 'publishable_stock_zero'; }
  const cost = Number(offer?.custo ?? product?.custo); const preQuote = result ? null : await protectiveQuote(token, config, dimensions, cost).catch((error) => ({ approved: false, error: error.message }));
  if (!result && !preQuote?.approved) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = preQuote?.error || preQuote?.reason || 'pre_item_protective_quote_failed'; }
  artifact(config.sku, 'shipping.json', { dimensions, source: 'DSLITE_SUPPLIER_PACKAGE', pre_item: preQuote?.shipping_data || null, post_item: null }); artifact(config.sku, 'protective-pricing.json', { tax_rate: TAX_RATE, target_margin_percent: 50, safety_target_percent: 50.5, cost, pre_item: preQuote });
  if (result) return finishBlocked(base, config, started, result, observation, existingRemote, { price: preQuote?.financial?.price, margin: preQuote?.financial?.margin_percent });

  const payload = { family_name: config.familyName, category_id: config.categoryId, ...(config.catalogProductId ? { catalog_product_id: config.catalogProductId, catalog_listing: true } : {}), price: preQuote.financial.price, currency_id: 'BRL', available_quantity: stock, buying_mode: 'buy_it_now', listing_type_id: LISTING_TYPE, condition: 'new', pictures: imageAudit.approved.map((row) => ({ source: row.url })), attributes, shipping: { mode: 'me2', local_pick_up: false, free_shipping: true }, seller_custom_field: config.sku };
  const payloadHash = canonicalHash(payload); artifact(config.sku, 'payload.json', { payload, sha256: payloadHash, title_absent: !('title' in payload), description_absent: !('description' in payload), attributes_count: attributes.length, pictures_count: payload.pictures.length, image_audit: imageAudit.rows });
  const immediateSku = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`); let catalogOffers = { ok: true, data: { results: [] }, status: 200 };
  if (config.catalogProductId) catalogOffers = await ml(token, `/products/${config.catalogProductId}/items?limit=100`);
  const noOffers = catalogOffers.status === 404 && catalogOffers.data?.message === 'No winners found'; const concurrentCatalog = (catalogOffers.data?.results || []).filter((row) => Number(row.seller_id) === SELLER_ID);
  if (!immediateSku.ok || (!catalogOffers.ok && !noOffers)) { result = 'API_TRANSIENT_ERROR'; observation = 'immediate_duplicate_gate_unavailable'; }
  else if ((immediateSku.data?.results || []).length || concurrentCatalog.length) { result = 'BLOCK_REMOTE_DUPLICATE'; observation = 'equivalent_remote_created_after_inventory_snapshot'; }
  if (result) return finishBlocked(base, config, started, result, observation, existingRemote, { price: payload.price, margin: preQuote.financial.margin_percent });

  const postStarted = Date.now(); const post = await ml(token, '/items', { method: 'POST', body: payload });
  artifact(config.sku, 'post-response.json', { attempted_at: now(), local_time: localTime(), endpoint: 'POST /items', request_id: post.headers['x-request-id'] || post.headers['x-requestid'] || null, http_status: post.status, elapsed_ms: Date.now() - postStarted, payload_sha256: payloadHash, body: post.data });
  let itemId = post.data?.id || null;
  if (post.status === 400) { register400(post.data); result = 'BLOCK_API_CONTRACT'; observation = post.data; }
  else if (post.status >= 500) { await sleep(1000); const ghost = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`); itemId = ghost.data?.results?.[0] || null; if (!itemId) { result = 'API_TRANSIENT_ERROR'; observation = post.data; } }
  else if (post.status !== 201 || !itemId) { result = 'BLOCK_API_CONTRACT'; observation = post.data; }
  if (result) return finishBlocked(base, config, started, result, observation, existingRemote, { itemId, price: payload.price, margin: preQuote.financial.margin_percent });
  metrics.created += 1;

  let read = await ml(token, `/items/${itemId}?include_internal_attributes=true`); let item = read.data; const expected = { ...config, sellerId: SELLER_ID, quantity: stock, listingTypeId: LISTING_TYPE }; let remoteIdentity = classifyRemoteIdentity(item, expected);
  const duplicatesAfterPost = await ml(token, `/users/${SELLER_ID}/items/search?seller_sku=${config.sku}`); if ((duplicatesAfterPost.data?.results || []).length > 1) { stop.duplicateCreations += 1; result = 'BLOCK_REMOTE_DUPLICATE'; observation = 'more_than_one_remote_item_for_seller_sku_after_post'; }
  if (!result && (!read.ok || !remoteIdentity.passed || !['active', 'paused', 'under_review'].includes(item.status))) { result = 'BLOCK_IDENTITY'; observation = { remoteIdentity, status: item?.status }; if (config.catalogProductId && item?.catalog_product_id !== config.catalogProductId) stop.wrongCatalogs += 1; }
  if (result) { artifact(config.sku, 'remote-readback.json', { item, identity: remoteIdentity }); return finishBlocked(base, config, started, result, observation, existingRemote, { itemId, catalogProductId: item?.catalog_product_id, price: item?.price }); }

  let postQuote = await quote(token, config, Number(item.price), dimensions, cost, itemId).catch((error) => ({ error: error.message })); let priceUpdate = { executed: false, reason: 'not_required' };
  if (!postQuote.financial || postQuote.financial.margin_percent < 50) {
    const reprotected = await protectiveQuote(token, config, dimensions, cost, itemId, Number(item.price)).catch((error) => ({ approved: false, error: error.message }));
    if (!reprotected.approved) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = reprotected; stop.consecutivePricingFailures += 1; }
    else {
      const update = await ml(token, `/items/${itemId}`, { method: 'PUT', body: { price: reprotected.financial.price } }); priceUpdate = { executed: true, endpoint: `PUT /items/${itemId}`, request_id: update.headers['x-request-id'] || null, http_status: update.status, body: update.data, target: reprotected };
      if (!update.ok) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = update.data; stop.consecutivePricingFailures += 1; }
      else { read = await ml(token, `/items/${itemId}?include_internal_attributes=true`); item = read.data; postQuote = await quote(token, config, Number(item.price), dimensions, cost, itemId); }
    }
  }
  artifact(config.sku, 'price-update.json', priceUpdate); artifact(config.sku, 'shipping.json', { dimensions, source: 'DSLITE_SUPPLIER_PACKAGE', pre_item: preQuote.shipping_data, post_item: postQuote.shipping_data || null }); artifact(config.sku, 'protective-pricing.json', { tax_rate: TAX_RATE, target_margin_percent: 50, safety_target_percent: 50.5, cost, pre_item: preQuote, post_item: postQuote, approved: postQuote.financial?.margin_percent >= 50 });
  if (!result && postQuote.financial?.margin_percent < 50) { result = 'BLOCK_PROTECTIVE_PRICE'; observation = postQuote; stop.consecutivePricingFailures += 1; } else if (!result) stop.consecutivePricingFailures = 0;
  remoteIdentity = classifyRemoteIdentity(item, expected); artifact(config.sku, 'remote-readback.json', { checked_at: now(), item, identity: remoteIdentity, image_normalization: item.pictures?.every((picture) => /mlstatic\.com/.test(picture.secure_url || picture.url || '')) ? 'IMAGE_NORMALIZED_BY_ML' : 'SOURCE_PRESERVED' });
  if (!result && !remoteIdentity.passed) { result = 'BLOCK_IDENTITY'; observation = remoteIdentity; }
  if (result) return finishBlocked(base, config, started, result, observation, existingRemote, { itemId, catalogProductId: item.catalog_product_id, price: item.price, margin: postQuote.financial?.margin_percent });

  try {
    metrics.local_transactions += 1; const transaction = psql(buildPersistenceSql({ product, item })); const local = localReadback(product, itemId); const diff = localRemoteDiff(local, item, product);
    artifact(config.sku, 'local-persistence.json', { executed: true, transaction, quality_score_not_evaluated: true, quality_optimization_pending: true, description_optimization_pending: true, commercial_optimization_pending: true }); artifact(config.sku, 'local-remote-diff.json', diff);
    if (diff.material_drift) { result = 'BLOCK_PERSISTENCE'; observation = diff; stop.consecutivePersistenceFailures += 1; }
    else { result = 'SAFE_PUBLICATION_PERSIST_SUCCESS'; metrics.persisted += 1; stop.consecutivePersistenceFailures = 0; inventory.items.push(item); }
  } catch (error) { metrics.rollbacks += 1; stop.consecutivePersistenceFailures += 1; result = 'BLOCK_PERSISTENCE'; observation = error.message; artifact(config.sku, 'local-persistence.json', { executed: true, committed: false, error: error.message }); }
  const summary = { ...base, completed_at: now(), elapsed_ms: Date.now() - started, result, item_id: itemId, user_product_id: item.user_product_id, family_id: item.family_id, catalog_product_id: item.catalog_product_id, protective_price: Number(item.price), margin_percent: postQuote.financial.margin_percent, persisted: result === 'SAFE_PUBLICATION_PERSIST_SUCCESS', observation, metrics: { ml_calls: metrics.ml_gets - before.ml, local_calls: metrics.local_reads - before.local, source_lookups: metrics.source_lookups - before.sources, posts: metrics.item_posts - before.posts, puts: metrics.price_puts - before.puts }, backlogs: { quality_optimization_pending: true, description_optimization_pending: true, commercial_optimization_pending: true, optional_catalog_optimization_pending: !config.catalogProductId } };
  artifact(config.sku, 'summary.json', summary); fillArtifacts(config.sku, result); return summary;
}

async function main() {
  if (ALLOWED.length !== 20 || new Set(ALLOWED.map((row) => row.sku)).size !== 20) throw new Error('authorized_batch_invariant_failed');
  const db = dbClient(); const [integrations, allProducts] = await Promise.all([select(db, 'integracoes', 'tipo,url,access_token,conectado', (query) => query.in('tipo', ['mercadolivre', 'dslite'])), selectAll(db, 'produtos', 'id,sku,nome,marca,gtin,estoque,custo,ativo,ml_item_id,ml_status,dslite_fornecedor_id,dslite_produto_id,oferta_preferencial_id', (query) => query.order('id'))]);
  const byType = Object.fromEntries(integrations.map((row) => [row.tipo, row])); if (!byType.mercadolivre?.conectado || !byType.dslite?.conectado) throw new Error('AUTH_SYSTEMIC_FAILURE:integration_disconnected');
  const account = await assertAllowedMercadoLivreToken(byType.mercadolivre.access_token, 'ml-p0-phase6b'); if (Number(account.userId) !== SELLER_ID) throw new Error(`AUTH_SYSTEMIC_FAILURE:seller_${account.userId}`);
  const inventory = await scanInventory(byType.mercadolivre.access_token); const results = [];
  for (let index = 0; index < ALLOWED.length; index += 1) {
    const config = ALLOWED[index]; console.log(JSON.stringify({ event: 'phase6b_sku_start', index: index + 1, sku: config.sku, at: now() })); let row;
    try { row = await processSku({ db, token: byType.mercadolivre.access_token, inventory, allProducts, dsliteIntegration: byType.dslite, config, index: index + 1 }); }
    catch (error) { const systemic = /AUTH_SYSTEMIC_FAILURE|remote_inventory_unreliable|supabase_/.test(error.message); row = { index: index + 1, sku: config.sku, result: 'API_TRANSIENT_ERROR', error: error.message, item_id: null, persisted: false, elapsed_ms: 0 }; artifact(config.sku, 'summary.json', row); fillArtifacts(config.sku, row.result); metrics.blocked += 1; if (systemic) { stop.triggered = true; stop.reason = error.message; results.push(row); break; } }
    if (!FINAL_STATES.has(row.result)) throw new Error(`invalid_final_state:${config.sku}:${row.result}`); results.push(row); console.log(JSON.stringify({ event: 'phase6b_sku_done', sku: config.sku, result: row.result, item_id: row.item_id || null })); const reason = stopLoss(); if (reason) { stop.triggered = true; stop.reason = reason; break; }
  }
  metrics.completed_at = now(); metrics.elapsed_ms = Date.now() - Date.parse(metrics.started_at); metrics.mean_sku_ms = results.length ? Math.round(results.reduce((sum, row) => sum + Number(row.elapsed_ms || 0), 0) / results.length) : 0; metrics.industrial_conversion_percent = results.length ? roundMoney(metrics.persisted / results.length * 100) : 0;
  const counts = results.reduce((acc, row) => ({ ...acc, [row.result]: (acc[row.result] || 0) + 1 }), {}); const financial = results.filter((row) => row.item_id).map((row) => ({ sku: row.sku, item_id: row.item_id, protective_price: row.protective_price, margin_percent: row.margin_percent }));
  const summary = { phase: '6B', mode: 'SAFE_PUBLICATION_BATCH_SEQUENTIAL', generated_at: now(), authorized_skus: ALLOWED.map((row) => row.sku), processed: results.length, unprocessed: ALLOWED.slice(results.length).map((row) => row.sku), counts, stop_loss: stop, metrics, results, hold: HOLD, invariants: { max_twenty: results.length <= 20, writes_sequential: true, no_sku_21: true, no_quality_calls: true, no_description_calls: true, no_competition_calls: true, tax_rate: TAX_RATE, protective_margin_min_percent: TARGET_MARGIN * 100 } };
  writeJson(path.join(REPORT_DIR, 'summary.json'), summary);
  const quoteCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`; const resultsCsv = ['index,sku,state,item_id,catalog_product_id,protective_price,margin_percent,persisted,observation', ...results.map((row) => [row.index, row.sku, row.result, row.item_id, row.catalog_product_id, row.protective_price, row.margin_percent, row.persisted === true, JSON.stringify(row.observation ?? '')].map(quoteCsv).join(','))].join('\n'); fs.writeFileSync(path.join(REPORT_DIR, 'batch-results.csv'), `${resultsCsv}\n`);
  const blocks = results.filter((row) => row.result !== 'SAFE_PUBLICATION_PERSIST_SUCCESS' && row.result !== 'SKIPPED_EXISTING_REMOTE'); const blockCsv = ['sku,gate,evidence', ...blocks.map((row) => [row.sku, row.result, JSON.stringify(row.observation ?? row.error ?? '')].map(quoteCsv).join(','))].join('\n'); fs.writeFileSync(path.join(REPORT_DIR, 'batch-blocks.csv'), `${blockCsv}\n`);
  writeJson(path.join(REPORT_DIR, 'batch-financial.json'), { generated_at: now(), target_margin_percent: 50, tax_rate: TAX_RATE, rows: financial }); writeJson(path.join(REPORT_DIR, 'batch-metrics.json'), metrics); writeJson(path.join(REPORT_DIR, 'batch-api-errors.json'), { generated_at: now(), rows: blocks.filter((row) => ['BLOCK_API_CONTRACT', 'API_TRANSIENT_ERROR'].includes(row.result)) });
  writeJson(path.join(REPORT_DIR, 'full-report.json'), { ...summary, inventory: { expected: inventory.expected, captured: inventory.captured, pages: inventory.pages, reliable: inventory.reliable }, official_contracts: { user_products: 'https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products', catalog_required: 'https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/publicacoes-necessarias-do-catalogo', catalog_publish: 'https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo', attributes: 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos', conditional_attributes: 'https://developers.mercadolivre.com.br/pt_br/atributos-condicionais', fees: 'https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos/comissao-por-vender', shipping: 'https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/custos-de-envio', dslite: 'https://documenter.getpostman.com/view/5316990/RWaRNkaA', supabase: 'https://supabase.com/docs/guides/database/connecting-to-postgres' }, substitutions: { firecrawl: 'Codex web search/open', supabase_cloud: 'self_hosted direct PostgreSQL over authorized SSH' } });
  console.log(JSON.stringify({ event: 'phase6b_complete', processed: results.length, counts, stop_loss: stop, item_posts: metrics.item_posts, price_puts: metrics.price_puts, persisted: metrics.persisted, hold: HOLD }));
}

main().catch((error) => { const failed = { phase: '6B', generated_at: now(), result: 'SYSTEMIC_ABORT', error: error.message, metrics, stop_loss: { ...stop, triggered: true, reason: error.message }, hold: HOLD }; writeJson(path.join(REPORT_DIR, 'summary.json'), failed); writeJson(path.join(REPORT_DIR, 'full-report.json'), failed); console.error(JSON.stringify({ event: 'phase6b_failed', error: error.message })); process.exitCode = 1; });
