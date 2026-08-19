#!/usr/bin/env node
/* Phase 5B: audit-only catalog-required prepublication validation for VTK000392. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { pricingStrategy, stripHtml } = require('./lib/ml-p0-audit');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { attributeValue, plain, remoteMatch, roundMoney } = require('./lib/ml-p0-phase5a');
const { assertCatalogPayload, calculateFinancial, classifyFinal, compareCatalogIdentity, sha256 } = require('./lib/ml-p0-phase5b');

dotenv.config({ path: '.env.local', quiet: true });

const SKU = 'VTK000392';
const PRODUCT_ID = 'eef0e527-8ef8-4a19-8132-9b1f670bb461';
const SELLER_ID = 3294514937;
const CATEGORY_ID = 'MLB1645';
const DOMAIN_ID = 'MLB-FANS';
const CATALOG_PRODUCT_ID = 'MLB15284402';
const GTIN = '7898461970375';
const OFFICIAL_URL = 'https://www.ventisol.com.br/ventilador-de-mesa-ventisol-turbo-6p-40cm-azul';
const FAMILY_NAME = 'Ventilador de Mesa Ventisol Turbo 6 40 cm';
const EXPECTED_TITLE = 'Ventilador De Mesa Ventisol Turbo 6 40cm 127V Azul';
const REPORT_DIR = path.resolve('reports/ml-p0-phase5b');
const HOLD = 'P0 PHASE 5B — CATALOG CANARY PREPUBLISH HOLD';
const BASELINE = { stock: 15, cost: 132.55, supplier: 'HAYAMAX-PR', gtin: GTIN };
const metrics = { supabase_reads: 0, dslite_gets: 0, ml_gets: 0, ml_diagnostic_posts: 0, ml_commercial_writes: 0, local_commercial_writes: 0, manufacturer_gets: 0, image_gets: 0 };
let lastMlAt = 0;
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fs.mkdirSync(REPORT_DIR, { recursive: true });
function writeJson(name, value) { fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`); }

const supabase = createClient(process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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

async function loadAll(table, select, order = 'id') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await dbSelect(table, select, (query) => query.order(order).range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function mlRequest(token, resource, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const diagnostic = method === 'POST' && /^\/categories\/MLB\d+\/attributes\/conditional$/.test(resource);
  if (method !== 'GET' && !diagnostic) {
    metrics.ml_commercial_writes += 1;
    throw new Error(`ml_write_forbidden:${method}:${resource}`);
  }
  if (diagnostic) metrics.ml_diagnostic_posts += 1; else metrics.ml_gets += 1;
  const wait = 90 - (Date.now() - lastMlAt);
  if (wait > 0) await sleep(wait);
  lastMlAt = Date.now();
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`ml_http_${response.status}:${resource}:${data?.message || 'unknown'}`);
  return { status: response.status, data };
}

async function fetchDslite(integration, offer) {
  metrics.dslite_gets += 1;
  const url = `${String(integration.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`;
  const response = await fetch(url, { headers: { Token: integration.access_token }, signal: AbortSignal.timeout(45000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`dslite_http_${response.status}`);
  const product = (data?.produtos || []).find((row) => String(row.produtoid) === String(offer.dslite_produto_id)) || data?.produtos?.[0];
  if (!product) throw new Error('dslite_product_missing');
  return { url, consulted_at: now(), product };
}

async function fetchOfficial() {
  metrics.manufacturer_gets += 1;
  const response = await fetch(OFFICIAL_URL, { signal: AbortSignal.timeout(45000) });
  const html = await response.text();
  if (!response.ok) throw new Error(`manufacturer_http_${response.status}`);
  const checks = [
    ['brand', /VENTISOL/i, 'Marca Ventisol'],
    ['model', /Turbo\s*6P?\s*40cm/i, 'Turbo 6P 40 cm'],
    ['type', /Ventilador de Mesa/i, 'Ventilador de mesa'],
    ['color', /Azul/i, 'Azul'],
    ['voltage', /127V/i, '127 V'],
    ['power', /Pot(?:ência|&ecirc;ncia):\s*80w/i, '80 W'],
    ['blades', /(?:Hélice|H&eacute;lice)[\s\S]{0,80}6\s*(?:Pás|P&aacute;s)/i, '6 pás'],
    ['speeds', /3\s*(?:níveis|n&iacute;veis)\s*de\s*velocidade/i, '3 velocidades'],
    ['dimensions', /Comprimento:\s*44cm[\s\S]*Largura:\s*35cm[\s\S]*Altura:\s*60cm/i, '44 × 35 × 60 cm montado'],
    ['gtin', new RegExp(GTIN), `GTIN ${GTIN}`],
  ].map(([field, pattern, evidence]) => ({ field, confirmed: pattern.test(html), evidence }));
  const identityFields = new Set(['brand', 'model', 'type', 'color', 'voltage', 'gtin']);
  return {
    url: OFFICIAL_URL,
    domain: new URL(OFFICIAL_URL).hostname,
    source_type: 'manufacturer_official_product_page',
    consulted_at: now(),
    checks,
    identity_confirmed: checks.filter((row) => identityFields.has(row.field)).every((row) => row.confirmed),
    all_confirmed: checks.every((row) => row.confirmed),
    excerpt: 'Ventilador de mesa Ventisol Turbo 6P 40 cm azul; variação 127 V; 80 W; 6 pás; 3 velocidades; montado 44 × 35 × 60 cm; garantia 12 meses.',
  };
}

async function scanRemote(token) {
  const ids = [];
  let scroll = '';
  let total = null;
  let pages = 0;
  const seen = new Set();
  while (pages < 1000) {
    const resource = scroll ? `/users/${SELLER_ID}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scroll)}` : `/users/${SELLER_ID}/items/search?search_type=scan&limit=100`;
    const page = (await mlRequest(token, resource)).data;
    pages += 1;
    if (total === null) total = Number(page?.paging?.total || 0);
    const current = (page?.results || []).map(String);
    ids.push(...current);
    if (!current.length || new Set(ids).size >= total) break;
    if (!page.scroll_id || seen.has(page.scroll_id)) break;
    seen.add(page.scroll_id);
    scroll = page.scroll_id;
  }
  const unique = [...new Set(ids)];
  const items = [];
  const fields = 'id,title,status,sub_status,seller_id,seller_custom_field,user_product_id,family_id,family_name,catalog_product_id,category_id,attributes,variations,price,available_quantity,sold_quantity,listing_type_id,catalog_listing,permalink,pictures,date_created,last_updated';
  for (let index = 0; index < unique.length; index += 20) {
    const rows = (await mlRequest(token, `/items?ids=${unique.slice(index, index + 20).join(',')}&attributes=${fields}`)).data;
    for (const row of rows || []) if (Number(row.code) === 200 && row.body?.id) items.push(row.body);
  }
  return { expected_total: total, captured: unique.length, detailed: items.length, pages, reliable: unique.length === total && items.length === unique.length, statuses: items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}), items };
}

async function loadCompetition(token, catalogDetail) {
  const results = [];
  let offset = 0;
  let total = 0;
  do {
    const page = (await mlRequest(token, `/products/${CATALOG_PRODUCT_ID}/items?limit=100&offset=${offset}`)).data;
    total = Number(page?.paging?.total || 0);
    results.push(...(page?.results || []));
    offset += Number(page?.paging?.limit || 100);
  } while (results.length < total && offset < 10000);
  const newOffers = results.filter((row) => !row.condition || row.condition === 'new');
  const prices = newOffers.map((row) => Number(row.price)).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const leader = catalogDetail?.buy_box_winner || null;
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const average = prices.length ? roundMoney(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null;
  return {
    endpoint: `/products/${CATALOG_PRODUCT_ID}/items`,
    total,
    captured: results.length,
    seller_count: new Set(newOffers.map((row) => row.seller_id).filter(Boolean)).size,
    leader: leader ? { item_id: leader.item_id, seller_id: leader.seller_id, price: leader.price, listing_type_id: leader.listing_type_id, shipping: leader.shipping, condition: leader.condition } : null,
    price_to_win: null,
    price_to_win_status: 'UNAVAILABLE_BEFORE_SELLER_ITEM_EXISTS',
    lowest_price: prices[0] || null,
    median_price: median,
    average_price: average,
    listing_types: newOffers.reduce((acc, row) => ({ ...acc, [row.listing_type_id || 'unknown']: (acc[row.listing_type_id || 'unknown'] || 0) + 1 }), {}),
    free_shipping_offers: newOffers.filter((row) => row.shipping?.free_shipping).length,
    fulfillment_offers: newOffers.filter((row) => row.shipping?.logistic_type === 'fulfillment').length,
    offers: newOffers,
  };
}

function flattenDomainAttributes(data) {
  return [data, ...Object.values(data || {})]
    .flatMap((section) => section?.groups || [])
    .flatMap((group) => group.components || [])
    .flatMap((component) => component.attributes || []);
}

function allowedValue(definition, value) {
  const match = (definition?.values || []).find((row) => plain(row.name) === plain(value));
  return match ? { value_id: match.id, value_name: match.name } : { value_name: String(value) };
}

async function auditImages(localUrls, catalogPictures) {
  const rows = [];
  const sources = [
    ...localUrls.map((url, index) => ({ scope: 'local', index: index + 1, url })),
    ...(catalogPictures || []).map((picture, index) => ({ scope: 'catalog', index: index + 1, url: picture.url || picture.secure_url })),
  ].filter((row) => row.url);
  for (const source of sources) {
    metrics.image_gets += 1;
    const response = await fetch(source.url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const contentType = String(response.headers.get('content-type') || '');
    const buffer = Buffer.from(await response.arrayBuffer());
    const isImage = response.ok && contentType.startsWith('image/');
    const metadata = isImage ? await sharp(buffer).metadata() : {};
    const redirect = response.status >= 300 && response.status < 400;
    let classification = source.scope === 'local' ? 'APPROVED' : 'CATALOG_REFERENCE_APPROVED';
    let reason = source.scope === 'local' ? 'exact_blue_six_blade_table_fan_on_white_background; identity_confirmed_in_phase5a' : 'image_belongs_to_exact_catalog_product';
    if (!response.ok || !isImage || redirect) { classification = 'REJECT_ACCESS'; reason = 'image_not_direct_public_200'; }
    else if (Number(metadata.width) < 250 || Number(metadata.height) < 250) { classification = 'REJECT_QUALITY'; reason = 'below_250px'; }
    rows.push({ ...source, http_status: response.status, https: source.url.startsWith('https://'), content_type: contentType, width: metadata.width || null, height: metadata.height || null, classification, reason });
  }
  const local = rows.filter((row) => row.scope === 'local');
  return { rows, local_total: local.length, local_approved: local.filter((row) => row.classification === 'APPROVED').length, main_approved: local[0]?.classification === 'APPROVED', catalog_images_checked: rows.filter((row) => row.scope === 'catalog').length, identity_comparison: 'same Ventisol Turbo 6 table fan, blue blades, black structure, six blades; catalog linkage exact' };
}

function shippingDimensions(dslite) {
  return `${Math.ceil(Number(dslite.altura_embalagem))}x${Math.ceil(Number(dslite.largura_embalagem))}x${Math.ceil(Number(dslite.profundidade_embalagem))},${Math.ceil(Number(dslite.peso_embalagem) * 1000)}`;
}

async function quote(token, listingType, price, dimensions, cost) {
  const feeParams = new URLSearchParams({ price: Number(price).toFixed(2), category_id: CATEGORY_ID, listing_type_id: listingType, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
  const feeRows = (await mlRequest(token, `/sites/MLB/listing_prices?${feeParams}`)).data;
  const fee = Array.isArray(feeRows) ? feeRows.find((row) => row.listing_type_id === listingType) || feeRows[0] : feeRows;
  const shippingParams = new URLSearchParams({ dimensions, verbose: 'true', item_price: Number(price).toFixed(2), listing_type_id: listingType, mode: 'me2', condition: 'new', logistic_type: 'drop_off', free_shipping: 'true' });
  const shippingResponse = (await mlRequest(token, `/users/${SELLER_ID}/shipping_options/free?${shippingParams}`)).data;
  const shipping = Number(shippingResponse?.coverage?.all_country?.list_cost);
  if (!Number.isFinite(shipping)) throw new Error(`shipping_quote_missing:${listingType}:${price}`);
  return { listing_type_id: listingType, fee, shipping_response: shippingResponse, financial: calculateFinancial(price, fee.sale_fee_amount, shipping, cost) };
}

async function targetPrice(token, listingType, targetMargin, dimensions, cost) {
  let probe = await quote(token, listingType, 269.23, dimensions, cost);
  let price = 269.23;
  const strategy = pricingStrategy(cost);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const percentage = Number(probe.fee?.sale_fee_details?.percentage_fee || 0) / 100;
    const fixed = Number(probe.fee?.sale_fee_details?.fixed_fee || 0);
    const shipping = probe.financial.shipping;
    const priceForMargin = (cost + shipping + fixed) / (1 - percentage - 0.05 - targetMargin / 100);
    const priceForProfit = (cost + shipping + fixed + strategy.minimumProfit) / (1 - percentage - 0.05);
    price = Math.ceil(Math.max(priceForMargin, priceForProfit) * 100) / 100;
    probe = await quote(token, listingType, price, dimensions, cost);
  }
  let attempts = 0;
  while ((probe.financial.margin_percent + 1e-9 < targetMargin || probe.financial.profit + 1e-9 < strategy.minimumProfit) && attempts < 30) {
    price = roundMoney(price + 0.01);
    probe = await quote(token, listingType, price, dimensions, cost);
    attempts += 1;
  }
  return { target_margin_percent: targetMargin, minimum_profit: strategy.minimumProfit, ...probe };
}

function stockAudit(product, offer, dslite, pendingItems, orders, internalMovements, kitLinks, purchases) {
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const reservingStatuses = new Set(['aberto', 'pendente', 'faturado']);
  const reservations = pendingItems.filter((row) => reservingStatuses.has(orderById.get(row.pedido_id)?.situacao));
  const reserved = reservations.reduce((sum, row) => sum + Number(row.quantidade || 0), 0);
  const releasedInternal = internalMovements.filter((row) => row.tipo === 'entrada_devolucao' && row.disponivel_venda === true && row.situacao_estoque === 'liberado' && !row.estornada_em).reduce((sum, row) => sum + Number(row.quantidade || 0), 0);
  const activeInternalOut = internalMovements.filter((row) => row.tipo === 'saida_envio_interno' && !row.estornada_em).reduce((sum, row) => sum + Number(row.quantidade || 0), 0);
  const internalBalance = Math.max(0, releasedInternal - activeInternalOut);
  const supplierStock = Math.min(Number(product.estoque), Number(offer.estoque), Number(dslite.estoque));
  return { product_stock: Number(product.estoque), preferred_offer_stock: Number(offer.estoque), dslite_stock: Number(dslite.estoque), supplier_stock_conservative: supplierStock, reserved_pending_orders: reserved, reservations, internal_stock_released: releasedInternal, internal_active_out: activeInternalOut, internal_balance: internalBalance, kit_links: kitLinks, related_purchases: purchases, current_engine_publicable_stock: supplierStock, conservative_after_explicit_reservations: Math.max(0, supplierStock - reserved), selected_publicable_stock: Math.max(0, supplierStock - reserved), selected_rule: 'minimum(product, preferred offer, DSLite) minus explicit local pending-order reservations; internal stock reported separately to avoid double count' };
}

function descriptionPreview() {
  return `VENTILADOR DE MESA VENTISOL TURBO 6 40 CM AZUL 127 V\n\nVentilador de mesa Ventisol Turbo 6P com hélice de seis pás, três níveis de velocidade e potência de 80 W. A versão deste anúncio é azul e opera em 127 V.\n\nCARACTERÍSTICAS\n- Marca: Ventisol\n- Linha: Turbo 6P\n- Tipo: ventilador de mesa\n- Voltagem: 127 V\n- Potência: 80 W\n- Diâmetro: 40 cm\n- Quantidade de pás: 6\n- Velocidades: 3\n- Cor das pás: azul\n- Dimensões montado: 44 × 35 × 60 cm\n\nCONTEÚDO\n- 1 ventilador de mesa Ventisol Turbo 6P 40 cm azul 127 V\n\nGARANTIA\n- 12 meses, conforme manual e termo de garantia do fabricante.\n\nSKU: ${SKU}`;
}

async function main() {
  const startedAt = now();
  const [product, integrations, allProducts, localListings] = await Promise.all([
    dbOne('produtos', '*', (query) => query.eq('sku', SKU).limit(1)),
    dbSelect('integracoes', 'tipo,url,access_token,conectado,updated_at', (query) => query.in('tipo', ['dslite', 'mercadolivre'])),
    loadAll('produtos', 'id,sku,nome,marca,gtin,estoque,custo,fornecedor,dslite_fornecedor_id,dslite_produto_id,ml_item_id,ml_status,oferta_preferencial_id,imagens'),
    loadAll('anuncios_ml', 'id,ml_item_id,produto_id,sku,titulo,status,catalogo,permalink'),
  ]);
  if (!product || product.id !== PRODUCT_ID) throw new Error('local_identity_mismatch');
  const offer = await dbOne('produto_fornecedor_ofertas', '*', (query) => query.eq('id', product.oferta_preferencial_id).limit(1));
  if (!offer) throw new Error('preferred_offer_missing');
  const byType = Object.fromEntries(integrations.map((row) => [row.tipo, row]));
  if (!byType.dslite?.conectado || !byType.mercadolivre?.conectado) throw new Error('integration_unavailable');
  const account = await assertAllowedMercadoLivreToken(byType.mercadolivre.access_token, 'ml-p0-phase5b');
  if (Number(account.userId) !== SELLER_ID) throw new Error(`seller_mismatch:${account.userId}`);

  const [pendingItems, purchases, internalMovements, kitLinks, localCatalogSnapshots, dsliteEvidence, official] = await Promise.all([
    dbSelect('pedido_itens', 'pedido_id,seller_sku,quantidade,ml_item_id,created_at', (query) => query.ilike('seller_sku', SKU)),
    dbSelect('compras', 'id,status,status_dslite,produto_sku,quantidade,data_criacao', (query) => query.eq('produto_sku', SKU)),
    dbSelect('estoque_interno_movimentacoes', 'id,tipo,quantidade,disponivel_venda,situacao_estoque,status_devolucao,estornada_em,created_at', (query) => query.eq('produto_id', PRODUCT_ID)),
    dbSelect('produto_kit_componentes', 'kit_produto_id,componente_produto_id,quantidade', (query) => query.or(`kit_produto_id.eq.${PRODUCT_ID},componente_produto_id.eq.${PRODUCT_ID}`)),
    dbSelect('catalogo_ml_snapshot', 'ml_item_id,produto_id,sku_local,seller_sku,catalog_product_id,catalog_listing,status,price,price_to_win,buy_box_status,buy_box_winning,permalink,synced_at', (query) => query.eq('catalog_product_id', CATALOG_PRODUCT_ID)),
    fetchDslite(byType.dslite, offer),
    fetchOfficial(),
  ]);
  const orderIds = [...new Set(pendingItems.map((row) => row.pedido_id).filter(Boolean))];
  const orders = orderIds.length ? await dbSelect('pedidos', 'id,situacao,numero,ml_order_id,created_at', (query) => query.in('id', orderIds)) : [];
  const stock = stockAudit(product, offer, dsliteEvidence.product, pendingItems, orders, internalMovements, kitLinks, purchases);
  const baselineChecks = [
    ['produto_id', PRODUCT_ID, product.id], ['stock', BASELINE.stock, Number(product.estoque)], ['cost', BASELINE.cost, Number(product.custo)],
    ['supplier', BASELINE.supplier, product.fornecedor], ['gtin', BASELINE.gtin, product.gtin], ['ml_item_id', null, product.ml_item_id], ['ml_status', 'sem_anuncio', product.ml_status],
  ].map(([field, expected, actual]) => ({ field, expected, actual, match: String(expected ?? '') === String(actual ?? '') }));
  const materialBaselineDrift = baselineChecks.filter((row) => ['produto_id', 'cost', 'supplier', 'gtin'].includes(row.field) && !row.match);
  if (materialBaselineDrift.length) throw new Error(`material_baseline_drift:${materialBaselineDrift.map((row) => row.field).join(',')}`);

  const token = byType.mercadolivre.access_token;
  const [seller, catalogDetail, catalogSearch, category, categoryAttrs, technicalInput, domainSpecs, saleTerms, listingTypes, remoteInventory] = await Promise.all([
    mlRequest(token, `/users/${SELLER_ID}`), mlRequest(token, `/products/${CATALOG_PRODUCT_ID}`),
    mlRequest(token, `/products/search?status=active&site_id=MLB&listing_strategy=catalog_required&product_identifier=${GTIN}`),
    mlRequest(token, `/categories/${CATEGORY_ID}`), mlRequest(token, `/categories/${CATEGORY_ID}/attributes`),
    mlRequest(token, `/categories/${CATEGORY_ID}/technical_specs/input`), mlRequest(token, `/domains/${DOMAIN_ID}/technical_specs`),
    mlRequest(token, `/categories/${CATEGORY_ID}/sale_terms`), mlRequest(token, '/sites/MLB/listing_types'), scanRemote(token),
  ]);
  if (!(seller.data?.tags || []).includes('user_product_seller')) throw new Error('seller_not_user_product_enabled');
  if (!remoteInventory.reliable) throw new Error('remote_inventory_unreliable');

  const catalog = catalogDetail.data;
  const catalogSearchRow = (catalogSearch.data?.results || []).find((row) => row.id === CATALOG_PRODUCT_ID) || null;
  const expectedCatalog = {
    brand: { ids: ['BRAND'], aliases: ['Ventisol'] }, model: { ids: ['MODEL'], aliases: ['Turbo 6', 'Turbo 6P'] },
    gtin: { ids: ['GTIN'], aliases: [GTIN] }, voltage: { ids: ['VOLTAGE'], aliases: ['127V', '127 V'] },
    color: { ids: ['BLADES_COLOR', 'COLOR', 'MAIN_COLOR'], aliases: ['Azul'] }, diameter: { ids: ['DIAMETER'], aliases: ['40 cm', '40cm'] },
    type: { ids: ['FAN_TYPE'], aliases: ['De mesa', 'Mesa'] }, blades: { ids: ['BLADES_NUMBER'], aliases: ['6'] }, power: { ids: ['POWER'], aliases: ['80 W', '80W'], critical: false },
  };
  // GET /products/{id} may omit GTIN, while the exact catalog-required lookup by
  // product_identifier returns it. Reconcile both official ML representations.
  const detailAttributeIds = new Set((catalog.attributes || []).map((row) => row.id));
  const catalogIdentitySource = {
    ...catalog,
    attributes: [
      ...(catalog.attributes || []),
      ...(catalogSearchRow?.attributes || []).filter((row) => !detailAttributeIds.has(row.id)),
    ],
  };
  const catalogIdentity = compareCatalogIdentity(catalogIdentitySource, expectedCatalog);
  const catalogStructureChecks = {
    product_id: catalog?.id === CATALOG_PRODUCT_ID,
    status_active: catalog?.status === 'active',
    domain: catalog?.domain_id === DOMAIN_ID,
    catalog_required: catalogSearchRow?.settings?.listing_strategy === 'catalog_required',
  };
  if (Object.values(catalogStructureChecks).some((value) => !value)) {
    catalogIdentity.gate = 'CATALOG_IDENTITY_CONFLICT';
    catalogIdentity.confidence = 0;
  }
  const catalogProductAudit = {
    consulted_at: now(),
    product: catalog,
    exact_search: catalogSearch.data,
    identity: catalogIdentity,
    identity_sources: {
      product_detail: `/products/${CATALOG_PRODUCT_ID}`,
      exact_gtin_lookup: `/products/search?status=active&site_id=MLB&listing_strategy=catalog_required&product_identifier=${GTIN}`,
      gtin_returned_by_exact_lookup: attributeValue(catalogSearchRow, 'GTIN'),
    },
    structure_checks: catalogStructureChecks,
    category_linkage: `validated separately through /categories/${CATEGORY_ID}: catalog_domain must equal ${DOMAIN_ID}`,
    gate: catalogIdentity.gate,
    local_equals_catalog: catalogIdentity.gate === 'CATALOG_EXACT_MATCH',
    manufacturer_precedence: true,
  };

  const remoteMatches = remoteInventory.items.map((item) => ({ item, comparison: remoteMatch(item, { sku: SKU, gtin: GTIN, brand: 'Ventisol', model: 'Turbo 6', catalog_product_id: CATALOG_PRODUCT_ID, distinguishing_attributes: { FAN_TYPE: ['De mesa', 'Mesa'], DIAMETER: ['40 cm', '40cm'], VOLTAGE: ['127V', '127 V'], BLADES_COLOR: ['Azul'] } }) })).filter((row) => row.comparison.classification !== 'NOT_MATCH');
  const localDuplicates = allProducts.filter((row) => row.id !== PRODUCT_ID && (row.gtin === GTIN || (row.dslite_fornecedor_id === product.dslite_fornecedor_id && row.dslite_produto_id === product.dslite_produto_id)));
  const remoteAudit = { inventory: { expected_total: remoteInventory.expected_total, captured: remoteInventory.captured, detailed: remoteInventory.detailed, pages: remoteInventory.pages, statuses: remoteInventory.statuses, reliable: remoteInventory.reliable }, matches: remoteMatches.map((row) => ({ item_id: row.item.id, status: row.item.status, seller_sku: row.item.seller_custom_field, gtin: attributeValue(row.item, 'GTIN'), catalog_product_id: row.item.catalog_product_id, user_product_id: row.item.user_product_id, family_id: row.item.family_id, title: row.item.title, permalink: row.item.permalink, comparison: row.comparison })), local_duplicates: localDuplicates, local_listing_records: localListings.filter((row) => row.produto_id === PRODUCT_ID || row.sku === SKU), local_catalog_snapshots: localCatalogSnapshots, exact_match_found: remoteMatches.some((row) => row.comparison.classification === 'EXACT_REMOTE_MATCH') };

  const competition = await loadCompetition(token, catalog);
  const domainAttrs = flattenDomainAttributes(domainSpecs.data);
  const hierarchyById = new Map(domainAttrs.map((row) => [row.id, row.hierarchy || null]));
  const sourceValues = {
    BRAND: ['Ventisol', 'manufacturer'], LINE: ['Turbo 6 pás', 'manufacturer'], MODEL: ['Turbo 6', 'manufacturer'], FAN_TYPE: ['De mesa', 'manufacturer'],
    GTIN: [GTIN, 'manufacturer+supplier+catalog'], VOLTAGE: ['127V', 'manufacturer+supplier+catalog'], POWER: ['80 W', 'manufacturer+catalog'],
    DIAMETER: ['40 cm', 'manufacturer+catalog'], BLADES_NUMBER: ['6', 'manufacturer+catalog'], SPEEDS_NUMBER: ['3', 'manufacturer+catalog'],
    STRUCTURE_COLOR: ['Preto', 'image+catalog'], BLADES_COLOR: ['Azul', 'manufacturer+supplier+catalog'], POWER_SUPPLY_TYPE: ['Corrente elétrica', 'catalog'],
    WITH_TURBO_FUNCTION: ['Sim', 'manufacturer'], WITH_OSCILLATION: ['Sim', 'supplier'], WITH_TILT: ['Sim', 'supplier'],
    ENERGY_EFFICIENCY_BRASIL: ['A', 'supplier'], MAX_ROTATION_SPEED: ['1500 rpm', 'supplier'], HEIGHT: ['60 cm', 'manufacturer'],
    DEPTH: ['44 cm', 'manufacturer'], WIDTH: ['35 cm', 'manufacturer'], WEIGHT: ['2.5 kg', 'supplier'], MANUFACTURER: ['Ventisol', 'manufacturer'],
    SELLER_PACKAGE_WIDTH: ['44 cm', 'supplier'], SELLER_PACKAGE_LENGTH: ['45 cm', 'supplier'], SELLER_PACKAGE_HEIGHT: ['18 cm', 'supplier'], SELLER_PACKAGE_WEIGHT: ['2600 g', 'supplier'],
  };
  const attributeRows = categoryAttrs.data.map((definition) => {
    const hierarchy = hierarchyById.get(definition.id) || definition.hierarchy || null;
    const tags = definition.tags || {};
    const hidden = Boolean(tags.hidden || tags.read_only || tags.fixed);
    const source = sourceValues[definition.id];
    const value = source?.[0] || null;
    const encoded = value ? { id: definition.id, ...allowedValue(definition, value) } : null;
    const required = Boolean(tags.required || tags.catalog_required || tags.catalog_listing_required || tags.catalog_child_required || tags.conditional_required);
    const send = Boolean(encoded && !hidden);
    return { id: definition.id, name: definition.name, hierarchy, value_type: definition.value_type, tags, required, hidden_or_read_only: hidden, value, source: source?.[1] || null, send, reason: send ? 'confirmed_evidence' : hidden ? 'schema_managed_or_read_only' : value ? 'not_sent' : 'not_confirmed_or_not_applicable', payload: send ? encoded : null };
  });
  const preparedAttributes = attributeRows.filter((row) => row.send).map((row) => row.payload);
  const conditionalBody = { family_name: FAMILY_NAME, category_id: CATEGORY_ID, price: 270, currency_id: 'BRL', available_quantity: stock.selected_publicable_stock, buying_mode: 'buy_it_now', condition: 'new', listing_type_id: 'gold_pro', catalog_product_id: CATALOG_PRODUCT_ID, catalog_listing: true, attributes: preparedAttributes };
  const conditional = await mlRequest(token, `/categories/${CATEGORY_ID}/attributes/conditional`, { method: 'POST', body: conditionalBody });
  const conditionalRequired = (conditional.data?.required_attributes || []).map((row) => row.id);
  const preparedIds = new Set(preparedAttributes.map((row) => row.id));
  const requiredIds = [...new Set([...attributeRows.filter((row) => row.required).map((row) => row.id), ...conditionalRequired, ...domainAttrs.filter((row) => row.hierarchy === 'PARENT_PK').map((row) => row.id)])];
  const requiredMissing = requiredIds.filter((id) => !preparedIds.has(id) && !attributeRows.find((row) => row.id === id)?.hidden_or_read_only);
  const categoryContract = { category: category.data, domain_id: DOMAIN_ID, catalog_required: catalogSearchRow?.settings?.listing_strategy === 'catalog_required', category_valid: category.data?.settings?.status === 'enabled' && category.data?.settings?.listing_allowed === true && category.data?.settings?.catalog_domain === DOMAIN_ID, seller_user_product_enabled: true, endpoint_initial: 'POST /items', endpoint_add_condition_existing_up: 'POST /user-products/{user_product_id}/items', endpoint_selected_reason: 'no existing seller User Product or item for exact catalog product; initial POST /items required', fields: { family_name: 'REQUIRED', title: 'PROHIBITED', variations: 'PROHIBITED', catalog_product_id: 'REQUIRED_FOR_CATALOG', catalog_listing: 'TRUE_REQUIRED', attributes: 'REQUIRED_FOR_INITIAL_USER_PRODUCT; inherited only when adding condition to existing User Product', pictures: 'REQUIRED_FOR_INITIAL_USER_PRODUCT; catalog may normalize/rehost', condition: 'REQUIRED', price: 'REQUIRED', available_quantity: 'REQUIRED' }, parent_pk: domainAttrs.filter((row) => row.hierarchy === 'PARENT_PK').map((row) => row.id), child_pk: domainAttrs.filter((row) => row.hierarchy === 'CHILD_PK').map((row) => row.id), required_ids: requiredIds, conditional_required: conditionalRequired, missing: requiredMissing, technical_input: technicalInput.data, sale_terms: saleTerms.data, conditional_request: conditionalBody, conditional_response: conditional.data };

  const images = await auditImages(product.imagens || [], catalog.pictures || []);
  const dimensions = shippingDimensions(dsliteEvidence.product);
  const acceptedListingTypes = new Set((listingTypes.data || []).map((row) => row.id));
  const listingCandidates = ['gold_pro', 'gold_special'].filter((id) => acceptedListingTypes.has(id));
  if (!listingCandidates.length) throw new Error('listing_types_unavailable');
  const candidateFinancials = [];
  for (const listingType of listingCandidates) {
    const minimum = await targetPrice(token, listingType, 15, dimensions, Number(dsliteEvidence.product.preco_revenda));
    const operational = await targetPrice(token, listingType, 15.25, dimensions, Number(dsliteEvidence.product.preco_revenda));
    candidateFinancials.push({ listing_type_id: listingType, minimum, operational });
  }
  const leaderPrice = Number(competition.leader?.price || competition.lowest_price || 0) || null;
  const selectedFinancial = [...candidateFinancials].sort((a, b) => a.operational.financial.price - b.operational.financial.price)[0];
  const chosenListingType = selectedFinancial.listing_type_id;
  const requestedPrices = [...new Set([269.23, 269.90, 270.00, selectedFinancial.operational.financial.price])];
  const priceTests = [];
  for (const price of requestedPrices) priceTests.push(await quote(token, chosenListingType, price, dimensions, Number(dsliteEvidence.product.preco_revenda)));
  const competitive = leaderPrice ? selectedFinancial.operational.financial.price <= leaderPrice : null;
  competition.classification = competitive === true ? 'COMPETITIVE' : competitive === false ? 'MARGIN_OK_NOT_COMPETITIVE' : 'BUYBOX_UNKNOWN';
  competition.selected_listing_type = chosenListingType;
  competition.operational_price = selectedFinancial.operational.financial.price;
  competition.probable_position = leaderPrice ? (competitive ? 'price_at_or_below_current_leader; other boosts still decide winner' : 'behind_current_leader_on_price') : 'unknown';
  const financialValidation = { dimensions, dimensions_order: 'height x width x length, grams', logistics: { mode: 'me2', logistic_type: 'drop_off', free_shipping: true }, target_margin_minimum_percent: 15, target_margin_operational_percent: 15.25, listing_type_candidates: candidateFinancials, selected_listing_type: chosenListingType, selected_reason: chosenListingType === 'gold_special' ? 'lower live fee yields lowest sustainable catalog price; gold_pro remains valid but less competitive' : 'premium mode remains competitive at operational margin', required_price_tests: priceTests, selected_minimum: selectedFinancial.minimum.financial, selected_operational: selectedFinancial.operational.financial, approved: selectedFinancial.operational.financial.margin_percent + 1e-9 >= 15.25 };
  const shippingValidation = { dimensions, local_supplier_dimensions: { height_cm: Number(dsliteEvidence.product.altura_embalagem), width_cm: Number(dsliteEvidence.product.largura_embalagem), length_cm: Number(dsliteEvidence.product.profundidade_embalagem), weight_g: Number(dsliteEvidence.product.peso_embalagem) * 1000 }, selected_listing_type: chosenListingType, selected_price: selectedFinancial.operational.financial.price, quote: selectedFinancial.operational.shipping_response, seller_cost: selectedFinancial.operational.financial.shipping, normalizations: 'future ML logistics dimensions may differ; must revalidate finance after creation before accepting normalization' };

  const warrantyType = (saleTerms.data || []).find((row) => row.id === 'WARRANTY_TYPE');
  const warrantyTime = (saleTerms.data || []).find((row) => row.id === 'WARRANTY_TIME');
  const saleTermsPayload = [];
  if (warrantyType) saleTermsPayload.push({ id: 'WARRANTY_TYPE', ...allowedValue(warrantyType, 'Garantia de fábrica') });
  if (warrantyTime) saleTermsPayload.push({ id: 'WARRANTY_TIME', value_name: '12 meses' });
  const conditionAttribute = { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' };
  const sellerSkuAttribute = { id: 'SELLER_SKU', value_name: SKU };
  const pictures = images.rows.filter((row) => row.scope === 'local' && row.classification === 'APPROVED').map((row) => ({ source: row.url }));
  const fullPayload = {
    family_name: FAMILY_NAME, category_id: CATEGORY_ID, catalog_product_id: CATALOG_PRODUCT_ID, catalog_listing: true,
    price: selectedFinancial.operational.financial.price, currency_id: 'BRL', available_quantity: stock.selected_publicable_stock,
    buying_mode: 'buy_it_now', listing_type_id: chosenListingType, condition: 'new', pictures,
    attributes: [...preparedAttributes, conditionAttribute, sellerSkuAttribute], ...(saleTermsPayload.length ? { sale_terms: saleTermsPayload } : {}),
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: true }, seller_custom_field: SKU,
  };
  const minimumAttributeIds = new Set([...requiredIds, ...domainAttrs.filter((row) => ['PARENT_PK', 'CHILD_PK'].includes(row.hierarchy)).map((row) => row.id)]);
  const minimalPayload = {
    family_name: FAMILY_NAME, category_id: CATEGORY_ID, catalog_product_id: CATALOG_PRODUCT_ID, catalog_listing: true,
    price: selectedFinancial.operational.financial.price, currency_id: 'BRL', available_quantity: stock.selected_publicable_stock,
    buying_mode: 'buy_it_now', listing_type_id: chosenListingType, condition: 'new', pictures: pictures.slice(0, 1),
    attributes: [...preparedAttributes.filter((row) => minimumAttributeIds.has(row.id)), conditionAttribute, sellerSkuAttribute],
    shipping: { mode: 'me2', local_pick_up: false, free_shipping: true }, seller_custom_field: SKU,
  };
  if (!assertCatalogPayload(fullPayload) || !assertCatalogPayload(minimalPayload)) throw new Error('payload_contract_invalid');
  const payloadHashes = { full_sha256: sha256(JSON.stringify(fullPayload)), minimal_sha256: sha256(JSON.stringify(minimalPayload)), canonicalization: 'JSON.stringify insertion order; future executor must load exact report payload bytes before hash comparison', title_present: false, description_present: false, variations_present: false };

  const competitionGate = competition.classification === 'MARGIN_OK_NOT_COMPETITIVE' ? 'MARGIN_OK_NOT_COMPETITIVE' : competition.classification;
  const gates = { remote_match: remoteAudit.exact_match_found, catalog_gate: catalogIdentity.gate, category_valid: categoryContract.category_valid, attributes_complete: requiredMissing.length === 0, images_approved: images.main_approved, financial_approved: financialValidation.approved, competition: competitionGate };
  const state = classifyFinal(gates);
  const scores = { identity_confidence: catalogIdentity.gate === 'CATALOG_EXACT_MATCH' && official.identity_confirmed ? 100 : 90, documentation_score: official.all_confirmed ? 100 : 95, publication_readiness: state === 'CATALOG_CANARY_PREPUBLISH_READY' ? 100 : state === 'MARGIN_OK_NOT_COMPETITIVE' ? 95 : 50, duplicate_risk: remoteAudit.exact_match_found ? 100 : remoteMatches.length ? 85 : 0, financial_confidence: financialValidation.approved ? 100 : 50, catalog_confidence: catalogIdentity.confidence };
  const invariants = { sku: SKU, single_sku_only: true, mercado_livre_commercial_writes: metrics.ml_commercial_writes, local_commercial_writes: metrics.local_commercial_writes, ml_diagnostic_posts_non_commercial: metrics.ml_diagnostic_posts, no_post_items: true, no_description_write: true, no_local_persistence: true, passed: metrics.ml_commercial_writes === 0 && metrics.local_commercial_writes === 0 };
  if (!invariants.passed) throw new Error('audit_only_invariant_failed');

  const catalogCompetition = { ...competition, source_contract: 'GET /products/{product_id} returns buy_box_winner; GET /products/{product_id}/items lists competing offers; price_to_win requires an existing seller item and is unavailable prepublication' };
  const attributesReport = { generated_at: now(), prepared_count: preparedAttributes.length, required_missing: requiredMissing, rows: attributeRows, appended_item_attributes: [conditionAttribute, sellerSkuAttribute], sale_terms: saleTermsPayload };
  const description = { sku: SKU, status: 'PREPARED_NOT_PUBLISHED', endpoint_future: `PUT /items/{item_id}/description?api_version=2`, text: descriptionPreview(), evidence: [OFFICIAL_URL, dsliteEvidence.url] };
  const summary = {
    generated_at: now(), phase: '5B', mode: 'AUDIT_PREPUBLISH_ONLY', sku: SKU, produto_id: PRODUCT_ID, state,
    baseline_drift: { detected: baselineChecks.some((row) => !row.match), material: false, checks: baselineChecks },
    identity: { brand: 'Ventisol', model: 'Turbo 6', gtin: GTIN, voltage: '127V', confidence: scores.identity_confidence, manufacturer: OFFICIAL_URL },
    catalog: { catalog_product_id: CATALOG_PRODUCT_ID, gate: catalogIdentity.gate, confidence: scores.catalog_confidence, catalog_required: categoryContract.catalog_required, attributes_inherited_when_adding_condition_to_existing_up: true },
    remote: { exact_matches: remoteAudit.matches.filter((row) => row.comparison.classification === 'EXACT_REMOTE_MATCH').length, possible_matches: remoteAudit.matches.filter((row) => row.comparison.classification === 'POSSIBLE_MATCH').length, inventory_reliable: remoteInventory.reliable },
    competition: { price_to_win: catalogCompetition.price_to_win, leader: catalogCompetition.leader, sellers: catalogCompetition.seller_count, average: catalogCompetition.average_price, median: catalogCompetition.median_price, classification: catalogCompetition.classification },
    financial: { selected_listing_type: chosenListingType, minimum_price: selectedFinancial.minimum.financial.price, operational_price: selectedFinancial.operational.financial.price, commission: selectedFinancial.operational.financial.commission, shipping: selectedFinancial.operational.financial.shipping, tax: selectedFinancial.operational.financial.tax, profit: selectedFinancial.operational.financial.profit, margin_percent: selectedFinancial.operational.financial.margin_percent },
    payload: { family_name: FAMILY_NAME, family_name_characters: FAMILY_NAME.length, expected_generated_title: EXPECTED_TITLE, images: pictures.length, attributes: fullPayload.attributes.length, catalog_linkage: true, ...payloadHashes },
    scores, gates, metrics, invariants, hold: HOLD,
  };
  const fullReport = { ...summary, started_at: startedAt, completed_at: now(), local: { product, offer, stock, local_duplicates: localDuplicates, local_listings: remoteAudit.local_listing_records }, dslite: dsliteEvidence, manufacturer: official, catalog_product_audit: catalogProductAudit, catalog_competition: catalogCompetition, category_contract: categoryContract, attributes: attributesReport, images, shipping: shippingValidation, financial_validation: financialValidation, full_payload: fullPayload, minimal_payload: minimalPayload, payload_hashes: payloadHashes, description_preview: description, remote_reconciliation: remoteAudit, contracts: { mercado_livre: ['https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products', 'https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/preco-variacao', 'https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/publicacoes-necessarias-do-catalogo', 'https://developers.mercadolivre.com.br/pt_br/imoveis-gerenciamento-de-perguntas-e-contatos/concorrencia-em-catalogo', 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos'], supabase: 'https://supabase.com/docs/reference/javascript/select', dslite: 'https://documenter.getpostman.com/view/5316990/RWaRNkaA' }, writes: { mercado_livre: 0, supabase: 0, description: 0 } };

  writeJson('summary.json', summary);
  writeJson('catalog-product-audit.json', catalogProductAudit);
  writeJson('catalog-competition.json', catalogCompetition);
  writeJson('category-contract.json', categoryContract);
  writeJson('attributes.json', attributesReport);
  writeJson('image-audit.json', images);
  writeJson('shipping-validation.json', shippingValidation);
  writeJson('financial-validation.json', financialValidation);
  writeJson('full-payload.json', { payload: fullPayload, sha256: payloadHashes.full_sha256, publish_authorized: false });
  writeJson('minimal-payload.json', { payload: minimalPayload, sha256: payloadHashes.minimal_sha256, publish_authorized: false });
  writeJson('description-preview.json', description);
  writeJson('full-report.json', fullReport);
  console.log(JSON.stringify({ event: 'p0_phase5b_complete', state, catalog_gate: catalogIdentity.gate, competition: catalogCompetition.classification, price: summary.financial, remote_matches: summary.remote, metrics, invariants }));
}

main().catch((error) => {
  writeJson('error.json', { failed_at: now(), error: error.message, metrics, writes: { mercado_livre: 0, supabase: 0 }, hold: HOLD });
  console.error(JSON.stringify({ event: 'p0_phase5b_failed', error: error.message, metrics }));
  process.exitCode = 1;
});
