#!/usr/bin/env node
/* Canary-only publisher: exactly one POST /items, no other ML writes and no local writes. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  classifyRemoteItem,
  normalizeGtin,
  plain,
  sha256,
  text,
  validateGeneratedTitle,
} = require('./lib/ml-p0-phase4');

dotenv.config({ path: '.env.local', quiet: true });

const SKU = 'VTK000486';
const PRODUCT_ID = 'e232fe84-9f89-4d22-9737-8d444e5f7db9';
const CATEGORY_ID = 'MLB11290';
const AUTHORIZED_PRIOR_PAYLOAD_HASH = '7382d51ac0cf6e9ba2bcbf6ea9573487d11ff7ee6a2db2a24cb7dd1ba8310e42';
const AUTHORIZED_FAMILY_PAYLOAD_HASH = 'd8c003700d5277c1e7382c2b972a8e918b64bc1a400fbf4cea3176784fad9b07';
const AUTHORIZED_ATTEMPT3_PAYLOAD_HASH = '653cefbbb29736d4973a8099f939923efef7d196a22b005400243b5e85609792';
const AUTHORIZED_PRIOR_PRICE = 187.21;
const AUTHORIZED_PRICE = 187.22;
const AUTHORIZED_FAMILY_NAME = 'Carregador de Pilhas Toshiba TNHC-6GAE4 CB';
const OFFICIAL_URL = 'https://www.toshibaenergia.com.br/carregador-de-pilha-com-4-pilhas-TNHC-6GAE4-aa-aaa-toshiba';
const PHASE4B2_MODE = process.env.ML_P0_PHASE4B2 === '1';
const SOURCE_REPORT_DIR = path.resolve('reports/ml-p0-phase4');
const REPORT_DIR = PHASE4B2_MODE ? path.resolve('reports/ml-p0-phase4b2') : SOURCE_REPORT_DIR;
const PAYLOAD_PATH = path.join(SOURCE_REPORT_DIR, 'canary-prepublish-payload.json');
const SOURCE_SUMMARY_PATH = path.join(SOURCE_REPORT_DIR, 'canary-prepublish-summary.json');
const SOURCE_FULL_REPORT_PATH = path.join(SOURCE_REPORT_DIR, 'full-report.json');
const SOURCE_POST_RESPONSE_PATH = path.join(SOURCE_REPORT_DIR, 'canary-post-response.json');
const SUMMARY_PATH = path.join(REPORT_DIR, 'canary-prepublish-summary.json');
const FULL_REPORT_PATH = path.join(REPORT_DIR, 'full-report.json');
const POST_RESPONSE_PATH = path.join(REPORT_DIR, 'canary-post-response.json');
const READBACK_PATH = path.join(REPORT_DIR, 'canary-readback.json');
const DIFF_PATH = path.join(REPORT_DIR, 'canary-diff.json');
const FINANCIAL_PATH = path.join(REPORT_DIR, 'canary-financial-validation.json');
const now = () => new Date().toISOString();
const saoPauloTimestamp = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const offset = String(parts.timeZoneName || 'GMT-03:00').replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const metrics = {
  supabase_reads: 0,
  supabase_writes: 0,
  dslite_reads: 0,
  manufacturer_reads: 0,
  ml_gets: 0,
  ml_item_post_attempts: 0,
  ml_item_posts_successful: 0,
  ml_other_writes: 0,
};
let lastMlRequestAt = 0;

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`required_report_missing:${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchResponse(url, options = {}, service = 'web') {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeout || 60000),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return {
    ok: response.ok,
    status: response.status,
    data,
    raw,
    headers: Object.fromEntries(response.headers.entries()),
    final_url: response.url,
  };
}

async function mlRequest(token, pathname, options = {}) {
  const { allowNotFound = false, ...requestOptions } = options;
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    if (method !== 'POST' || pathname !== '/items') {
      metrics.ml_other_writes += 1;
      throw new Error(`phase4b_write_forbidden:${method}:${pathname}`);
    }
    if (metrics.ml_item_post_attempts >= 1) throw new Error('phase4b_second_item_post_forbidden');
    metrics.ml_item_post_attempts += 1;
  } else {
    metrics.ml_gets += 1;
  }
  const wait = 105 - (Date.now() - lastMlRequestAt);
  if (wait > 0) await sleep(wait);
  lastMlRequestAt = Date.now();
  const response = await fetchResponse(`https://api.mercadolibre.com${pathname}`, {
    ...requestOptions,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }, 'ml');
  if (method === 'POST' && response.ok) metrics.ml_item_posts_successful += 1;
  if (!response.ok && method === 'GET' && !(allowNotFound && response.status === 404)) {
    const error = new Error(`ml_http_${response.status}:${text(response.raw).slice(0, 500)}`);
    error.response = response;
    throw error;
  }
  return response;
}

async function one(table, select, configure) {
  metrics.supabase_reads += 1;
  let query = supabase.from(table).select(select);
  query = configure(query);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${table}:${error.message}`);
  return data;
}

async function many(table, select, configure) {
  metrics.supabase_reads += 1;
  let query = supabase.from(table).select(select);
  query = configure(query);
  const { data, error } = await query;
  if (error) throw new Error(`${table}:${error.message}`);
  return data || [];
}

function attribute(item, id) {
  const row = (item?.attributes || []).find((entry) => String(entry?.id) === id);
  return text(row?.value_name || row?.value_id);
}

function expectedAttribute(payload, id) {
  const row = (payload.attributes || []).find((entry) => String(entry?.id) === id);
  return text(row?.value_name || row?.value_id);
}

function classifyPostError(response) {
  const joined = plain(JSON.stringify(response?.data || {}));
  if (response?.status === 401 || response?.status === 403) return 'AUTH_ERROR';
  if (response?.status === 429) return 'RATE_LIMIT';
  if (joined.includes('category')) return 'CATEGORY_ERROR';
  if (joined.includes('attribute')) return 'ATTRIBUTE_ERROR';
  if (joined.includes('price')) return 'PRICE_ERROR';
  if (joined.includes('picture') || joined.includes('image')) return 'IMAGE_ERROR';
  if (joined.includes('shipping')) return 'SHIPPING_ERROR';
  if (response?.status >= 500) return 'API_ERROR';
  if (response?.status >= 400 && response?.status < 500) return 'VALIDATION_ERROR';
  return 'UNKNOWN';
}

async function loadContext() {
  const product = await one('produtos', '*', (query) => query.eq('id', PRODUCT_ID));
  if (!product || product.sku !== SKU) throw new Error('canary_product_identity_changed');
  const offer = await one('produto_fornecedor_ofertas', '*', (query) => query.eq('id', product.oferta_preferencial_id));
  const integrations = await many('integracoes', 'tipo,url,access_token,conectado,token_expires_at,updated_at', (query) => query.in('tipo', ['dslite', 'mercadolivre']));
  const byType = Object.fromEntries(integrations.map((row) => [row.tipo, row]));
  if (!offer?.ativo || !byType.dslite?.conectado || !byType.mercadolivre?.conectado) throw new Error('canary_integration_or_offer_unavailable');
  const account = await assertAllowedMercadoLivreToken(byType.mercadolivre.access_token, 'ml-p0-phase4b');
  const listings = await many('anuncios_ml', 'id,ml_item_id,produto_id,sku,status', (query) => query.or(`produto_id.eq.${PRODUCT_ID},sku.eq.${SKU}`));
  const duplicates = await many('produtos', 'id,sku,nome,gtin,dslite_produto_id,ml_item_id', (query) => query.or(`gtin.eq.${product.gtin},dslite_produto_id.eq.${product.dslite_produto_id},nome.ilike.%TNHC-6GAE4%`));
  const kitLinks = await many('produto_kit_componentes', 'kit_produto_id,componente_produto_id,quantidade', (query) => query.or(`kit_produto_id.eq.${PRODUCT_ID},componente_produto_id.eq.${PRODUCT_ID}`));
  const pendingItems = await many('pedido_itens', 'pedido_id,seller_sku,quantidade,ml_item_id,created_at', (query) => query.ilike('seller_sku', SKU));
  const purchases = await many('compras', 'id,status,status_dslite,produto_sku,quantidade,data_criacao', (query) => query.eq('produto_sku', SKU));
  const internalMovements = await many('estoque_interno_movimentacoes', 'tipo,quantidade,situacao_estoque,estornada_em,created_at', (query) => query.eq('produto_id', PRODUCT_ID));
  return {
    product,
    offer,
    integrations: byType,
    account,
    listings,
    duplicates: duplicates.filter((row) => row.id !== PRODUCT_ID),
    kitLinks,
    pendingItems,
    purchases,
    internalMovements,
  };
}

async function fetchDslite(context) {
  const url = `${String(context.integrations.dslite.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${context.offer.dslite_fornecedor_id}/${context.offer.dslite_produto_id}`;
  metrics.dslite_reads += 1;
  const response = await fetchResponse(url, { headers: { Token: context.integrations.dslite.access_token } }, 'dslite');
  if (!response.ok) throw new Error(`dslite_http_${response.status}`);
  const rows = Array.isArray(response.data?.produtos) ? response.data.produtos : [];
  const product = rows.find((row) => String(row.produtoid) === String(context.offer.dslite_produto_id)) || rows[0];
  if (!product) throw new Error('dslite_canary_missing');
  return { url, product, consulted_at: now() };
}

async function checkOfficialSource() {
  metrics.manufacturer_reads += 1;
  const response = await fetchResponse(OFFICIAL_URL);
  if (!response.ok) throw new Error(`manufacturer_http_${response.status}`);
  const checks = ['4904530109270', 'TNHC-6GAE4 CB', 'Bivolt', 'AA/AAA', '2600mAh']
    .map((needle) => ({ needle, found: plain(response.raw).includes(plain(needle)) }));
  if (checks.some((check) => !check.found)) throw new Error('manufacturer_identity_drift');
  return { url: OFFICIAL_URL, consulted_at: now(), checks, official_input_voltage: 'AC 100-240V 50/60Hz' };
}

async function checkImages(payload) {
  const images = [];
  for (const [index, picture] of (payload.pictures || []).entries()) {
    const response = await fetch(String(picture.source), { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = response.ok && String(response.headers.get('content-type') || '').startsWith('image/')
      ? await sharp(buffer).metadata() : {};
    images.push({
      order: index + 1,
      url: picture.source,
      http_status: response.status,
      content_type: response.headers.get('content-type'),
      width: metadata.width || null,
      height: metadata.height || null,
      valid: response.ok && String(response.headers.get('content-type') || '').startsWith('image/')
        && Number(metadata.width) >= 250 && Number(metadata.height) >= 250,
    });
  }
  return { checked_at: now(), images, passed: images.length === 9 && images.every((image) => image.valid) };
}

async function scanRemoteInventory(token, account) {
  const ids = [];
  const scrolls = new Set();
  let scrollId = '';
  let expectedTotal = null;
  let pages = 0;
  while (pages < 1000) {
    const query = scrollId ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}` : 'search_type=scan&limit=100';
    const page = (await mlRequest(token, `/users/${account.userId}/items/search?${query}`)).data;
    pages += 1;
    if (expectedTotal === null) expectedTotal = Number(page?.paging?.total || 0);
    const results = (page?.results || []).map(String);
    ids.push(...results);
    if (!results.length || new Set(ids).size >= expectedTotal) break;
    const next = text(page?.scroll_id);
    if (!next || scrolls.has(next)) break;
    scrolls.add(next);
    scrollId = next;
  }
  const uniqueIds = [...new Set(ids)];
  const items = [];
  const fields = 'id,title,family_name,family_id,status,sub_status,seller_id,seller_custom_field,user_product_id,catalog_product_id,category_id,attributes,variations,price,available_quantity,sold_quantity,listing_type_id,catalog_listing,permalink';
  for (let index = 0; index < uniqueIds.length; index += 20) {
    const batch = uniqueIds.slice(index, index + 20);
    const rows = (await mlRequest(token, `/items?ids=${batch.join(',')}&attributes=${fields}`)).data;
    for (const row of rows || []) if (Number(row.code) === 200 && row.body?.id) items.push(row.body);
  }
  const reliable = uniqueIds.length === expectedTotal && items.length === uniqueIds.length;
  if (!reliable) throw new Error(`remote_inventory_unreliable:${uniqueIds.length}/${expectedTotal}/${items.length}`);
  return { expected_total: expectedTotal, captured: uniqueIds.length, detailed: items.length, pages, reliable, items };
}

async function duplicatePreflight(token, account, payload, catalogProductId) {
  const direct = [];
  for (const [method, value] of [['seller_sku', SKU], ['sku', SKU], ['q', 'TNHC-6GAE4']]) {
    const response = await mlRequest(token, `/users/${account.userId}/items/search?${method}=${encodeURIComponent(value)}&limit=100`);
    direct.push({ method, value, total: Number(response.data?.paging?.total || 0), item_ids: (response.data?.results || []).map(String) });
  }
  const inventory = await scanRemoteInventory(token, account);
  const expected = {
    sku: SKU,
    gtin: expectedAttribute(payload, 'GTIN'),
    brand: expectedAttribute(payload, 'BRAND'),
    model: expectedAttribute(payload, 'MODEL'),
    catalog_product_id: catalogProductId || '',
  };
  const matches = inventory.items
    .map((item) => ({ item, match: classifyRemoteItem(item, expected) }))
    .filter((row) => row.match.match_type !== 'NOT_MATCH')
    .map((row) => ({ item_id: row.item.id, title: row.item.title, status: row.item.status, ...row.match }));
  const familyCandidates = inventory.items
    .filter((item) => plain(item.family_name) === plain(payload.family_name))
    .map((item) => ({
      item_id: item.id,
      title: item.title,
      family_name: item.family_name,
      family_id: item.family_id || null,
      user_product_id: item.user_product_id || null,
      status: item.status,
      identity: classifyRemoteItem(item, expected),
    }));
  const familyDetails = [];
  for (const candidate of familyCandidates) {
    let userProduct = null;
    let family = null;
    if (candidate.user_product_id) {
      const response = await mlRequest(token, `/user-products/${encodeURIComponent(candidate.user_product_id)}`, { allowNotFound: true });
      userProduct = response.status === 404 ? null : response.data;
    }
    const familyId = candidate.family_id || userProduct?.family_id;
    if (familyId) {
      const response = await mlRequest(token, `/sites/MLB/user-products-families/${encodeURIComponent(familyId)}`, { allowNotFound: true });
      family = response.status === 404 ? null : response.data;
    }
    familyDetails.push({ ...candidate, user_product: userProduct, family });
  }
  return {
    checked_at: now(),
    seller_id: account.userId,
    methods: ['seller_sku', 'sku', 'title_model', 'gtin_via_full_item_attributes', 'catalog_product_id_via_full_item_details', 'user_product_id_via_full_item_details', 'item_id_full_inventory', 'all_statuses_from_seller_scan'],
    direct,
    inventory: { ...inventory, items: undefined },
    matches,
    blocking_matches: matches.filter((row) => row.confidence >= 95),
    family_candidates: familyDetails,
    existing_equivalent_family: familyDetails.length > 0,
  };
}

function financialFromQuote(payload, context, fee, shipping) {
  const price = Number(payload.price);
  const cost = Number(context.offer.custo);
  const commission = Number(fee?.sale_fee_amount || 0);
  const shippingCost = Number(shipping?.coverage?.all_country?.list_cost || 0);
  const tax = price * 0.05;
  const profit = price - commission - shippingCost - cost - tax;
  const margin = price > 0 ? (profit / price) * 100 : 0;
  return {
    checked_at: now(),
    price,
    listing_type_id: payload.listing_type_id,
    cost,
    commission,
    commission_rate_percent: Number(fee?.sale_fee_details?.percentage_fee || 0),
    shipping: shippingCost,
    tax,
    other_expenses: 0,
    profit,
    margin_percent: margin,
    target_margin_percent: 15,
    approved: profit >= 20 && margin + 0.001 >= 15,
    fee_quote: fee,
    shipping_quote: shipping,
  };
}

async function currentFinancial(token, context, payload) {
  const feeParams = new URLSearchParams({ price: Number(payload.price).toFixed(2), category_id: payload.category_id, listing_type_id: payload.listing_type_id, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
  const feeData = (await mlRequest(token, `/sites/MLB/listing_prices?${feeParams}`)).data;
  const fee = Array.isArray(feeData) ? feeData.find((row) => row.listing_type_id === payload.listing_type_id) || feeData[0] : feeData;
  const dimensions = '17x13x12,262';
  const shippingParams = new URLSearchParams({ dimensions, verbose: 'true', item_price: Number(payload.price).toFixed(2), listing_type_id: payload.listing_type_id, mode: 'me2', condition: 'new', logistic_type: 'drop_off', free_shipping: 'true' });
  const shipping = (await mlRequest(token, `/users/${context.account.userId}/shipping_options/free?${shippingParams}`)).data;
  return financialFromQuote(payload, context, fee, shipping);
}

function compareField(field, expected, remote, options = {}) {
  const exact = options.numeric
    ? Math.abs(Number(expected) - Number(remote)) < 0.01
    : String(expected ?? '') === String(remote ?? '');
  if (exact) return { field, expected, remote, status: 'MATCH', material: false };
  if (options.normalized && options.normalized(expected, remote)) {
    return { field, expected, remote, status: 'NORMALIZED_BY_ML', material: false, reason: options.reason || null };
  }
  return { field, expected, remote, status: remote === null || remote === undefined || remote === '' ? 'MISSING' : 'DIVERGENT', material: options.material !== false };
}

function buildDiff(payload, item, description, officialVoltage, userProduct) {
  const generatedTitle = validateGeneratedTitle(item.title);
  const rows = [
    compareField('SKU', SKU, attribute(item, 'SELLER_SKU') || item.seller_custom_field),
    compareField('GTIN', expectedAttribute(payload, 'GTIN'), attribute(item, 'GTIN')),
    {
      field: 'title_generated_by_ml',
      expected: { brand: 'Toshiba', model: 'TNHC-6GAE4 CB', product_type: 'Carregador de pilhas', kit_details_if_present: '4 pilhas AA 2600mAh' },
      remote: item.title,
      status: generatedTitle.valid ? 'NORMALIZED_BY_ML' : 'DIVERGENT',
      material: !generatedTitle.valid,
      analysis: generatedTitle,
    },
    compareField('family_name', payload.family_name, item.family_name),
    compareField('family_id', 'assigned_by_ml', item.family_id || userProduct?.family_id, { normalized: (expected, remote) => expected === 'assigned_by_ml' && Boolean(remote), reason: 'identifier_assigned_by_ml' }),
    compareField('user_product_id', 'assigned_by_ml', item.user_product_id || userProduct?.id, { normalized: (expected, remote) => expected === 'assigned_by_ml' && Boolean(remote), reason: 'identifier_assigned_by_ml' }),
    compareField('price', payload.price, item.price, { numeric: true }),
    compareField('available_quantity', payload.available_quantity, item.available_quantity, { numeric: true }),
    compareField('category_id', payload.category_id, item.category_id),
    compareField('BRAND', expectedAttribute(payload, 'BRAND'), attribute(item, 'BRAND'), { normalized: (a, b) => plain(a) === plain(b), reason: 'capitalization' }),
    compareField('MODEL', expectedAttribute(payload, 'MODEL'), attribute(item, 'MODEL')),
    compareField('PRODUCT_TYPE', expectedAttribute(payload, 'PRODUCT_TYPE'), attribute(item, 'PRODUCT_TYPE')),
    compareField('INPUT_VOLTAGE', officialVoltage, attribute(item, 'INPUT_VOLTAGE'), {
      normalized: (expected, remote) => expected === '100-240V' && remote === '127/220V',
      reason: 'official_ac_100_240v_normalized_to_only_compatible_ml_enum_127_220v',
    }),
    compareField('pictures_count', payload.pictures.length, (item.pictures || []).length, { numeric: true }),
    compareField('listing_type_id', payload.listing_type_id, item.listing_type_id),
    compareField('shipping.mode', payload.shipping.mode, item.shipping?.mode),
    compareField('shipping.free_shipping', payload.shipping.free_shipping, item.shipping?.free_shipping),
    compareField('condition', payload.condition, item.condition),
    compareField('catalog_listing', false, item.catalog_listing === true),
    {
      field: 'description',
      expected: 'not_sent_phase_4c_pending',
      remote: description?.plain_text || '',
      status: description?.plain_text ? 'DIVERGENT' : 'MATCH',
      material: Boolean(description?.plain_text),
      reason: 'description_post_not_authorized_in_phase_4b',
    },
    compareField('status', 'active', item.status),
  ];
  if ((item.pictures || []).length === payload.pictures.length) {
    const pictureRow = rows.find((row) => row.field === 'pictures_count');
    pictureRow.status = 'NORMALIZED_BY_ML';
    pictureRow.reason = 'source_urls_ingested_and_rehosted_by_ml';
  }
  return {
    generated_at: now(),
    official_input_voltage: '100-240V',
    submitted_input_voltage: expectedAttribute(payload, 'INPUT_VOLTAGE'),
    normalization_rule: '100-240V -> 127/220V accepted only because live category schema has no 100-240V enum and official range covers both nominal voltages',
    fields: rows,
    material_drift: rows.some((row) => row.material && ['DIVERGENT', 'MISSING'].includes(row.status)),
  };
}

async function readBack(token, itemId) {
  let item = null;
  let description = null;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    item = (await mlRequest(token, `/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`)).data;
    description = (await mlRequest(token, `/items/${encodeURIComponent(itemId)}/description`, { allowNotFound: true })).data;
    const picturesReady = (item.pictures || []).length > 0 && (item.pictures || []).every((picture) => !String(picture.secure_url || picture.url || '').includes('processing-image'));
    const familyReady = Boolean(item.family_name && item.user_product_id);
    const subStatus = Array.isArray(item.sub_status) ? item.sub_status : [];
    const fatal = item.status === 'closed' || item.status === 'under_review'
      || subStatus.includes('waiting_for_patch') || subStatus.includes('under_review');
    if ((item.status === 'active' && picturesReady && familyReady) || fatal || attempt === 18) break;
    await sleep(5000);
  }
  const pictureDiagnostics = [];
  for (const picture of item.pictures || []) {
    const response = await fetchResponse(`https://api.mercadolibre.com/pictures/${encodeURIComponent(picture.id)}/errors`, {
      headers: { Authorization: `Bearer ${token}` },
    }, 'ml');
    metrics.ml_gets += 1;
    if (response.status !== 404 && !response.ok) throw new Error(`picture_diagnostic_http_${response.status}`);
    const errors = response.status === 404 ? [] : Array.isArray(response.data) ? response.data : response.data?.errors || [];
    pictureDiagnostics.push({ picture_id: picture.id, status: response.status, errors });
  }
  let userProduct = null;
  let family = null;
  if (item.user_product_id) {
    const response = await mlRequest(token, `/user-products/${encodeURIComponent(item.user_product_id)}`, { allowNotFound: true });
    userProduct = response.status === 404 ? null : response.data;
  }
  const familyId = item.family_id || userProduct?.family_id;
  if (familyId) {
    const response = await mlRequest(token, `/sites/MLB/user-products-families/${encodeURIComponent(familyId)}`, { allowNotFound: true });
    family = response.status === 404 ? null : response.data;
  }
  return { read_at: now(), item, description, user_product: userProduct, family, picture_diagnostics: pictureDiagnostics };
}

async function postFinancial(token, context, payload, item, predicted) {
  const remotePayload = { ...payload, price: Number(item.price), listing_type_id: item.listing_type_id };
  const actual = await currentFinancial(token, context, remotePayload);
  return {
    generated_at: now(),
    predicted,
    remote: actual,
    profit_difference: actual.profit - predicted.profit,
    margin_percentage_point_difference: actual.margin_percent - predicted.margin_percent,
    financial_drift: Math.abs(actual.profit - predicted.profit) >= 0.01
      || Math.abs(actual.margin_percent - predicted.margin_percent) >= 0.01,
  };
}

function responseRequestId(headers) {
  return headers['x-request-id'] || headers['x-correlation-id'] || headers['x-trace-id'] || null;
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const startedAt = now();
  const payload = readJson(PAYLOAD_PATH);
  const phase4a = readJson(SOURCE_SUMMARY_PATH);
  const priorFull = readJson(SOURCE_FULL_REPORT_PATH);
  const priorPostResponse = fs.existsSync(SOURCE_POST_RESPONSE_PATH) ? readJson(SOURCE_POST_RESPONSE_PATH) : null;
  if (!PHASE4B2_MODE && priorPostResponse?.http_status) {
    const archivedResponses = fs.readdirSync(REPORT_DIR)
      .filter((name) => /^canary-post-response-attempt-\d+\.json$/.test(name))
      .map((name) => ({ name, data: readJson(path.join(REPORT_DIR, name)) }));
    const alreadyArchived = archivedResponses.some((entry) => entry.data.request_id === priorPostResponse.request_id);
    if (!alreadyArchived) {
      const nextAttempt = archivedResponses.length + 1;
      writeJson(path.join(REPORT_DIR, `canary-post-response-attempt-${nextAttempt}.json`), priorPostResponse);
    }
  }
  const payloadHash = sha256(JSON.stringify(payload));
  if (PHASE4B2_MODE && payloadHash !== AUTHORIZED_ATTEMPT3_PAYLOAD_HASH) {
    const abort = {
      result: 'ABORT_PAYLOAD_DRIFT',
      generated_at: now(),
      generated_at_local: saoPauloTimestamp(),
      post_performed: false,
      expected_payload_sha256: AUTHORIZED_ATTEMPT3_PAYLOAD_HASH,
      actual_payload_sha256: payloadHash,
      metrics,
      hold: 'P0 PHASE 4B.2 — DIURNAL RETEST HOLD',
    };
    writeJson(POST_RESPONSE_PATH, abort);
    writeJson(FULL_REPORT_PATH, { ...priorFull, phase4b2: abort });
    console.log(JSON.stringify({ event: 'p0_phase4b2_aborted', result: abort.result, metrics }));
    return;
  }
  if (phase4a.result !== 'PREPUBLISH_READY' || phase4a.risks?.length
    || Number(payload.price) !== AUTHORIZED_PRICE
    || payload.family_name !== AUTHORIZED_FAMILY_NAME
    || Object.hasOwn(payload, 'title') || Object.hasOwn(payload, 'description')
    || ![AUTHORIZED_FAMILY_PAYLOAD_HASH, payloadHash].includes(priorFull.payload_sha256)
    || payloadHash !== AUTHORIZED_ATTEMPT3_PAYLOAD_HASH) {
    throw new Error('phase4a_approved_payload_invalid');
  }

  const context = await loadContext();
  const token = context.integrations.mercadolivre.access_token;
  const attemptHistory = [...(priorFull.phase4b_attempt_history || [])];
  if (priorFull.phase4b) attemptHistory.push(priorFull.phase4b);
  const dslite = await fetchDslite(context);
  const official = await checkOfficialSource();
  const [categoryResponse, schemaResponse, accountResponse, images] = await Promise.all([
    mlRequest(token, `/categories/${CATEGORY_ID}`),
    mlRequest(token, `/categories/${CATEGORY_ID}/attributes`),
    mlRequest(token, `/users/${context.account.userId}`),
    checkImages(payload),
  ]);
  const category = categoryResponse.data;
  const schema = schemaResponse.data || [];
  const inputSchema = schema.find((row) => row.id === 'INPUT_VOLTAGE');
  const parentPk = schema.filter((row) => row.hierarchy === 'PARENT_PK');
  const suppliedAttributeIds = new Set((payload.attributes || []).map((row) => row.id));
  const missingRequiredParentPk = parentPk
    .filter((row) => row.tags?.required || row.tags?.catalog_required)
    .filter((row) => !suppliedAttributeIds.has(row.id));
  const exactVoltage = (inputSchema?.values || []).find((value) => plain(value.name) === plain('100-240V'));
  const submittedVoltage = expectedAttribute(payload, 'INPUT_VOLTAGE');
  const voltageDecision = exactVoltage
    ? { schema_allows_official_exact_value: true, official_value: '100-240V', submitted_value: submittedVoltage, valid: submittedVoltage === exactVoltage.name }
    : { schema_allows_official_exact_value: false, official_value: '100-240V', submitted_value: submittedVoltage, allowed_values: (inputSchema?.values || []).map((value) => ({ id: value.id, name: value.name })), valid: submittedVoltage === '127/220V', required_diff_status: 'NORMALIZED_BY_ML' };

  const catalogSearch = await mlRequest(token, `/products/search?status=active&site_id=MLB&product_identifier=${normalizeGtin(context.product.gtin)}`);
  const catalog = (catalogSearch.data?.results || []).find((row) => row.id === 'MLB24107281') || null;
  const duplicate = await duplicatePreflight(token, context.account, payload, catalog?.id);
  const financial = await currentFinancial(token, context, payload);
  const familyValidation = {
    family_name: payload.family_name,
    characters: payload.family_name.length,
    max_characters: Number(category.settings?.max_title_length || 0),
    within_limit: payload.family_name.length <= Number(category.settings?.max_title_length || 0),
    seller_user_product_enabled: (accountResponse.data?.tags || []).includes('user_product_seller'),
    parent_pk: parentPk.map((row) => ({ id: row.id, name: row.name, required: Boolean(row.tags?.required || row.tags?.catalog_required), supplied: suppliedAttributeIds.has(row.id), value: expectedAttribute(payload, row.id) || null })),
    missing_required_parent_pk: missingRequiredParentPk.map((row) => row.id),
    existing_family_candidates: duplicate.family_candidates,
    existing_equivalent_family: duplicate.existing_equivalent_family,
    family_listing_endpoint_available: false,
    family_discovery_method: 'full_seller_item_inventory_with_family_name_family_id_user_product_id_and_parent_pk',
  };
  const refreshedSummary = {
    ...phase4a,
    generated_at: now(),
    financial: {
      ...phase4a.financial,
      price: financial.price,
      commission_policy_amount: financial.commission,
      commission_ml_quote_amount: financial.commission,
      shipping_cost: financial.shipping,
      tax_amount: financial.tax,
      estimated_operational_profit: financial.profit,
      estimated_operational_margin_percent: financial.margin_percent,
      minimum_safety_price: AUTHORIZED_PRICE,
      approved: financial.approved,
      fee_quote: financial.fee_quote,
      shipping_quote: financial.shipping_quote,
    },
    authorized_reprice: {
      from: AUTHORIZED_PRIOR_PRICE,
      to: AUTHORIZED_PRICE,
      all_other_payload_fields_preserved_by_hash: true,
      prior_payload_sha256: AUTHORIZED_PRIOR_PAYLOAD_HASH,
      current_payload_sha256: payloadHash,
    },
    family_name: {
      value: payload.family_name,
      characters: payload.family_name.length,
      limit: Number(category.settings?.max_title_length || 0),
      parent_pk_validated: missingRequiredParentPk.length === 0,
    },
    authorized_family_name: {
      value: payload.family_name,
      prior_payload_sha256: AUTHORIZED_FAMILY_PAYLOAD_HASH,
      current_payload_sha256: payloadHash,
    },
    authorized_attempt_3: {
      removed_fields: ['title', 'description'],
      all_remaining_fields_preserved: true,
      title_generated_by_ml: true,
      description_phase: 'PHASE_4C_NOT_AUTHORIZED',
    },
  };
  writeJson(SUMMARY_PATH, refreshedSummary);
  const preflight = {
    checked_at: now(),
    product: { id: context.product.id, sku: context.product.sku, active: context.product.ativo, ml_status: context.product.ml_status, ml_item_id: context.product.ml_item_id, gtin: context.product.gtin, stock: context.product.estoque, cost: context.product.custo },
    offer: { id: context.offer.id, active: context.offer.ativo, stock: context.offer.estoque, cost: context.offer.custo, dslite_supplier_id: context.offer.dslite_fornecedor_id, dslite_product_id: context.offer.dslite_produto_id },
    dslite: { url: dslite.url, stock: dslite.product.estoque, cost: Number(dslite.product.preco_revenda || dslite.product.preco_normal), gtin: dslite.product.ean11, model: dslite.product.modelo },
    official,
    category: { id: category.id, name: category.name, enabled: category.settings?.status === 'enabled', listing_allowed: category.settings?.listing_allowed },
    voltage_decision: voltageDecision,
    images,
    duplicate,
    family_validation: familyValidation,
    local_listings: context.listings,
    local_duplicates: context.duplicates,
    inventory_reservations: {
      pending_order_items: context.pendingItems.length,
      kit_links: context.kitLinks.length,
      pending_purchases: context.purchases.filter((purchase) => !['cancelado', 'cancelled', 'entregue', 'delivered'].includes(plain(purchase.status))).length,
      internal_movements: context.internalMovements.filter((movement) => !movement.estornada_em).length,
      effective_channel_stock: Number(dslite.product.estoque),
      quantity_to_publish: Number(payload.available_quantity),
    },
    financial,
  };
  const preflightFailures = [];
  if (!context.product.ativo || context.product.ml_status !== 'sem_anuncio' || context.product.ml_item_id) preflightFailures.push('product_state_drift');
  if (Number(context.product.estoque) !== 15 || Number(context.product.custo) !== 96.22) preflightFailures.push('product_stock_or_cost_drift');
  if (!context.offer.ativo || Number(context.offer.estoque) !== 15 || Number(context.offer.custo) !== 96.22) preflightFailures.push('offer_drift');
  if (Number(dslite.product.estoque) !== 15 || Number(dslite.product.preco_revenda || dslite.product.preco_normal) !== 96.22) preflightFailures.push('dslite_drift');
  if (normalizeGtin(dslite.product.ean11) !== '4904530109270' || text(dslite.product.modelo) !== 'TNHC-6GAE4 CB') preflightFailures.push('identity_drift');
  if (!category.settings?.listing_allowed || category.settings?.status !== 'enabled') preflightFailures.push('category_drift');
  if (!familyValidation.within_limit || familyValidation.missing_required_parent_pk.length) preflightFailures.push('family_schema_drift');
  if (familyValidation.existing_equivalent_family) preflightFailures.push('existing_family');
  if (!voltageDecision.valid) preflightFailures.push('voltage_schema_drift');
  if (!images.passed) preflightFailures.push('image_drift');
  if (duplicate.blocking_matches.length || duplicate.direct.some((row) => row.item_ids.length)) preflightFailures.push('remote_match');
  if (context.listings.length || context.duplicates.length) preflightFailures.push('local_duplicate_or_link');
  if (context.pendingItems.length || context.kitLinks.length
    || context.purchases.some((purchase) => !['cancelado', 'cancelled', 'entregue', 'delivered'].includes(plain(purchase.status)))) preflightFailures.push('inventory_reservation_drift');
  if (!financial.approved) preflightFailures.push('margin_drift');

  if (preflightFailures.length) {
    const result = preflightFailures.includes('existing_family') ? (PHASE4B2_MODE ? 'CANARY_ABORT_REMOTE_MATCH' : 'CANARY_ABORT_EXISTING_FAMILY')
      : preflightFailures.includes('remote_match') ? 'CANARY_ABORT_REMOTE_MATCH'
      : preflightFailures.includes('margin_drift') ? 'CANARY_ABORT_MARGIN'
        : preflightFailures.includes('image_drift') ? 'CANARY_ABORT_IMAGE' : 'CANARY_ABORT_DATA_DRIFT';
    const abort = { generated_at: now(), result, post_performed: false, failures: preflightFailures, preflight, metrics };
    writeJson(FINANCIAL_PATH, {
      generated_at: now(),
      stage: 'pre_post',
      result,
      previous_phase4a: phase4a.financial,
      current: financial,
      explanation: preflightFailures.includes('margin_drift')
        ? 'rounded_ml_commission_amount_reduces_margin_below_configured_target'
        : null,
    });
    writeJson(POST_RESPONSE_PATH, abort);
    const fullAbort = { ...priorFull, payload_sha256: payloadHash, financial: refreshedSummary.financial, authorized_reprice: refreshedSummary.authorized_reprice, authorized_family_name: refreshedSummary.authorized_family_name, phase4b_attempt_history: attemptHistory };
    if (PHASE4B2_MODE) fullAbort.phase4b2 = { ...abort, hold: 'P0 PHASE 4B.2 — DIURNAL RETEST HOLD' };
    else fullAbort.phase4b = abort;
    writeJson(FULL_REPORT_PATH, fullAbort);
    console.log(JSON.stringify({ event: PHASE4B2_MODE ? 'p0_phase4b2_aborted' : 'p0_phase4b_aborted', result, failures: preflightFailures, metrics }));
    return;
  }

  const postStartedDate = new Date();
  const postStartedAt = postStartedDate.toISOString();
  const created = await mlRequest(token, '/items', { method: 'POST', body: payload });
  const failedResult = PHASE4B2_MODE && created.status === 500 && created.data?.error === 'internal_error'
    ? 'CANARY_REPEAT_INTERNAL_ERROR'
    : PHASE4B2_MODE && !created.ok ? 'CANARY_VALIDATION_ERROR_DISCOVERED'
      : 'CANARY_POST_FAILED';
  const postReport = {
    result: created.ok ? 'POST_ACCEPTED' : failedResult,
    attempted_at: postStartedAt,
    attempted_at_local: saoPauloTimestamp(postStartedDate),
    completed_at: now(),
    endpoint: 'POST https://api.mercadolibre.com/items',
    payload_sha256: payloadHash,
    family_name_sent: payload.family_name,
    request_id: responseRequestId(created.headers),
    http_status: created.status,
    response_headers: Object.fromEntries(Object.entries(created.headers).filter(([key]) => ['x-request-id', 'x-correlation-id', 'x-trace-id', 'date', 'content-type'].includes(key))),
    response_body: created.data,
    item_id: created.data?.id || null,
    user_product_id: created.data?.user_product_id || null,
    catalog_product_id: created.data?.catalog_product_id || null,
    status: created.data?.status || null,
    permalink: created.data?.permalink || null,
    error_classification: created.ok ? null : classifyPostError(created),
    one_post_guard: { attempts: metrics.ml_item_post_attempts, successful: metrics.ml_item_posts_successful, other_writes: metrics.ml_other_writes },
  };
  writeJson(POST_RESPONSE_PATH, postReport);
  if (!created.ok || !created.data?.id) {
    writeJson(FINANCIAL_PATH, {
      generated_at: now(),
      stage: 'immediately_before_post',
      result: failedResult,
      current: financial,
      post_http_status: created.status,
      item_created: false,
      financial_gate_passed: financial.approved,
    });
    const phaseFailure = {
      result: failedResult,
      preflight,
      post: postReport,
      previous_internal_error: PHASE4B2_MODE ? {
        request_id: priorPostResponse?.request_id || null,
        attempted_at: priorPostResponse?.attempted_at || null,
        payload_sha256: priorPostResponse?.payload_sha256 || null,
        same_payload: priorPostResponse?.payload_sha256 === payloadHash,
      } : null,
      recommendation: failedResult === 'CANARY_REPEAT_INTERNAL_ERROR'
        ? 'FASE 4B.3 — MINIMAL PAYLOAD ISOLATION (not authorized or executed)'
        : 'Review returned validation causes before any further attempt.',
      metrics,
      local_persistence: { performed: false },
      hold: PHASE4B2_MODE ? 'P0 PHASE 4B.2 — DIURNAL RETEST HOLD' : 'P0_PHASE_4B_POST_PUBLISH_HOLD',
    };
    const failure = { ...priorFull, payload_sha256: payloadHash, financial: refreshedSummary.financial, authorized_reprice: refreshedSummary.authorized_reprice, authorized_family_name: refreshedSummary.authorized_family_name, phase4b_attempt_history: attemptHistory };
    if (PHASE4B2_MODE) failure.phase4b2 = phaseFailure;
    else failure.phase4b = phaseFailure;
    writeJson(FULL_REPORT_PATH, failure);
    console.log(JSON.stringify({ event: PHASE4B2_MODE ? 'p0_phase4b2_completed' : 'p0_phase4b_completed', result: failedResult, http_status: created.status, request_id: postReport.request_id, error_classification: postReport.error_classification, metrics }));
    return;
  }

  const itemId = String(created.data.id);
  const readback = await readBack(token, itemId);
  writeJson(READBACK_PATH, readback);
  const diff = buildDiff(payload, readback.item, readback.description, '100-240V', readback.user_product);
  writeJson(DIFF_PATH, diff);
  const postFinancialValidation = await postFinancial(token, context, payload, readback.item, financial);
  writeJson(FINANCIAL_PATH, postFinancialValidation);
  if (postFinancialValidation.financial_drift) diff.material_drift = true;
  if (readback.picture_diagnostics.some((row) => row.errors.length)) {
    diff.fields.push({ field: 'picture_diagnostics', expected: 'no_errors', remote: readback.picture_diagnostics, status: 'DIVERGENT', material: true });
    diff.material_drift = true;
  }

  metrics.supabase_reads += 2;
  const [{ data: productAfter, error: productAfterError }, { data: listingsAfter, error: listingsAfterError }] = await Promise.all([
    supabase.from('produtos').select('id,sku,ml_item_id,ml_status').eq('id', PRODUCT_ID).single(),
    supabase.from('anuncios_ml').select('id,ml_item_id,produto_id,sku').or(`produto_id.eq.${PRODUCT_ID},sku.eq.${SKU}`),
  ]);
  if (productAfterError || listingsAfterError) throw new Error(productAfterError?.message || listingsAfterError?.message);
  const localPersistence = {
    performed: false,
    authorized: false,
    reason: diff.material_drift ? 'material_remote_drift' : 'phase4b_hold_requires_human_link_authorization',
    product_ml_item_id: productAfter.ml_item_id || null,
    local_listing_count: (listingsAfter || []).length,
    concurrent_drift: Boolean(productAfter.ml_item_id) || (listingsAfter || []).length > 0,
    proposal: diff.material_drift ? null : {
      produto_id: PRODUCT_ID,
      sku: SKU,
      ml_item_id: readback.item.id,
      ml_status: readback.item.status === 'active' ? 'ativo' : 'pausado',
      anuncio_status: readback.item.status === 'active' ? 'ativo' : 'pausado',
      preco_ml: Number(readback.item.price),
      tipo: readback.item.listing_type_id === 'gold_pro' ? 'premium' : readback.item.listing_type_id,
      catalogo: readback.item.catalog_listing === true,
    },
  };
  if (localPersistence.concurrent_drift) {
    diff.fields.push({ field: 'local_concurrency', expected: 'no_link', remote: localPersistence, status: 'DIVERGENT', material: true });
    diff.material_drift = true;
  }
  writeJson(DIFF_PATH, diff);
  const result = diff.material_drift ? 'CANARY_POST_DRIFT' : (PHASE4B2_MODE ? 'CANARY_SUCCESS' : 'CANARY_SUCCESS_PENDING_LOCAL_LINK');
  const phase4b = {
    started_at: startedAt,
    completed_at: now(),
    result,
    sku: SKU,
    item_id: itemId,
    permalink: readback.item.permalink || created.data.permalink || null,
    preflight,
    post: postReport,
    readback,
    diff,
    financial_validation: postFinancialValidation,
    local_persistence: localPersistence,
    metrics,
    hold: PHASE4B2_MODE ? 'P0 PHASE 4B.2 — DIURNAL RETEST HOLD' : 'P0_PHASE_4B_POST_PUBLISH_HOLD',
  };
  const success = { ...priorFull, payload_sha256: payloadHash, financial: refreshedSummary.financial, authorized_reprice: refreshedSummary.authorized_reprice, authorized_family_name: refreshedSummary.authorized_family_name, phase4b_attempt_history: attemptHistory };
  if (PHASE4B2_MODE) success.phase4b2 = phase4b;
  else success.phase4b = phase4b;
  writeJson(FULL_REPORT_PATH, success);
  console.log(JSON.stringify({ event: PHASE4B2_MODE ? 'p0_phase4b2_completed' : 'p0_phase4b_completed', result, item_id: itemId, permalink: phase4b.permalink, material_drift: diff.material_drift, metrics }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'p0_phase4b_failed', error: error.message, metrics, timestamp: now() }));
  process.exitCode = 1;
});
