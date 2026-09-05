#!/usr/bin/env node
/* Phase 5C: one catalog-required POST, read-back only, no local persistence. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  attributeValue,
  calculateFinancial,
  classifyFinal,
  classifyRemoteIdentity,
  compareField,
  extractShippingCost,
  normalize,
  sha256Canonical,
  titleClassification,
} = require('./lib/ml-p0-phase5c');

dotenv.config({ path: '.env.local', quiet: true });

const SKU = 'VTK000392';
const PRODUCT_ID = 'eef0e527-8ef8-4a19-8132-9b1f670bb461';
const SELLER_ID = 3294514937;
const GTIN = '7898461970375';
const CATEGORY_ID = 'MLB1645';
const DOMAIN_ID = 'MLB-FANS';
const CATALOG_PRODUCT_ID = 'MLB15284402';
const WRONG_VOLTAGE_CATALOG_PRODUCT_ID = 'MLB15284403';
const FAMILY_NAME = 'Ventilador de Mesa Ventisol Turbo 6 40 cm';
const AUTHORIZED_HASH = '17bbed8f4bdae44267e1134be13a1713036e3d6a08d233691b06e6f4d613620d';
const AUTHORIZED_PRICE = 250.62;
const AUTHORIZED_STOCK = 15;
const BASELINE_COST = 132.55;
const OFFICIAL_URL = 'https://www.ventisol.com.br/ventilador-de-mesa-ventisol-turbo-6p-40cm-azul';
const SOURCE_PAYLOAD = path.resolve('reports/ml-p0-phase5b/full-payload.json');
const REPORT_DIR = path.resolve('reports/ml-p0-phase5c');
const HOLD = 'P0 PHASE 5C — CATALOG CANARY POST HOLD';
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const localTimestamp = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium', hour12: false,
}).format(date).replace(' ', 'T');

const metrics = {
  supabase_reads: 0,
  supabase_writes: 0,
  dslite_gets: 0,
  manufacturer_gets: 0,
  image_gets: 0,
  ml_gets: 0,
  ml_item_post_attempts: 0,
  ml_item_posts_successful: 0,
  ml_other_writes: 0,
};
let lastMlAt = 0;

fs.mkdirSync(REPORT_DIR, { recursive: true });
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (name, data) => fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function dbSelect(table, select, configure) {
  metrics.supabase_reads += 1;
  let query = supabase.from(table).select(select);
  if (configure) query = configure(query);
  const { data, error } = await query;
  if (error) throw new Error(`supabase_${table}:${error.message}`);
  return data || [];
}

async function dbOne(table, select, configure) {
  const rows = await dbSelect(table, select, configure);
  return rows[0] || null;
}

function safeHeaders(headers) {
  const output = {};
  for (const key of ['x-request-id', 'x-correlation-id', 'x-trace-id', 'date', 'content-type']) {
    const value = headers.get(key);
    if (value) output[key] = value;
  }
  return output;
}

function requestId(headers) {
  return headers.get('x-request-id') || headers.get('x-correlation-id') || headers.get('x-trace-id') || null;
}

async function mlRequest(token, resource, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'POST') {
    if (resource !== '/items' || options.authorizedItemPost !== true || metrics.ml_item_post_attempts >= 1) {
      metrics.ml_other_writes += 1;
      throw new Error(`ml_write_forbidden:${method}:${resource}`);
    }
    metrics.ml_item_post_attempts += 1;
  } else if (method !== 'GET') {
    metrics.ml_other_writes += 1;
    throw new Error(`ml_write_forbidden:${method}:${resource}`);
  } else {
    metrics.ml_gets += 1;
  }
  const wait = 90 - (Date.now() - lastMlAt);
  if (wait > 0) await sleep(wait);
  lastMlAt = Date.now();
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 60000),
  });
  const data = await response.json().catch(() => null);
  if (method === 'POST' && response.ok) metrics.ml_item_posts_successful += 1;
  if (!response.ok && !options.allowError && method === 'GET') {
    throw new Error(`ml_http_${response.status}:${resource}:${data?.message || data?.error || 'unknown'}`);
  }
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}

async function fetchDslite(integration, offer) {
  metrics.dslite_gets += 1;
  const url = `${String(integration.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`;
  const response = await fetch(url, { headers: { Token: integration.access_token }, signal: AbortSignal.timeout(45000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`dslite_http_${response.status}`);
  const product = (data?.produtos || []).find((row) => String(row.produtoid) === String(offer.dslite_produto_id)) || data?.produtos?.[0];
  if (!product) throw new Error('dslite_product_missing');
  return { url, checked_at: now(), product };
}

async function fetchOfficial() {
  metrics.manufacturer_gets += 1;
  const response = await fetch(OFFICIAL_URL, { signal: AbortSignal.timeout(45000) });
  const html = await response.text();
  if (!response.ok) throw new Error(`manufacturer_http_${response.status}`);
  const checks = {
    brand: /VENTISOL/i.test(html),
    model: /Turbo\s*6P?\s*40cm/i.test(html),
    type: /Ventilador de Mesa/i.test(html),
    color: /Azul/i.test(html),
    voltage_127: /127V/i.test(html),
    gtin: new RegExp(GTIN).test(html),
    blades_6: /(?:Hélice|H&eacute;lice)[\s\S]{0,80}6\s*(?:Pás|P&aacute;s)/i.test(html),
  };
  return { url: OFFICIAL_URL, checked_at: now(), http_status: response.status, checks, passed: Object.values(checks).every(Boolean) };
}

async function scanRemoteInventory(token) {
  const ids = [];
  const seenScrolls = new Set();
  let scrollId = '';
  let expectedTotal = null;
  let pages = 0;
  while (pages < 1000) {
    const query = scrollId ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}` : 'search_type=scan&limit=100';
    const page = (await mlRequest(token, `/users/${SELLER_ID}/items/search?${query}`)).data;
    pages += 1;
    if (expectedTotal === null) expectedTotal = Number(page?.paging?.total || 0);
    const current = (page?.results || []).map(String);
    ids.push(...current);
    if (!current.length || new Set(ids).size >= expectedTotal) break;
    if (!page.scroll_id || seenScrolls.has(page.scroll_id)) break;
    seenScrolls.add(page.scroll_id);
    scrollId = page.scroll_id;
  }
  const unique = [...new Set(ids)];
  const items = [];
  const fields = 'body.title,body.family_name,body.family_id,body.status,body.sub_status,body.seller_id,body.seller_custom_field,body.user_product_id,body.catalog_product_id,body.category_id,body.attributes,body.variations,body.price,body.available_quantity,body.sold_quantity,body.listing_type_id,body.catalog_listing,body.permalink,body.date_created,body.last_updated';
  for (let index = 0; index < unique.length; index += 20) {
    const batch = unique.slice(index, index + 20);
    const rows = (await mlRequest(token, `/items/bulk?ids=${batch.join(',')}&attributes=${fields}`)).data;
    for (const row of rows || []) if (Number(row.status_code) === 200 && row.id && row.body) items.push({ ...row.body, id: String(row.id) });
  }
  const reliable = unique.length === expectedTotal && items.length === unique.length;
  if (!reliable) throw new Error(`remote_inventory_unreliable:${unique.length}/${expectedTotal}/${items.length}`);
  return { expected_total: expectedTotal, captured: unique.length, detailed: items.length, pages, reliable, items };
}

function remoteIdentity(item) {
  return classifyRemoteIdentity(item, {
    sku: SKU, gtin: GTIN, catalog_product_id: CATALOG_PRODUCT_ID,
    brand: 'Ventisol', model: 'Turbo 6', voltage: '127V', color: 'Azul', diameter: '40 cm', type: 'De mesa',
  });
}

async function duplicatePreflight(token) {
  const direct = [];
  for (const [method, value] of [
    ['seller_sku', SKU], ['sku', SKU], ['q', 'Ventisol Turbo 6 40cm 127V'], ['catalog_product_id', CATALOG_PRODUCT_ID],
  ]) {
    const response = await mlRequest(token, `/users/${SELLER_ID}/items/search?${method}=${encodeURIComponent(value)}&limit=100`);
    direct.push({ method, value, total: Number(response.data?.paging?.total || 0), item_ids: response.data?.results || [] });
  }
  const inventory = await scanRemoteInventory(token);
  const matches = inventory.items.map((item) => ({ item, identity: remoteIdentity(item) }))
    .filter((row) => row.identity.equivalent || row.identity.possible)
    .map((row) => ({
      item_id: row.item.id,
      status: row.item.status,
      title: row.item.title,
      seller_sku: row.item.seller_custom_field || attributeValue(row.item, 'SELLER_SKU'),
      gtin: attributeValue(row.item, 'GTIN'),
      catalog_product_id: row.item.catalog_product_id,
      user_product_id: row.item.user_product_id,
      family_id: row.item.family_id,
      family_name: row.item.family_name,
      ...row.identity,
    }));
  return {
    checked_at: now(),
    methods: ['seller_sku', 'sku', 'title', 'catalog_product_id', 'full_inventory_all_statuses', 'GTIN', 'User Product', 'Family'],
    direct,
    inventory: { expected_total: inventory.expected_total, captured: inventory.captured, detailed: inventory.detailed, pages: inventory.pages, reliable: inventory.reliable },
    matches,
    blocking_matches: matches.filter((row) => row.equivalent),
    possible_matches: matches.filter((row) => row.possible),
  };
}

function buildStock(product, offer, dslite, pendingItems, orders) {
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const reserving = new Set(['aberto', 'pendente', 'faturado']);
  const reservations = pendingItems.filter((row) => reserving.has(orderById.get(row.pedido_id)?.situacao));
  const reserved = reservations.reduce((sum, row) => sum + Number(row.quantidade || 0), 0);
  const supplier = Math.min(Number(product.estoque), Number(offer.estoque), Number(dslite.estoque));
  return {
    product: Number(product.estoque), preferred_offer: Number(offer.estoque), dslite: Number(dslite.estoque),
    supplier_conservative: supplier, reserved, reservations,
    publicable: Math.max(0, supplier - reserved),
  };
}

function catalogField(product, exactSearchRow, id) {
  return attributeValue(product, id) || attributeValue(exactSearchRow, id);
}

async function catalogPreflight(token) {
  const [detail, search, category] = await Promise.all([
    mlRequest(token, `/products/${CATALOG_PRODUCT_ID}`),
    mlRequest(token, `/products/search?status=active&site_id=MLB&listing_strategy=catalog_required&product_identifier=${GTIN}`),
    mlRequest(token, `/categories/${CATEGORY_ID}`),
  ]);
  const product = detail.data;
  const exact = (search.data?.results || []).find((row) => row.id === CATALOG_PRODUCT_ID) || null;
  const fields = {
    id: product?.id === CATALOG_PRODUCT_ID,
    active: product?.status === 'active',
    domain: product?.domain_id === DOMAIN_ID,
    category_domain: category.data?.settings?.catalog_domain === DOMAIN_ID,
    catalog_required: exact?.settings?.listing_strategy === 'catalog_required',
    brand: normalize(catalogField(product, exact, 'BRAND')) === normalize('Ventisol'),
    model: normalize(catalogField(product, exact, 'MODEL')).includes(normalize('Turbo 6')),
    gtin: normalize(catalogField(product, exact, 'GTIN')) === normalize(GTIN),
    voltage: normalize(catalogField(product, exact, 'VOLTAGE')) === normalize('127V'),
    color: normalize(catalogField(product, exact, 'BLADES_COLOR')) === normalize('Azul'),
    diameter: normalize(catalogField(product, exact, 'DIAMETER')) === normalize('40 cm'),
    blades: normalize(catalogField(product, exact, 'BLADES_NUMBER')) === normalize('6'),
  };
  const pickerProducts = (product?.pickers || []).flatMap((picker) => picker.products || []);
  return {
    checked_at: now(), product, exact_search: search.data, category: category.data, fields,
    passed: Object.values(fields).every(Boolean),
    wrong_voltage_catalog_selected: product?.id === WRONG_VOLTAGE_CATALOG_PRODUCT_ID,
    picker_products: pickerProducts,
  };
}

async function auditImage(url) {
  metrics.image_gets += 1;
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const contentType = String(response.headers.get('content-type') || '');
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = response.ok && contentType.startsWith('image/') ? await sharp(buffer).metadata() : {};
  return {
    checked_at: now(), url, http_status: response.status, content_type: contentType,
    width: metadata.width || null, height: metadata.height || null,
    sha256: require('crypto').createHash('sha256').update(buffer).digest('hex'),
    prior_visual_identity: 'Phase 5B manual inspection: exact Ventisol Turbo 6, blue, six blades, single unit, no voltage contradiction',
    passed: response.status === 200 && contentType.startsWith('image/') && Number(metadata.width) >= 250 && Number(metadata.height) >= 250,
  };
}

async function financialQuote(token, { price, listingType, categoryId, dimensions, itemId, cost }) {
  const feeParams = new URLSearchParams({
    price: Number(price).toFixed(2), category_id: categoryId, listing_type_id: listingType,
    currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2',
  });
  const feeData = (await mlRequest(token, `/sites/MLB/listing_prices?${feeParams}`)).data;
  const fee = Array.isArray(feeData) ? feeData.find((row) => row.listing_type_id === listingType) || feeData[0] : feeData;
  const shippingParams = new URLSearchParams({
    ...(itemId ? { item_id: itemId } : { dimensions }),
    verbose: 'true', item_price: Number(price).toFixed(2), listing_type_id: listingType,
    mode: 'me2', condition: 'new', logistic_type: 'drop_off', free_shipping: 'true',
  });
  const shipping = (await mlRequest(token, `/users/${SELLER_ID}/shipping_options/free?${shippingParams}`)).data;
  const shippingCost = extractShippingCost(shipping);
  if (!Number.isFinite(shippingCost)) throw new Error('shipping_cost_missing');
  return {
    checked_at: now(), dimensions: itemId ? null : dimensions, item_id: itemId || null,
    fee_quote: fee, shipping_quote: shipping,
    values: calculateFinancial({ price, fee: fee?.sale_fee_amount, shipping: shippingCost, cost }),
  };
}

function payloadContract(payload) {
  const critical = {
    category_id: payload.category_id === CATEGORY_ID,
    catalog_product_id: payload.catalog_product_id === CATALOG_PRODUCT_ID,
    catalog_listing: payload.catalog_listing === true,
    family_name: payload.family_name === FAMILY_NAME,
    price: Number(payload.price) === AUTHORIZED_PRICE,
    stock: Number(payload.available_quantity) === AUTHORIZED_STOCK,
    listing_type: payload.listing_type_id === 'gold_special',
    condition: payload.condition === 'new',
    seller_sku: payload.seller_custom_field === SKU && normalize(attributeValue(payload, 'SELLER_SKU')) === normalize(SKU),
    gtin: normalize(attributeValue(payload, 'GTIN')) === normalize(GTIN),
    brand: normalize(attributeValue(payload, 'BRAND')) === normalize('Ventisol'),
    model: normalize(attributeValue(payload, 'MODEL')).includes(normalize('Turbo 6')),
    voltage: normalize(attributeValue(payload, 'VOLTAGE')) === normalize('127V'),
    color: normalize(attributeValue(payload, 'BLADES_COLOR')) === normalize('Azul'),
    diameter: normalize(attributeValue(payload, 'DIAMETER')) === normalize('40 cm'),
    attributes: payload.attributes?.length === 21,
    image: payload.pictures?.length === 1,
    title_absent: !Object.hasOwn(payload, 'title'),
    description_absent: !Object.hasOwn(payload, 'description'),
    variations_absent: !Object.hasOwn(payload, 'variations'),
  };
  return { critical, passed: Object.values(critical).every(Boolean) };
}

function createEmptyReports(result = 'NOT_EXECUTED') {
  return {
    post: { result, executed: false }, item: { result, item: null }, userProduct: { result, user_product: null },
    family: { result, family: null }, catalog: { result }, image: { result }, financial: { result }, competition: { result },
  };
}

function persistReports({ summary, gates, payloadReport, post, item, userProduct, family, catalog, image, financial, competition, full }) {
  writeJson('summary.json', summary);
  writeJson('prepost-gates.json', gates);
  writeJson('payload.json', payloadReport);
  writeJson('post-response.json', post);
  writeJson('item-readback.json', item);
  writeJson('user-product-readback.json', userProduct);
  writeJson('family-readback.json', family);
  writeJson('catalog-link-validation.json', catalog);
  writeJson('image-validation.json', image);
  writeJson('financial-validation.json', financial);
  writeJson('competition-postpublish.json', competition);
  writeJson('full-report.json', full);
}

async function postReadback(token, itemId) {
  let item = null;
  let attempts = 0;
  for (attempts = 1; attempts <= 18; attempts += 1) {
    item = (await mlRequest(token, `/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`)).data;
    const picturesReady = (item?.pictures || []).length > 0 && (item.pictures || []).every((picture) => !String(picture.secure_url || picture.url || '').includes('processing-image'));
    if ((item?.user_product_id && item?.catalog_product_id && picturesReady) || item?.status === 'closed' || attempts === 18) break;
    await sleep(5000);
  }
  let userProduct = null;
  let family = null;
  if (item?.user_product_id) {
    const response = await mlRequest(token, `/user-products/${encodeURIComponent(item.user_product_id)}`, { allowError: true });
    userProduct = response.ok ? response.data : { http_status: response.status, error: response.data };
  }
  const familyId = item?.family_id || userProduct?.family_id;
  if (familyId) {
    const response = await mlRequest(token, `/sites/MLB/user-products-families/${encodeURIComponent(familyId)}`, { allowError: true });
    family = response.ok ? response.data : { http_status: response.status, error: response.data };
  }
  return { checked_at: now(), attempts, item, userProduct, family };
}

async function postImageAudit(token, payload, item) {
  const rows = [];
  for (const picture of item?.pictures || []) {
    const url = picture.secure_url || picture.url;
    const source = await auditImage(url);
    const diagnostics = await mlRequest(token, `/pictures/${encodeURIComponent(picture.id)}/errors`, { allowError: true });
    const errors = diagnostics.status === 404 ? [] : Array.isArray(diagnostics.data) ? diagnostics.data : diagnostics.data?.errors || (diagnostics.ok ? [] : [diagnostics.data]);
    rows.push({ picture_id: picture.id, url, source, diagnostic_http: diagnostics.status, errors });
  }
  const submitted = payload.pictures.map((row) => row.source);
  const remote = rows.map((row) => row.url);
  const rehosted = remote.some((url) => !submitted.includes(url));
  const material = !rows.length || rows.some((row) => !row.source.passed || row.errors.length > 0);
  return {
    checked_at: now(), submitted, remote, rows, rehosted,
    classification: material ? 'MATERIAL_IMAGE_DRIFT' : rehosted ? 'IMAGE_NORMALIZED_BY_ML' : 'MATCH',
    material,
    identity_basis: 'exact catalog linkage plus accessible error-free catalog image; manual visual inspection required at hold if ML substitutes the source',
  };
}

async function competitionReadback(token, itemId) {
  const [priceToWin, catalog, offers] = await Promise.all([
    mlRequest(token, `/items/${encodeURIComponent(itemId)}/price_to_win?siteId=MLB&version=v2`, { allowError: true }),
    mlRequest(token, `/products/${CATALOG_PRODUCT_ID}`, { allowError: true }),
    mlRequest(token, `/products/${CATALOG_PRODUCT_ID}/items?limit=100&offset=0`, { allowError: true }),
  ]);
  const ownOffer = (offers.data?.results || []).find((row) => row.item_id === itemId || row.id === itemId) || null;
  return {
    checked_at: now(),
    price_to_win_http: priceToWin.status,
    price_to_win: priceToWin.data,
    buy_box_winner: catalog.data?.buy_box_winner || null,
    own_offer: ownOffer,
    offers_total: Number(offers.data?.paging?.total || 0),
    no_price_change_performed: true,
  };
}

async function ghostReconcile(token) {
  const direct = await mlRequest(token, `/users/${SELLER_ID}/items/search?seller_sku=${encodeURIComponent(SKU)}&limit=100`, { allowError: true });
  const inventory = await scanRemoteInventory(token);
  const matches = inventory.items.filter((item) => remoteIdentity(item).equivalent).map((item) => ({ id: item.id, status: item.status, title: item.title, identity: remoteIdentity(item) }));
  return { checked_at: now(), direct_http: direct.status, direct_ids: direct.data?.results || [], inventory: { total: inventory.expected_total, reliable: inventory.reliable }, matches };
}

async function main() {
  const startedAt = now();
  const source = readJson(SOURCE_PAYLOAD);
  const payload = structuredClone(source.payload);
  const payloadHash = sha256Canonical(payload);
  const contract = payloadContract(payload);
  const payloadReport = {
    generated_at: now(), payload, sha256: payloadHash, expected_sha256: AUTHORIZED_HASH,
    hash_match: payloadHash === AUTHORIZED_HASH, contract, source: SOURCE_PAYLOAD,
    serialization: 'SHA-256 of JSON.stringify(payload), preserving homologated insertion order',
  };

  const [product, integrations] = await Promise.all([
    dbOne('produtos', '*', (query) => query.eq('sku', SKU).limit(1)),
    dbSelect('integracoes', 'tipo,url,access_token,conectado,updated_at', (query) => query.in('tipo', ['dslite', 'mercadolivre'])),
  ]);
  if (!product || product.id !== PRODUCT_ID) throw new Error('local_product_identity_mismatch');
  const offer = await dbOne('produto_fornecedor_ofertas', '*', (query) => query.eq('id', product.oferta_preferencial_id).limit(1));
  if (!offer) throw new Error('preferred_offer_missing');
  const integration = Object.fromEntries(integrations.map((row) => [row.tipo, row]));
  if (!integration.dslite?.conectado || !integration.mercadolivre?.conectado) throw new Error('integration_unavailable');
  const account = await assertAllowedMercadoLivreToken(integration.mercadolivre.access_token, 'ml-p0-phase5c');
  if (Number(account.userId) !== SELLER_ID) throw new Error(`seller_mismatch:${account.userId}`);
  const token = integration.mercadolivre.access_token;

  const [pendingItems, localListings, localDuplicates, dslite, official] = await Promise.all([
    dbSelect('pedido_itens', 'pedido_id,seller_sku,quantidade,ml_item_id,created_at', (query) => query.ilike('seller_sku', SKU)),
    dbSelect('anuncios_ml', 'id,ml_item_id,produto_id,sku,titulo,status,catalogo,permalink', (query) => query.or(`produto_id.eq.${PRODUCT_ID},sku.eq.${SKU}`)),
    dbSelect('produtos', 'id,sku,nome,gtin,dslite_fornecedor_id,dslite_produto_id,ml_item_id', (query) => query.neq('id', PRODUCT_ID).or(`gtin.eq.${GTIN},and(dslite_fornecedor_id.eq.${product.dslite_fornecedor_id},dslite_produto_id.eq.${product.dslite_produto_id})`)),
    fetchDslite(integration.dslite, offer),
    fetchOfficial(),
  ]);
  const orderIds = [...new Set(pendingItems.map((row) => row.pedido_id).filter(Boolean))];
  const orders = orderIds.length ? await dbSelect('pedidos', 'id,situacao,numero,ml_order_id,created_at', (query) => query.in('id', orderIds)) : [];
  const stock = buildStock(product, offer, dslite.product, pendingItems, orders);
  const currentCost = Number(offer.custo ?? dslite.product.preco_revenda ?? product.custo);
  const localChecks = {
    produto_id: product.id === PRODUCT_ID,
    sku: product.sku === SKU,
    ml_item_id_null: !product.ml_item_id,
    ml_status_unlinked: product.ml_status === 'sem_anuncio',
    stock_authorized: stock.publicable >= AUTHORIZED_STOCK,
    cost_not_materially_changed: Math.abs(currentCost - BASELINE_COST) <= 0.01,
    gtin: normalize(product.gtin) === normalize(GTIN),
    preferred_offer: String(product.oferta_preferencial_id) === String(offer.id),
    no_local_listing: localListings.length === 0,
    no_local_duplicate: localDuplicates.length === 0,
  };

  const duplicate = await duplicatePreflight(token);
  const catalog = await catalogPreflight(token);
  const payloadVoltage = attributeValue(payload, 'VOLTAGE');
  const voltage = {
    local: /127\s*V/i.test(String(product.nome || '')),
    manufacturer: official.checks.voltage_127,
    catalog: catalog.fields.voltage,
    payload: normalize(payloadVoltage) === normalize('127V'),
  };
  voltage.passed = Object.values(voltage).every(Boolean);
  const imagePre = await auditImage(payload.pictures[0].source);
  const dimensions = `${Math.ceil(Number(dslite.product.altura_embalagem))}x${Math.ceil(Number(dslite.product.largura_embalagem))}x${Math.ceil(Number(dslite.product.profundidade_embalagem))},${Math.ceil(Number(dslite.product.peso_embalagem) * 1000)}`;
  const financialPre = await financialQuote(token, {
    price: payload.price, listingType: payload.listing_type_id, categoryId: payload.category_id,
    dimensions, cost: currentCost,
  });
  financialPre.target_margin_percent = 15.25;
  financialPre.approved = financialPre.values.margin_percent + 1e-9 >= 15.25;

  const prepost = {
    checked_at: now(), payload_hash: { actual: payloadHash, expected: AUTHORIZED_HASH, match: payloadHash === AUTHORIZED_HASH },
    local: { product: { id: product.id, sku: product.sku, ml_item_id: product.ml_item_id, ml_status: product.ml_status, estoque: product.estoque, custo: product.custo, gtin: product.gtin, fornecedor: product.fornecedor }, offer: { id: offer.id, estoque: offer.estoque, custo: offer.custo, dslite_fornecedor_id: offer.dslite_fornecedor_id, dslite_produto_id: offer.dslite_produto_id }, stock, local_listings: localListings, local_duplicates: localDuplicates, checks: localChecks, passed: Object.values(localChecks).every(Boolean) },
    remote_duplicate: duplicate,
    catalog: { fields: catalog.fields, passed: catalog.passed, wrong_voltage_catalog_selected: catalog.wrong_voltage_catalog_selected, picker_products: catalog.picker_products },
    official,
    dslite: { url: dslite.url, checked_at: dslite.checked_at, product: dslite.product },
    voltage,
    image: imagePre,
    financial: financialPre,
    writes_before_post: { mercado_livre_item_posts: metrics.ml_item_post_attempts, supabase: metrics.supabase_writes },
  };

  let abortResult = null;
  if (payloadHash !== AUTHORIZED_HASH || !contract.passed || !prepost.local.passed) abortResult = 'CANARY_ABORT_PAYLOAD_DRIFT';
  else if (duplicate.blocking_matches.length || duplicate.possible_matches.length) abortResult = 'CANARY_ABORT_REMOTE_MATCH';
  else if (!catalog.passed || catalog.wrong_voltage_catalog_selected) abortResult = 'CANARY_ABORT_CATALOG_DRIFT';
  else if (!voltage.passed) abortResult = 'CANARY_ABORT_VOLTAGE_CONFLICT';
  else if (!financialPre.approved) abortResult = 'CANARY_ABORT_MARGIN_DRIFT';
  else if (!imagePre.passed) abortResult = 'CANARY_ABORT_IMAGE_DRIFT';

  if (abortResult) {
    const empty = createEmptyReports(abortResult);
    const summary = { phase: '5C', generated_at: now(), result: abortResult, sku: SKU, post_executed: false, payload_sha256: payloadHash, prepost, metrics, hold: HOLD };
    persistReports({ summary, gates: prepost, payloadReport, ...empty, full: { ...summary, payload: payloadReport, reports: empty, writes: { mercado_livre_posts: 0, supabase: 0, description: 0 } } });
    console.log(JSON.stringify({ event: 'p0_phase5c_aborted', result: abortResult, metrics }));
    return;
  }

  const postStarted = new Date();
  const monotonicStart = process.hrtime.bigint();
  let created;
  let postNetworkError = null;
  try {
    created = await mlRequest(token, '/items', { method: 'POST', authorizedItemPost: true, body: payload, timeout: 90000 });
  } catch (error) {
    postNetworkError = error;
    created = { ok: false, status: 0, data: { error: 'network_error', message: error.message }, headers: new Headers() };
  }
  const elapsedMs = Number(process.hrtime.bigint() - monotonicStart) / 1e6;
  const post = {
    result: created.ok ? 'POST_ACCEPTED' : created.status >= 500 || postNetworkError ? 'CATALOG_CANARY_API_ERROR' : 'CATALOG_CANARY_VALIDATION_ERROR',
    attempted_at_utc: postStarted.toISOString(), attempted_at_local: localTimestamp(postStarted), completed_at: now(),
    endpoint: 'POST https://api.mercadolibre.com/items', http_status: created.status,
    request_id: requestId(created.headers), response_headers: safeHeaders(created.headers), response_body: created.data,
    payload_sha256: payloadHash, elapsed_ms: elapsedMs,
    item_id: created.data?.id || null, user_product_id: created.data?.user_product_id || null,
    family_id: created.data?.family_id || null, catalog_product_id: created.data?.catalog_product_id || null,
    one_post_guard: { attempts: metrics.ml_item_post_attempts, successful: metrics.ml_item_posts_successful, other_writes: metrics.ml_other_writes },
  };

  if (!created.ok || !created.data?.id) {
    let ghost = null;
    let result = post.result;
    if (created.status >= 500 || postNetworkError) {
      ghost = await ghostReconcile(token);
      if (ghost.matches.length) result = 'CANARY_GHOST_CREATION_DETECTED';
    }
    const empty = createEmptyReports(result);
    const summary = { phase: '5C', generated_at: now(), result, sku: SKU, post_executed: true, payload_sha256: payloadHash, prepost, post, ghost, metrics, hold: HOLD };
    persistReports({ summary, gates: prepost, payloadReport, post, item: empty.item, userProduct: empty.userProduct, family: empty.family, catalog: { ...empty.catalog, ghost }, image: empty.image, financial: { ...empty.financial, prepost: financialPre }, competition: empty.competition, full: { ...summary, payload: payloadReport, writes: { mercado_livre_posts: metrics.ml_item_post_attempts, supabase: 0, description: 0 } } });
    console.log(JSON.stringify({ event: 'p0_phase5c_post_failed', result, http_status: post.http_status, request_id: post.request_id, metrics }));
    return;
  }

  const itemId = String(created.data.id);
  const readback = await postReadback(token, itemId);
  const item = readback.item;
  const remoteSku = item.seller_custom_field || attributeValue(item, 'SELLER_SKU');
  const familyId = item.family_id || readback.userProduct?.family_id || null;
  const title = titleClassification(item.title);
  const identityFields = [
    compareField('seller_id', SELLER_ID, item.seller_id, { numeric: true }),
    compareField('SKU', SKU, remoteSku),
    compareField('GTIN', GTIN, attributeValue(item, 'GTIN')),
    compareField('BRAND', 'Ventisol', attributeValue(item, 'BRAND')),
    compareField('MODEL', 'Turbo 6', attributeValue(item, 'MODEL')),
    compareField('VOLTAGE', '127V', attributeValue(item, 'VOLTAGE')),
    compareField('BLADES_COLOR', 'Azul', attributeValue(item, 'BLADES_COLOR')),
    compareField('DIAMETER', '40 cm', attributeValue(item, 'DIAMETER')),
    compareField('category_id', CATEGORY_ID, item.category_id),
    compareField('catalog_product_id', CATALOG_PRODUCT_ID, item.catalog_product_id),
    compareField('price', AUTHORIZED_PRICE, item.price, { numeric: true }),
    compareField('available_quantity', AUTHORIZED_STOCK, item.available_quantity, { numeric: true }),
    compareField('listing_type_id', 'gold_special', item.listing_type_id),
    compareField('condition', 'new', item.condition),
  ];
  const postCatalog = await catalogPreflight(token);
  const catalogValidation = {
    checked_at: now(), item_id: itemId,
    fields: {
      catalog_product_id: item.catalog_product_id === CATALOG_PRODUCT_ID,
      catalog_listing: item.catalog_listing === true,
      category_id: item.category_id === CATEGORY_ID,
      voltage: normalize(attributeValue(item, 'VOLTAGE')) === normalize('127V'),
      not_220_catalog: item.catalog_product_id !== WRONG_VOLTAGE_CATALOG_PRODUCT_ID,
      catalog_still_exact: postCatalog.passed,
    },
    identity_fields: identityFields,
    title,
  };
  catalogValidation.passed = Object.values(catalogValidation.fields).every(Boolean);
  const imagePost = await postImageAudit(token, payload, item);
  const financialPost = await financialQuote(token, {
    price: Number(item.price), listingType: item.listing_type_id, categoryId: item.category_id,
    itemId, cost: currentCost,
  });
  financialPost.prepost = financialPre.values;
  financialPost.minimum_post_margin_percent = 15;
  financialPost.approved = financialPost.values.margin_percent + 1e-9 >= 15;
  financialPost.drift = {
    commission: financialPost.values.commission - financialPre.values.commission,
    shipping: financialPost.values.shipping - financialPre.values.shipping,
    profit: financialPost.values.profit - financialPre.values.profit,
    margin_percentage_points: financialPost.values.margin_percent - financialPre.values.margin_percent,
  };
  const competition = await competitionReadback(token, itemId);

  const [localAfterProduct, localAfterListings] = await Promise.all([
    dbOne('produtos', 'id,sku,ml_item_id,ml_status', (query) => query.eq('id', PRODUCT_ID).limit(1)),
    dbSelect('anuncios_ml', 'id,ml_item_id,produto_id,sku,status', (query) => query.or(`produto_id.eq.${PRODUCT_ID},sku.eq.${SKU},ml_item_id.eq.${itemId}`)),
  ]);
  const localPersistence = {
    performed: false,
    product: localAfterProduct,
    listings: localAfterListings,
    unchanged: !localAfterProduct?.ml_item_id && localAfterListings.length === 0,
  };
  const catalogDrift = !catalogValidation.passed;
  const identityDrift = identityFields.some((row) => row.material && row.status === 'DIVERGENT') || title.status === 'GENERATED_TITLE_MATERIAL_ERROR';
  const normalized = imagePost.rehosted || title.status === 'GENERATED_TITLE_WEAK' || item.title !== payload.family_name;
  const result = classifyFinal({
    catalogDrift,
    identityDrift,
    financialDrift: !financialPost.approved,
    materialImageDrift: imagePost.material,
    normalized,
  });
  const summary = {
    phase: '5C', generated_at: now(), result, sku: SKU, produto_id: PRODUCT_ID,
    item_id: itemId, user_product_id: item.user_product_id || null, family_id: familyId,
    title: item.title, status: item.status, permalink: item.permalink,
    payload_sha256: payloadHash, post: { http_status: post.http_status, request_id: post.request_id, elapsed_ms: post.elapsed_ms },
    catalog: catalogValidation, image: { classification: imagePost.classification, pictures: imagePost.rows.length },
    financial: financialPost, competition,
    local_persistence: localPersistence,
    description_posted: false,
    metrics,
    invariants: {
      exactly_one_item_post: metrics.ml_item_post_attempts === 1,
      no_other_ml_writes: metrics.ml_other_writes === 0,
      no_supabase_writes: metrics.supabase_writes === 0,
      no_description_write: true,
      single_sku: SKU,
    },
    hold: HOLD,
  };
  const full = {
    ...summary, started_at: startedAt, completed_at: now(), prepost, payload: payloadReport,
    post_response: post, item_readback: readback, user_product_readback: readback.userProduct,
    family_readback: readback.family, catalog_link_validation: catalogValidation,
    image_validation: imagePost, financial_validation: financialPost,
    competition_postpublish: competition,
    local_persistence: localPersistence,
    official_contracts: {
      user_products: 'https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products',
      catalog_required: 'https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/publicacoes-necessarias-do-catalogo',
      competition: 'https://developers.mercadolivre.com.br/concorrencia-em-catalogo',
      shipping: 'https://developers.mercadolivre.com.br/pt_br/mercadolideres-lojas-oficiais/mercado-envios-custos-e-cotacoes',
      fees: 'https://developers.mercadolivre.com.br/en_us/product-identifiers/fees-for-listing',
      images: 'https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/trabalhar-com-imagens',
      supabase_select: 'https://supabase.com/docs/reference/javascript/select',
      dslite: 'https://documenter.getpostman.com/view/5316990/RWaRNkaA',
    },
    writes: { mercado_livre_item_posts: metrics.ml_item_post_attempts, mercado_livre_other: metrics.ml_other_writes, supabase: metrics.supabase_writes, description: 0 },
  };
  persistReports({
    summary, gates: prepost, payloadReport, post,
    item: { checked_at: readback.checked_at, attempts: readback.attempts, item },
    userProduct: { checked_at: readback.checked_at, user_product: readback.userProduct },
    family: { checked_at: readback.checked_at, family_id: familyId, family: readback.family },
    catalog: catalogValidation, image: imagePost, financial: financialPost, competition, full,
  });
  console.log(JSON.stringify({ event: 'p0_phase5c_complete', result, item_id: itemId, user_product_id: item.user_product_id, family_id: familyId, http_status: post.http_status, request_id: post.request_id, title: item.title, status: item.status, catalog: item.catalog_product_id, financial: financialPost.values, image: imagePost.classification, metrics }));
}

main().catch((error) => {
  const result = metrics.ml_item_post_attempts > 0 ? 'CATALOG_CANARY_API_ERROR' : 'CANARY_ABORT_PAYLOAD_DRIFT';
  const empty = createEmptyReports(result);
  const summary = { phase: '5C', generated_at: now(), result, error: error.message, sku: SKU, metrics, hold: HOLD };
  persistReports({ summary, gates: { error: error.message }, payloadReport: fs.existsSync(SOURCE_PAYLOAD) ? readJson(SOURCE_PAYLOAD) : {}, ...empty, full: { ...summary, writes: { mercado_livre_item_posts: metrics.ml_item_post_attempts, mercado_livre_other: metrics.ml_other_writes, supabase: metrics.supabase_writes, description: 0 } } });
  console.error(JSON.stringify({ event: 'p0_phase5c_failed', result, error: error.message, metrics }));
  process.exitCode = 1;
});
