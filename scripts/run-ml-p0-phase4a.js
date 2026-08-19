#!/usr/bin/env node
/* PRE-PUBLISH ONLY: no Mercado Livre commercial writes and no local database writes. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { calculatePrice } = require('./lib/ml-p0-audit');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  buildCanaryAttributes,
  buildCanaryDescription,
  buildCanaryTitle,
  classifyRemoteItem,
  comparePhase3,
  normalizeGtin,
  plain,
  publicAttributes,
  sha256,
  text,
} = require('./lib/ml-p0-phase4');

dotenv.config({ path: '.env.local' });

const SKU = 'VTK000486';
const CATEGORY_ID = 'MLB11290';
const LISTING_TYPE = 'gold_pro';
const OFFICIAL_URL = 'https://www.toshibaenergia.com.br/carregador-de-pilha-com-4-pilhas-TNHC-6GAE4-aa-aaa-toshiba';
const REPORT_DIR = path.join(process.cwd(), 'reports', 'ml-p0-phase4');
const PHASE1_REPORT = path.join(process.cwd(), 'reports', 'ml-p0-audit', 'bbcffbd8-cf85-4a1e-9a5a-b1ee2f782c00.json');
const PHASE2_REPORT = path.join(process.cwd(), 'reports', 'ml-p0-sanitize', 'full-report.json');
const PHASE3_REPORT = path.join(process.cwd(), 'reports', 'ml-p0-phase3', 'full-report.json');
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const metrics = {
  supabase_reads: 0,
  dslite_reads: 0,
  ml_gets: 0,
  ml_conditional_attribute_checks: 0,
  ml_commercial_writes: 0,
  local_commercial_writes: 0,
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

async function fetchJson(url, options = {}, service = 'web') {
  const method = String(options.method || 'GET').toUpperCase();
  const parsed = new URL(url);
  const isConditionalCheck = parsed.hostname === 'api.mercadolibre.com'
    && method === 'POST'
    && /^\/categories\/MLB11290\/attributes\/conditional$/.test(parsed.pathname);
  if (parsed.hostname === 'api.mercadolibre.com' && method !== 'GET' && !isConditionalCheck) {
    metrics.ml_commercial_writes += 1;
    throw new Error(`commercial_write_forbidden:${method}:${parsed.pathname}`);
  }
  if (parsed.hostname === 'api.mercadolibre.com') {
    const wait = 105 - (Date.now() - lastMlRequestAt);
    if (wait > 0) await sleep(wait);
    lastMlRequestAt = Date.now();
    if (isConditionalCheck) metrics.ml_conditional_attribute_checks += 1;
    else metrics.ml_gets += 1;
  } else if (service === 'dslite') metrics.dslite_reads += 1;

  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || 60000) });
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  if (!response.ok) {
    const error = new Error(`${service}_http_${response.status}:${text(body).slice(0, 500)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { data, status: response.status, headers: Object.fromEntries(response.headers.entries()), final_url: response.url };
}

async function mlRequest(token, pathname, options = {}) {
  return fetchJson(`https://api.mercadolibre.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  }, 'ml');
}

async function one(table, select, filter, value) {
  metrics.supabase_reads += 1;
  const { data, error } = await supabase.from(table).select(select).eq(filter, value).maybeSingle();
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

function phaseBaselines() {
  const phase1 = readJson(PHASE1_REPORT);
  const phase2 = readJson(PHASE2_REPORT);
  const phase3 = readJson(PHASE3_REPORT);
  const p1 = phase1.audits.find((row) => row.sku === SKU);
  const p2 = [...(phase2.sanitized_candidates || []), ...(phase2.api_error_reprocess || [])]
    .find((row) => row.sku === SKU);
  const p3 = (phase3.candidates || []).find((row) => row.sku === SKU);
  if (!p1 || !p2 || !p3 || p3.recommended_action !== 'READY_FOR_CREATE') {
    throw new Error('phase3_ready_baseline_missing');
  }
  return {
    phase1,
    phase2,
    phase3,
    candidate: {
      produto_id: p3.produto_id,
      sku: p3.sku,
      gtin: p2.gtin,
      stock: Number(p3.estoque),
      offer_id: p1.level0_snapshot?.produto?.oferta_preferencial_id,
      pricing: p2.pricing,
      scores: p3.scores,
      action: p3.recommended_action,
      phase3_run_id: phase3.phase3_run_id,
      population_hash: phase3.population_hash,
    },
  };
}

async function loadLiveContext() {
  const product = await one('produtos', '*', 'sku', SKU);
  if (!product) throw new Error('live_product_missing');
  const offer = await one('produto_fornecedor_ofertas', '*', 'id', product.oferta_preferencial_id);
  if (!offer) throw new Error('preferred_offer_missing');
  const integrations = await many('integracoes', 'tipo,url,access_token,conectado,token_expires_at,updated_at', (query) => query.in('tipo', ['dslite', 'mercadolivre']));
  const byType = Object.fromEntries(integrations.map((row) => [row.tipo, row]));
  if (!byType.dslite?.conectado || !byType.dslite?.access_token || !byType.dslite?.url) throw new Error('dslite_integration_unavailable');
  if (!byType.mercadolivre?.conectado || !byType.mercadolivre?.access_token) throw new Error('ml_integration_unavailable');
  const account = await assertAllowedMercadoLivreToken(byType.mercadolivre.access_token, 'ml-p0-phase4a');

  const localListings = await many('anuncios_ml', '*', (query) => query.or(`sku.eq.${SKU},produto_id.eq.${product.id}`));
  const localDuplicates = await many('produtos', 'id,sku,nome,marca,gtin,estoque,custo,ml_item_id,ml_status,dslite_fornecedor_id,dslite_produto_id,oferta_preferencial_id', (query) => query.or(`gtin.eq.${product.gtin},dslite_produto_id.eq.${product.dslite_produto_id},nome.ilike.%TNHC-6GAE4%`));
  const kitLinks = await many('produto_kit_componentes', 'kit_produto_id,componente_produto_id,quantidade', (query) => query.or(`kit_produto_id.eq.${product.id},componente_produto_id.eq.${product.id}`));
  const pendingItems = await many('pedido_itens', 'pedido_id,seller_sku,quantidade,ml_item_id,created_at', (query) => query.ilike('seller_sku', SKU));
  const purchases = await many('compras', 'id,status,status_dslite,produto_sku,quantidade,data_criacao', (query) => query.eq('produto_sku', SKU));
  const internalMovements = await many('estoque_interno_movimentacoes', 'tipo,quantidade,situacao_estoque,estornada_em,created_at', (query) => query.eq('produto_id', product.id));

  return { product, offer, integrations: byType, account, localListings, localDuplicates, kitLinks, pendingItems, purchases, internalMovements };
}

async function fetchDsliteLive(context) {
  const url = `${String(context.integrations.dslite.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${context.offer.dslite_fornecedor_id}/${context.offer.dslite_produto_id}`;
  const response = await fetchJson(url, { headers: { Token: context.integrations.dslite.access_token } }, 'dslite');
  const rows = Array.isArray(response.data?.produtos) ? response.data.produtos : [];
  const product = rows.find((row) => String(row.produtoid) === String(context.offer.dslite_produto_id)) || rows[0];
  if (!product) throw new Error('dslite_live_product_missing');
  return { url, consulted_at: now(), product };
}

async function fetchOfficialEvidence() {
  const response = await fetch(OFFICIAL_URL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`manufacturer_http_${response.status}`);
  const html = await response.text();
  const checks = [
    ['gtin', '4904530109270', 'EAN/GTIN 4904530109270'],
    ['model', 'TNHC-6GAE4 CB', 'Modelo TNHC-6GAE4 CB'],
    ['brand', 'TOSHIBA', 'Marca Toshiba'],
    ['supported_sizes', 'AA/AAA', 'Carrega pilhas recarregáveis AA/AAA'],
    ['composition', 'Ni-Mh', 'Pilhas recarregáveis Ni-MH'],
    ['included_capacity', '2600mAh', 'Quatro pilhas AA de 2600 mAh'],
    ['included_batteries', '4 pilhas recarregáveis AA', 'Inclui quatro pilhas recarregáveis AA'],
    ['charging_ports', 'quatro pilhas ao mesmo tempo', 'Carrega até quatro pilhas simultaneamente'],
    ['charge_indicator', 'Led pulsante lento', 'LED informa carregamento, carga completa e bateria inválida'],
    ['input_voltage', 'Bivolt', 'Página informa bivolt; imagem oficial 6 mostra entrada AC 100-240 V, 50-60 Hz, 6 W'],
    ['connector_type', 'Conector', 'Conector AC e plug integrado visível nas imagens oficiais'],
    ['package_contents', '1 carregador AC', '1 carregador AC, 4 pilhas AA 2600 mAh e 1 manual'],
  ].map(([field, needle, excerpt]) => ({ field, confirmed: plain(html).includes(plain(needle)), excerpt }));
  if (checks.some((check) => !check.confirmed)) {
    throw new Error(`manufacturer_evidence_drift:${checks.filter((check) => !check.confirmed).map((check) => check.field).join(',')}`);
  }
  return {
    url: OFFICIAL_URL,
    domain: new URL(OFFICIAL_URL).hostname,
    source_type: 'manufacturer_official_product_page',
    consulted_at: now(),
    checks,
    warranty: { confirmed: false, reason: 'manufacturer_page_does_not_publish_warranty_term' },
  };
}

async function inspectImages(dsliteProduct) {
  const urls = [...new Set((dsliteProduct.midias || [])
    .filter((media) => media.tipo === 'imagem')
    .map((media) => text(media.valor))
    .filter(Boolean))];
  const decisions = {
    1: { approved: true, reason: 'retail_package_matches_gtin_model_and_four_included_cells' },
    2: { approved: true, reason: 'charger_front_same_model' },
    3: { approved: true, reason: 'charger_and_four_included_aa_cells_white_background', main: true },
    4: { approved: true, reason: 'charger_and_four_included_aa_cells_angle_view' },
    5: { approved: true, reason: 'retail_package_back_same_gtin_and_model' },
    6: { approved: true, reason: 'charger_label_confirms_input_and_output' },
    7: { approved: true, reason: 'integrated_ac_plug_same_charger' },
    8: { approved: true, reason: 'charger_label_and_integrated_ac_plug' },
    9: { approved: true, reason: 'integrated_ac_plug_detail' },
    10: { approved: false, reason: 'wholesale_carton_can_imply_wrong_package_quantity' },
  };
  const checked = [];
  for (const [index, url] of urls.entries()) {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = response.ok && String(response.headers.get('content-type') || '').startsWith('image/')
      ? await sharp(buffer).metadata()
      : {};
    const decision = decisions[index + 1] || { approved: false, reason: 'image_not_manually_reconciled' };
    const technical = response.ok
      && String(response.headers.get('content-type') || '').startsWith('image/')
      && Number(metadata.width) >= 250
      && Number(metadata.height) >= 250
      && Math.max(Number(metadata.width), Number(metadata.height)) >= 500;
    checked.push({
      url,
      origin: 'manufacturer_official_page_and_dslite',
      http_status: response.status,
      final_url: response.url,
      content_type: response.headers.get('content-type'),
      width: metadata.width || null,
      height: metadata.height || null,
      bytes: buffer.length,
      technically_valid: technical,
      visually_approved: Boolean(decision.approved),
      approved: technical && Boolean(decision.approved),
      main: Boolean(decision.main),
      reason: decision.reason,
    });
  }
  const order = [3, 4, 2, 7, 8, 6, 9, 5, 1]
    .map((position) => checked[position - 1])
    .filter((image) => image?.approved);
  return { checked_at: now(), available: checked.length, approved: order.length, rejected: checked.filter((image) => !image.approved).length, main_approved: Boolean(order[0]?.main), order };
}

async function scanRemoteInventory(token, account) {
  const ids = [];
  const scrolls = new Set();
  let scrollId = '';
  let expectedTotal = null;
  let pages = 0;
  while (pages < 1000) {
    const query = scrollId
      ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : 'search_type=scan&limit=100';
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
  const fields = 'id,title,status,sub_status,seller_id,seller_custom_field,user_product_id,catalog_product_id,category_id,attributes,variations,price,available_quantity,sold_quantity,listing_type_id,catalog_listing,permalink,date_created,last_updated';
  for (let index = 0; index < uniqueIds.length; index += 20) {
    const batch = uniqueIds.slice(index, index + 20);
    const rows = (await mlRequest(token, `/items?ids=${batch.join(',')}&attributes=${fields}`)).data;
    for (const row of rows || []) if (Number(row.code) === 200 && row.body?.id) items.push(row.body);
  }
  const reliable = uniqueIds.length === expectedTotal && items.length === uniqueIds.length;
  if (!reliable) throw new Error(`remote_inventory_unreliable:${uniqueIds.length}/${expectedTotal}/${items.length}`);
  return { seller_id: String(account.userId), expected_total: expectedTotal, captured: uniqueIds.length, detailed: items.length, pages, reliable, items };
}

async function auditRemote(context, dslite) {
  const token = context.integrations.mercadolivre.access_token;
  const catalogSearch = (await mlRequest(token, `/products/search?status=active&site_id=MLB&product_identifier=${normalizeGtin(dslite.product.ean11)}`)).data;
  const exactCatalog = (catalogSearch?.results || []).find((row) =>
    (row.attributes || []).some((attribute) => attribute.id === 'GTIN' && normalizeGtin(attribute.value_name) === normalizeGtin(dslite.product.ean11)),
  ) || null;
  const catalogDetail = exactCatalog
    ? (await mlRequest(token, `/products/${encodeURIComponent(exactCatalog.id)}`)).data
    : null;
  const lookupQueries = [
    ['seller_sku', SKU],
    ['sku', SKU],
    ['q', 'TNHC-6GAE4'],
    ['catalog_product_id', exactCatalog?.id || ''],
    ['product_identifier', normalizeGtin(dslite.product.ean11)],
  ].filter(([, value]) => value);
  const direct = [];
  for (const [method, value] of lookupQueries) {
    try {
      const result = (await mlRequest(token, `/users/${context.account.userId}/items/search?${method}=${encodeURIComponent(value)}&limit=100`)).data;
      direct.push({ method, value, status: 'success', total: Number(result?.paging?.total || 0), item_ids: (result?.results || []).map(String), error: null });
    } catch (error) {
      direct.push({ method, value, status: 'error', total: null, item_ids: [], error: error.message });
    }
  }
  const inventory = await scanRemoteInventory(token, context.account);
  for (const lookup of direct) {
    if (['catalog_product_id', 'product_identifier'].includes(lookup.method)
      && lookup.status === 'success'
      && lookup.total === inventory.expected_total) {
      lookup.raw_total = lookup.total;
      lookup.total = null;
      lookup.item_ids = [];
      lookup.status = 'unsupported_or_ignored';
      lookup.error = 'seller_search_parameter_ignored_by_ml_api';
    }
  }
  const expected = {
    sku: SKU,
    gtin: dslite.product.ean11,
    model: dslite.product.modelo,
    brand: dslite.product.marca,
    catalog_product_id: exactCatalog?.id || '',
  };
  const matches = inventory.items
    .map((item) => ({ item, classification: classifyRemoteItem(item, expected) }))
    .filter((row) => row.classification.match_type !== 'NOT_MATCH')
    .map((row) => ({
      item_id: row.item.id,
      title: row.item.title,
      status: row.item.status,
      sub_status: row.item.sub_status || [],
      price: row.item.price,
      available_quantity: row.item.available_quantity,
      category_id: row.item.category_id,
      catalog_product_id: row.item.catalog_product_id || null,
      user_product_id: row.item.user_product_id || null,
      permalink: row.item.permalink,
      ...row.classification,
    }));
  const blocking = matches.filter((row) => row.confidence >= 95);
  return {
    checked_at: now(),
    direct_lookups: direct,
    full_inventory: { ...inventory, items: undefined },
    catalog: exactCatalog ? { id: exactCatalog.id, domain_id: exactCatalog.domain_id, category_id: exactCatalog.settings?.listing_category_id || null, attributes: exactCatalog.attributes || [], buy_box_winner: catalogDetail?.buy_box_winner || null } : null,
    matches,
    blocking_matches: blocking,
    duplicate_risk: blocking.length ? 100 : matches.length ? Math.max(...matches.map((row) => row.confidence)) : 0,
    reliable: inventory.reliable,
  };
}

function recursiveNumbers(value, key) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([name, child]) => name === key && Number.isFinite(Number(child))
    ? [Number(child)]
    : recursiveNumbers(child, key));
}

function getFeeRow(data) {
  if (Array.isArray(data)) return data.find((row) => row.listing_type_id === LISTING_TYPE) || data[0] || null;
  return data || null;
}

async function simulateFinancial(context, dslite, token) {
  const cost = Number(dslite.product.preco_revenda || dslite.product.preco_normal || context.offer.custo);
  const dimensions = `${Math.ceil(Number(dslite.product.altura_embalagem))}x${Math.ceil(Number(dslite.product.largura_embalagem))}x${Math.ceil(Number(dslite.product.profundidade_embalagem))},${Math.ceil(Number(dslite.product.peso_embalagem) * 1000)}`;
  let rate = Number(context.product.ml_fee || 0.15);
  let shipping = 0;
  let calculation = calculatePrice({ cost, saleFeeRate: rate, shippingCost: shipping });
  let feeRow = null;
  let shippingResponse = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const feeParams = new URLSearchParams({
      price: calculation.finalPrice.toFixed(2),
      category_id: CATEGORY_ID,
      listing_type_id: LISTING_TYPE,
      currency_id: 'BRL',
      logistic_type: 'drop_off',
      shipping_mode: 'me2',
    });
    feeRow = getFeeRow((await mlRequest(token, `/sites/MLB/listing_prices?${feeParams}`)).data);
    rate = Number(feeRow?.sale_fee_details?.percentage_fee || 0) / 100 || rate;
    const shippingParams = new URLSearchParams({
      dimensions,
      verbose: 'true',
      item_price: calculation.finalPrice.toFixed(2),
      listing_type_id: LISTING_TYPE,
      mode: 'me2',
      condition: 'new',
      logistic_type: 'drop_off',
      free_shipping: 'true',
    });
    shippingResponse = (await mlRequest(token, `/users/${context.account.userId}/shipping_options/free?${shippingParams}`)).data;
    const shippingCosts = recursiveNumbers(shippingResponse, 'list_cost').filter((value) => value > 0);
    shipping = shippingCosts.length ? Math.max(...shippingCosts) : 0;
    calculation = calculatePrice({ cost, saleFeeRate: rate, shippingCost: shipping });
  }
  const finalFeeParams = new URLSearchParams({ price: calculation.finalPrice.toFixed(2), category_id: CATEGORY_ID, listing_type_id: LISTING_TYPE, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
  feeRow = getFeeRow((await mlRequest(token, `/sites/MLB/listing_prices?${finalFeeParams}`)).data);
  const quoteCommission = Number(feeRow?.sale_fee_amount || calculation.commission);
  return {
    simulated_at: now(),
    engine: 'scripts/lib/ml-p0-audit.js#calculatePrice',
    listing_type_id: LISTING_TYPE,
    dimensions,
    cost,
    stock: Number(dslite.product.estoque),
    price: calculation.finalPrice,
    commission_policy_rate: rate,
    commission_policy_amount: calculation.commission,
    commission_ml_quote_amount: quoteCommission,
    shipping_cost: shipping,
    tax_rate: 0.05,
    tax_amount: calculation.tax,
    other_expenses: 0,
    estimated_operational_profit: calculation.grossMargin,
    estimated_operational_margin_percent: calculation.grossMarginPercent,
    minimum_profit: calculation.minimumProfit,
    target_margin_percent: calculation.targetMarginPercent,
    minimum_safety_price: calculation.finalPrice,
    approved: calculation.grossMargin + 0.001 >= calculation.minimumProfit
      && calculation.grossMarginPercent + 0.001 >= calculation.targetMarginPercent,
    fee_quote: feeRow,
    shipping_quote: shippingResponse,
  };
}

function evidenceLedger(context, dslite, official, imageAudit, mlCategory) {
  const recordedAt = now();
  const sources = {
    sku: ['supabase://produtos', context.product.sku],
    brand: [OFFICIAL_URL, 'Marca Toshiba'],
    manufacturer: [OFFICIAL_URL, 'Marca Toshiba'],
    model: [OFFICIAL_URL, 'Modelo TNHC-6GAE4 CB'],
    product_type: [OFFICIAL_URL, 'Produto descrito como carregador de pilhas AA/AAA; PRODUCT_TYPE=Pilha é valor permitido pela categoria ML'],
    connector_type: [OFFICIAL_URL, 'Conector AC; imagens oficiais mostram plug integrado. Normalizado para valor ML Plug'],
    gtin: [dslite.url, normalizeGtin(dslite.product.ean11)],
    input_voltage: [OFFICIAL_URL, 'Página informa Bivolt e etiqueta oficial informa AC 100-240 V; normalizado para valor ML 127/220V'],
    supported_sizes: [OFFICIAL_URL, 'Compatível com pilhas recarregáveis AA/AAA'],
    composition: [OFFICIAL_URL, 'Pilhas recarregáveis Toshiba Ni-MH'],
    charge_indicator: [OFFICIAL_URL, 'Estados do LED publicados pelo fabricante'],
    included_batteries: [OFFICIAL_URL, 'A embalagem acompanha 4 pilhas recarregáveis AA 2600 mAh'],
    charging_ports: [OFFICIAL_URL, 'Carrega até quatro pilhas ao mesmo tempo'],
    included_capacity: [OFFICIAL_URL, '4 pilhas recarregáveis AA 2600 mAh'],
    package_width: [dslite.url, `${dslite.product.largura_embalagem} cm`],
    package_length: [dslite.url, `${dslite.product.profundidade_embalagem} cm`],
    package_height: [dslite.url, `${dslite.product.altura_embalagem} cm`],
    package_weight: [dslite.url, `${dslite.product.peso_embalagem} kg`],
  };
  return buildCanaryAttributes().map((attribute) => ({
    field: attribute.id,
    value: attribute.value_name || attribute.value_id,
    source_url: sources[attribute.evidence_key]?.[0] || null,
    evidence: sources[attribute.evidence_key]?.[1] || null,
    source_level: String(sources[attribute.evidence_key]?.[0] || '').startsWith('supabase:') ? 0
      : sources[attribute.evidence_key]?.[0] === dslite.url ? 1 : 2,
    selected: true,
    recorded_at: recordedAt,
  })).concat([
    { field: 'CATEGORY_ID', value: CATEGORY_ID, source_url: `https://api.mercadolibre.com/categories/${CATEGORY_ID}`, evidence: mlCategory.name, source_level: 'ml_schema', selected: true, recorded_at: recordedAt },
    { field: 'PICTURES', value: imageAudit.order.map((image) => image.url), source_url: OFFICIAL_URL, evidence: `${imageAudit.approved} official images approved`, source_level: 2, selected: true, recorded_at: recordedAt },
    { field: 'WARRANTY', value: null, source_url: OFFICIAL_URL, evidence: official.warranty.reason, source_level: 2, selected: false, recorded_at: recordedAt },
  ]);
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const startedAt = now();
  const baselines = phaseBaselines();
  const context = await loadLiveContext();
  const dslite = await fetchDsliteLive(context);
  const official = await fetchOfficialEvidence();
  const drift = comparePhase3({ product: context.product, offer: context.offer }, baselines.candidate);
  const liveIdentityDrift = [
    ['gtin_product_dslite', normalizeGtin(context.product.gtin), normalizeGtin(dslite.product.ean11)],
    ['model_dslite_official', text(dslite.product.modelo), 'TNHC-6GAE4 CB'],
    ['stock_product_offer', Number(context.product.estoque), Number(context.offer.estoque)],
    ['stock_offer_dslite', Number(context.offer.estoque), Number(dslite.product.estoque)],
    ['cost_offer_dslite', Number(context.offer.custo), Number(dslite.product.preco_revenda || dslite.product.preco_normal)],
  ].map(([field, left, right]) => ({ field, left, right, match: left === right }));
  if (liveIdentityDrift.some((check) => !check.match)) drift.has_drift = true;
  drift.live_identity_checks = liveIdentityDrift;

  const token = context.integrations.mercadolivre.access_token;
  const category = (await mlRequest(token, `/categories/${CATEGORY_ID}`)).data;
  const schema = (await mlRequest(token, `/categories/${CATEGORY_ID}/attributes`)).data || [];
  const remote = await auditRemote(context, dslite);
  const images = await inspectImages(dslite.product);
  const financial = await simulateFinancial(context, dslite, token);
  const phase3Price = Number(baselines.candidate.pricing?.selected?.finalPrice || 0) || null;
  const currentLocalPrice = Number(context.product.preco_personalizado || 0) || null;
  financial.phase3_price = phase3Price;
  financial.difference_vs_phase3 = phase3Price === null ? null : Number((financial.price - phase3Price).toFixed(2));
  financial.current_local_price = currentLocalPrice;
  financial.difference_vs_current_local = currentLocalPrice === null ? null : Number((financial.price - currentLocalPrice).toFixed(2));
  financial.buy_box_price = Number(remote.catalog?.buy_box_winner?.price || 0) || null;
  financial.buy_box_applicable = false;
  const title = buildCanaryTitle();
  const description = buildCanaryDescription();
  const attributesWithEvidence = buildCanaryAttributes();
  const attributes = publicAttributes(attributesWithEvidence);
  const requiredSchema = schema.filter((attribute) => attribute.tags?.required || attribute.tags?.catalog_required);
  const supplied = new Set(attributes.map((attribute) => attribute.id));
  const directMissing = requiredSchema.filter((attribute) => !supplied.has(attribute.id));
  const conditionalBody = {
    title,
    category_id: CATEGORY_ID,
    price: financial.price,
    currency_id: 'BRL',
    available_quantity: Number(dslite.product.estoque),
    buying_mode: 'buy_it_now',
    condition: 'new',
    listing_type_id: LISTING_TYPE,
    description: { plain_text: description },
    attributes,
  };
  const conditional = await mlRequest(token, `/categories/${CATEGORY_ID}/attributes/conditional`, { method: 'POST', body: JSON.stringify(conditionalBody) });
  const conditionalMissing = (conditional.data?.required_attributes || []).filter((attribute) => !supplied.has(String(attribute.id || '')));

  const payload = {
    title,
    category_id: CATEGORY_ID,
    price: financial.price,
    currency_id: 'BRL',
    available_quantity: Number(dslite.product.estoque),
    buying_mode: 'buy_it_now',
    listing_type_id: LISTING_TYPE,
    condition: 'new',
    description: { plain_text: description },
    pictures: images.order.map((image) => ({ source: image.url })),
    attributes,
    seller_custom_field: SKU,
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: true },
  };
  const ledger = evidenceLedger(context, dslite, official, images, category);
  const localDuplicates = context.localDuplicates.filter((product) => product.id !== context.product.id);
  const activePurchases = context.purchases.filter((purchase) => !['cancelado', 'cancelled', 'entregue', 'delivered'].includes(plain(purchase.status)));
  const internalStock = context.internalMovements.reduce((sum, movement) => {
    if (movement.estornada_em) return sum;
    return sum + (movement.tipo === 'entrada' ? Number(movement.quantidade || 0) : movement.tipo === 'saida' ? -Number(movement.quantidade || 0) : 0);
  }, 0);
  const inventory = {
    supplier_stock: Number(dslite.product.estoque),
    preferred_offer_stock: Number(context.offer.estoque),
    product_projected_stock: Number(context.product.estoque),
    internal_stock: internalStock,
    pending_order_items: context.pendingItems.length,
    pending_purchase_quantity: activePurchases.reduce((sum, purchase) => sum + Number(purchase.quantidade || 0), 0),
    kit_links: context.kitLinks.length,
    effective_channel_stock: Number(dslite.product.estoque),
    quantity_to_publish: Number(dslite.product.estoque),
    calculation_rule: 'supplier_live_stock_not_summed_with_internal_stock',
    source: dslite.url,
    checked_at: now(),
  };
  const risks = [];
  if (drift.has_drift) risks.push('phase3_or_live_data_drift');
  if (remote.blocking_matches.length) risks.push('remote_equivalent_listing_found');
  if (localDuplicates.length) risks.push('local_product_duplicate');
  if (context.localListings.length) risks.push('local_listing_exists');
  if (!images.main_approved) risks.push('main_image_not_approved');
  if (directMissing.length || conditionalMissing.length) risks.push('required_attributes_missing');
  if (!financial.approved) risks.push('margin_below_policy');
  if (title.length > Number(category.settings?.max_title_length || 60)) risks.push('title_too_long');
  if (!category.settings?.listing_allowed || category.settings?.status !== 'enabled') risks.push('category_not_publishable');

  const requiredIds = new Set(requiredSchema.map((attribute) => attribute.id));
  const conditionalIds = new Set((conditional.data?.required_attributes || []).map((attribute) => String(attribute.id || '')));
  const attributeTable = attributesWithEvidence.map((attribute) => {
    const source = ledger.find((row) => row.field === attribute.id);
    return {
      attribute_id: attribute.id,
      name: schema.find((row) => row.id === attribute.id)?.name || attribute.id,
      value: attribute.value_name || attribute.value_id,
      value_id: attribute.value_id || null,
      source: source?.source_url || null,
      evidence: source?.evidence || null,
      required: requiredIds.has(attribute.id),
      conditional: conditionalIds.has(attribute.id),
    };
  });
  const notSentIds = ['ALPHANUMERIC_MODEL', 'OUTPUT_VOLTAGE', 'VOLTAGE', 'WITH_USB_CHARGE', 'OUTPUT_CURRENT', 'ANATEL_HOMOLOGATION_LABEL', 'ANATEL_HOMOLOGATION_NUMBER', 'IS_KIT'];
  const notSent = notSentIds.map((id) => {
    const attribute = schema.find((row) => row.id === id);
    return { id, name: attribute?.name || id, reason: id === 'OUTPUT_VOLTAGE' || id === 'OUTPUT_CURRENT'
      ? 'multiple_size_specific_outputs_make_single_value_ambiguous'
      : id === 'WITH_USB_CHARGE' ? 'official_source_confirms_ac_connector_but_does_not_explicitly_state_no_usb'
        : id === 'IS_KIT' ? 'retail_bundle_semantics_not_safe_for_ml_kit_flag'
          : 'not_confirmed_or_not_required' };
  });
  const score = {
    identity_confidence: 100,
    documentation_score: 100,
    publication_readiness: risks.length === 0 ? 100 : 0,
    duplicate_risk: remote.duplicate_risk,
  };
  const eligibleForHumanAuthorization = risks.length === 0;
  const result = eligibleForHumanAuthorization ? 'PREPUBLISH_READY' : remote.blocking_matches.length
    ? 'CANARY_ABORT_REMOTE_MATCH' : !images.main_approved ? 'CANARY_ABORT_IMAGE'
      : !financial.approved ? 'CANARY_ABORT_MARGIN' : 'CANARY_ABORT_DATA_DRIFT';

  metrics.supabase_reads += 2;
  const [productAfterResult, listingAfterResult] = await Promise.all([
    supabase.from('produtos').select('id,sku,ml_item_id,ml_status,updated_at').eq('id', context.product.id).single(),
    supabase.from('anuncios_ml').select('id,ml_item_id,produto_id,sku').or(`sku.eq.${SKU},produto_id.eq.${context.product.id}`),
  ]);
  if (productAfterResult.error) throw new Error(productAfterResult.error.message);
  if (listingAfterResult.error) throw new Error(listingAfterResult.error.message);
  const invariants = {
    product_ml_item_id_before: context.product.ml_item_id || null,
    product_ml_item_id_after: productAfterResult.data.ml_item_id || null,
    local_listing_count_before: context.localListings.length,
    local_listing_count_after: (listingAfterResult.data || []).length,
    mercado_livre_commercial_writes: metrics.ml_commercial_writes,
    local_commercial_writes: metrics.local_commercial_writes,
    passed: !context.product.ml_item_id && !productAfterResult.data.ml_item_id
      && context.localListings.length === (listingAfterResult.data || []).length
      && metrics.ml_commercial_writes === 0 && metrics.local_commercial_writes === 0,
  };
  if (!invariants.passed) throw new Error('audit_only_invariant_failed');

  const summary = {
    generated_at: now(),
    phase: 'P0_PHASE_4A_PREPUBLISH_HOLD',
    mode: 'PREPUBLISH_ONLY_NO_COMMERCIAL_WRITES',
    result,
    eligible_for_human_authorization: eligibleForHumanAuthorization,
    sku: SKU,
    produto_id: context.product.id,
    product: {
      internal_name: context.product.nome,
      brand: context.product.marca,
      model: dslite.product.modelo,
      gtin: normalizeGtin(dslite.product.ean11),
      category: { id: category.id, name: category.name, domain: category.settings?.catalog_domain },
      listing_type: LISTING_TYPE,
      condition: 'new',
      catalog_listing_desired: false,
      seller_custom_field: SKU,
    },
    title: { value: title, characters: title.length, limit: category.settings?.max_title_length || 60, seo_terms: ['carregador', 'Toshiba', 'TNHC-6GAE4 CB', '4 pilhas AA', '2600mAh'], justification: 'type_brand_exact_model_included_quantity_size_capacity' },
    description,
    inventory,
    financial,
    images,
    attributes: {
      confirmed: attributeTable,
      required: attributeTable.filter((attribute) => attribute.required),
      conditional: attributeTable.filter((attribute) => attribute.conditional),
      not_applicable: [],
      not_sent: notSent,
      direct_missing: directMissing,
      conditional_missing: conditionalMissing,
      conditional_endpoint_status: conditional.status,
    },
    warranty: { sent: false, value: null, reason: 'manufacturer_warranty_term_not_published_and_dslite_180_has_no_confirmed_unit' },
    logistics: { mode: 'me2', free_shipping: true, local_pick_up: false, source: 'current_vortek_ml_creation_policy' },
    duplicate_audit: remote,
    local_duplicate_audit: { duplicates: localDuplicates, existing_listings: context.localListings },
    category_validation: { id: category.id, name: category.name, enabled: category.settings?.status === 'enabled', listing_allowed: category.settings?.listing_allowed, path: category.path_from_root },
    drift,
    scores: score,
    risks,
    hold_question: 'AUTORIZAR PUBLICAÇÃO DO CANÁRIO VTK000486?',
  };
  const fullReport = {
    ...summary,
    started_at: startedAt,
    completed_at: now(),
    source_runs: { phase1_job_id: baselines.phase1.job_id, phase2_run_id: baselines.phase2.sanitize_run_id, phase3_run_id: baselines.phase3.phase3_run_id, population_hash: baselines.phase3.population_hash },
    live_level0: { product: context.product, preferred_offer: context.offer, integrations: Object.values(context.integrations).map((integration) => ({ type: integration.tipo, connected: integration.conectado, token_expires_at: integration.token_expires_at, updated_at: integration.updated_at })) },
    dslite_level1: { url: dslite.url, consulted_at: dslite.consulted_at, product: dslite.product },
    manufacturer_level2: official,
    category_schema: schema,
    conditional_validation: { request: conditionalBody, response: conditional.data, status: conditional.status },
    evidence_ledger: ledger,
    payload_sha256: sha256(JSON.stringify(payload)),
    metrics,
    invariants,
  };

  fs.writeFileSync(path.join(REPORT_DIR, 'canary-prepublish-payload.json'), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'canary-prepublish-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(REPORT_DIR, 'full-report.json'), `${JSON.stringify(fullReport, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'p0_phase4a_completed', result, eligible_for_human_authorization: eligibleForHumanAuthorization, risks, payload_sha256: fullReport.payload_sha256, metrics, invariants }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'p0_phase4a_failed', error: error.message, metrics, timestamp: now() }));
  process.exitCode = 1;
});
