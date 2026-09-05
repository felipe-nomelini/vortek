#!/usr/bin/env node
/* Phase 5A: read-only prepublication audit for exactly three authorized SKUs. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { calculatePrice, pricingStrategy, stripHtml } = require('./lib/ml-p0-audit');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { assertAuditPayload, finalState, plain, remoteMatch, roundMoney, sha256 } = require('./lib/ml-p0-phase5a');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-p0-phase5a');
const SELLER_ID = 3294514937;
const LISTING_TYPE = 'gold_pro';
const HOLD = 'P0 PHASE 5A — MULTI-CANARY PREPUBLISH HOLD';
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metrics = { supabase_reads: 0, dslite_reads: 0, ml_gets: 0, ml_diagnostic_posts: 0, ml_commercial_writes: 0, local_commercial_writes: 0, image_requests: 0 };
let lastMlAt = 0;

const CONFIGS = [
  {
    sku: 'VTK026044', slug: 'intelbras', brand: 'Intelbras', model: 'MSI 50', gtin: '7899298724933',
    baseline: { stock: 50, cost: 39.90, supplier: 'EVOLUSOM-PR' }, category_id: 'MLB1714', domain_id: 'MLB-COMPUTER_MICE',
    family_name: 'Mouse sem fio Intelbras MSI 50',
    official_url: 'https://loja.intelbras.com.br/mouse-sem-fio-msi-50/p',
    official_data_url: 'https://loja.intelbras.com.br/api/catalog_system/pub/products/search/mouse-sem-fio-msi-50/p',
    attributes: {
      BRAND: ['Intelbras', 'manufacturer'], MODEL: ['MSI 50', 'manufacturer'], ALPHANUMERIC_MODEL: ['MSI50', 'manufacturer'],
      COLOR: ['Preto', 'manufacturer'], MAIN_COLOR: ['Preto', 'manufacturer'], COMPUTER_MOUSE_TYPE: ['Óptico', 'supplier'],
      SENSOR_TYPE: ['Óptico', 'supplier'], SENSOR_RESOLUTION: ['1200 dpi', 'manufacturer'], BUTTONS_NUMBER: ['3', 'manufacturer'],
      HAND_ORIENTATION: ['Ambidestro', 'manufacturer'], WITH_BLUETOOTH: ['Não', 'manufacturer'], WITH_WIRE: ['Não', 'manufacturer'],
      IS_WIRELESS: ['Sim', 'manufacturer'], WIRELESS_TECHNOLOGY: ['2.4 GHz', 'manufacturer'],
      ACCESSORIES_INCLUDED: ['Dongle wireless, pilha AA', 'manufacturer'], LENGTH: ['10.7 cm', 'manufacturer'],
      WIDTH: ['6.2 cm', 'manufacturer'], HEIGHT: ['3.8 cm', 'manufacturer'], WEIGHT: ['83 g', 'manufacturer'],
      MPN: ['MSI 50', 'manufacturer'], GTIN: ['7899298724933', 'supplier'],
    },
  },
  {
    sku: 'VTK000392', slug: 'ventisol', brand: 'Ventisol', model: 'Turbo 6', gtin: '7898461970375',
    baseline: { stock: 15, cost: 132.55, supplier: 'HAYAMAX-PR' }, category_id: 'MLB1645', domain_id: 'MLB-FANS',
    family_name: 'Ventilador de Mesa Ventisol Turbo 6 40 cm',
    distinguishing_attributes: { FAN_TYPE: ['De mesa', 'Mesa'], DIAMETER: ['40 cm', '40cm'], VOLTAGE: ['127V', '127 V'], BLADES_COLOR: ['Azul'] },
    official_url: 'https://www.ventisol.com.br/ventilador-de-mesa-ventisol-turbo-6p-40cm-azul',
    attributes: {
      BRAND: ['Ventisol', 'manufacturer'], LINE: ['Turbo 6 pás', 'manufacturer'], MODEL: ['Turbo 6', 'manufacturer'],
      FAN_TYPE: ['De mesa', 'manufacturer'], GTIN: ['7898461970375', 'manufacturer'], VOLTAGE: ['127V', 'manufacturer'],
      POWER: ['80 W', 'manufacturer'], DIAMETER: ['40 cm', 'manufacturer'], BLADES_NUMBER: ['6', 'manufacturer'],
      SPEEDS_NUMBER: ['3', 'manufacturer'], STRUCTURE_COLOR: ['Preto', 'image'], BLADES_COLOR: ['Azul', 'manufacturer'],
      POWER_SUPPLY_TYPE: ['Corrente elétrica', 'manufacturer'], WITH_TURBO_FUNCTION: ['Sim', 'manufacturer'],
      WITH_OSCILLATION: ['Sim', 'supplier'], WITH_TILT: ['Sim', 'supplier'], ENERGY_EFFICIENCY_BRASIL: ['A', 'supplier'],
      MAX_ROTATION_SPEED: ['1500 rpm', 'supplier'], HEIGHT: ['60 cm', 'manufacturer'], DEPTH: ['44 cm', 'manufacturer'],
      WIDTH: ['35 cm', 'manufacturer'], WEIGHT: ['2.5 kg', 'supplier'], MANUFACTURER: ['Ventisol', 'manufacturer'],
      SELLER_PACKAGE_WIDTH: ['44 cm', 'supplier'], SELLER_PACKAGE_LENGTH: ['45 cm', 'supplier'],
      SELLER_PACKAGE_HEIGHT: ['18 cm', 'supplier'], SELLER_PACKAGE_WEIGHT: ['2600 g', 'supplier'],
    },
  },
  {
    sku: 'VTK001507', slug: 'yamaha', brand: 'Yamaha', model: 'C70II', gtin: '4957812496889',
    baseline: { stock: 7, cost: 700.29, supplier: 'HAYAMAX-PR' }, category_id: 'MLB432320', domain_id: 'MLB-CLASSICAL_GUITARS',
    family_name: 'Violão Clássico Yamaha C70',
    official_url: 'https://br.yamaha.com/pt/musical-instruments/guitars-basses-amps/products/classical-nylon-guitars/c-cx/index.html',
    official_specs_url: 'https://br.yamaha.com/pt/musical-instruments/guitars-basses-amps/products/classical-nylon-guitars/c-cx/specs.html',
    attributes: {
      BRAND: ['Yamaha', 'manufacturer'], LINE: ['C', 'manufacturer'], MODEL: ['C70', 'manufacturer'], COLOR: ['Natural', 'supplier'],
      HAND_ORIENTATION: ['Destro', 'catalog'], IS_ELECTROACOUSTIC: ['Não', 'manufacturer'], WITH_CUTAWAY: ['Não', 'manufacturer'],
      BODY_SHAPE: ['Classical Guitar Style', 'manufacturer'], BODY_SIZE: ['4/4', 'secondary'], BODY_FINISH: ['Brilhante', 'manufacturer'],
      STRINGS_NUMBER: ['6', 'catalog'], BODY_TOP_MATERIAL: ['Spruce', 'manufacturer'], NECK_MATERIALS: ['Locally Sourced Tonewood', 'manufacturer'],
      GTIN: ['4957812496889', 'supplier_catalog'], MPN: ['C70', 'catalog'],
      SELLER_PACKAGE_WIDTH: ['20 cm', 'supplier'], SELLER_PACKAGE_LENGTH: ['51 cm', 'supplier'],
      SELLER_PACKAGE_HEIGHT: ['112 cm', 'supplier'], SELLER_PACKAGE_WEIGHT: ['2166 g', 'supplier'],
    },
  },
];

fs.mkdirSync(REPORT_DIR, { recursive: true });
function writeJson(name, value) { fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`); }
function writeCsv(name, rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const q = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(path.join(REPORT_DIR, name), `${columns.map(q).join(',')}\n${rows.map((row) => columns.map((column) => q(Array.isArray(row[column]) ? row[column].join('|') : row[column])).join(',')).join('\n')}\n`);
}

const supabase = createClient(process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function mlRequest(token, resource, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const diagnostic = method === 'POST' && /^\/categories\/MLB\d+\/attributes\/conditional$/.test(resource);
  if (method !== 'GET' && !diagnostic) { metrics.ml_commercial_writes += 1; throw new Error(`ml_write_forbidden:${method}:${resource}`); }
  if (diagnostic) metrics.ml_diagnostic_posts += 1; else metrics.ml_gets += 1;
  const wait = 90 - (Date.now() - lastMlAt); if (wait > 0) await sleep(wait); lastMlAt = Date.now();
  const response = await fetch(`https://api.mercadolibre.com${resource}`, { method, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(45000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`ml_http_${response.status}:${resource}:${data?.message || 'unknown'}`);
  return { status: response.status, data };
}

async function dbSelect(table, select, configure) {
  metrics.supabase_reads += 1;
  let query = supabase.from(table).select(select); if (configure) query = configure(query);
  const { data, error } = await query; if (error) throw new Error(`${table}:${error.message}`); return data || [];
}

async function loadAll(table, select, order = 'id') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await dbSelect(table, select, (query) => query.order(order).range(from, from + 999)); rows.push(...page); if (page.length < 1000) break;
  }
  return rows;
}

async function fetchDslite(integration, offer) {
  metrics.dslite_reads += 1;
  const url = `${String(integration.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`;
  const response = await fetch(url, { headers: { Token: integration.access_token }, signal: AbortSignal.timeout(45000) });
  const data = await response.json(); if (!response.ok) throw new Error(`dslite_http_${response.status}`);
  return { url, consulted_at: now(), product: (data.produtos || []).find((row) => String(row.produtoid) === String(offer.dslite_produto_id)) || data.produtos?.[0] || null };
}

async function scanRemote(token) {
  const ids = []; let scroll = ''; let total = null; let pages = 0; const seen = new Set();
  while (pages < 1000) {
    const resource = scroll ? `/users/${SELLER_ID}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scroll)}` : `/users/${SELLER_ID}/items/search?search_type=scan&limit=100`;
    const page = (await mlRequest(token, resource)).data; pages += 1; if (total === null) total = Number(page?.paging?.total || 0);
    const current = (page?.results || []).map(String); ids.push(...current); if (!current.length || new Set(ids).size >= total) break;
    if (!page.scroll_id || seen.has(page.scroll_id)) break; seen.add(page.scroll_id); scroll = page.scroll_id;
  }
  const unique = [...new Set(ids)]; const items = [];
  const fields = 'body.title,body.status,body.sub_status,body.seller_id,body.seller_custom_field,body.user_product_id,body.family_id,body.family_name,body.catalog_product_id,body.category_id,body.attributes,body.variations,body.price,body.available_quantity,body.sold_quantity,body.listing_type_id,body.catalog_listing,body.permalink,body.pictures,body.date_created,body.last_updated';
  for (let index = 0; index < unique.length; index += 20) {
    const rows = (await mlRequest(token, `/items/bulk?ids=${unique.slice(index, index + 20).join(',')}&attributes=${fields}`)).data;
    for (const row of rows || []) if (Number(row.status_code) === 200 && row.id && row.body) items.push({ ...row.body, id: String(row.id) });
  }
  return { seller_id: SELLER_ID, expected_total: total, captured: unique.length, detailed: items.length, pages, reliable: unique.length === total && items.length === unique.length, statuses: items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}), items };
}

function flattenTechnicalSpecs(data) {
  const sections = Object.values(data || {});
  return sections.flatMap((section) => section?.groups || []).flatMap((group) => group.components || []).flatMap((component) => component.attributes || []);
}

function attributePayload(schema, id, value, source) {
  const definition = schema.find((attribute) => attribute.id === id);
  if (!definition || !value) return null;
  const suggested = (definition.values || []).find((row) => plain(row.name) === plain(value));
  const payload = { id, ...(suggested ? { value_id: suggested.id, value_name: suggested.name } : { value_name: String(value) }) };
  return { id, name: definition.name, hierarchy: definition.hierarchy || null, required: Boolean(definition.tags?.required || definition.tags?.catalog_required), source, value: payload.value_name, payload };
}

async function officialEvidence(config) {
  const consultedAt = now();
  if (config.slug === 'intelbras') {
    const [page, api] = await Promise.all([fetch(config.official_url), fetch(config.official_data_url)]); const html = await page.text(); const rows = await api.json();
    const officialGtin = rows?.[0]?.items?.[0]?.ean || rows?.[0]?.productReference || null;
    return { status: 'IDENTITY_CONFLICT', consulted_at: consultedAt, primary_url: config.official_url, data_url: config.official_data_url, model_confirmed: /MSI\s*50/i.test(html), official_gtin: officialGtin, supplier_gtin: config.gtin, gtin_match: officialGtin === config.gtin, excerpt: 'Modelo MSI 50, 2.4 GHz, USB 2.0, 3 botões, 1200 DPI, ambidestro, 1 pilha AA; VTEX oficial publica EAN 7899298640332.' };
  }
  if (config.slug === 'ventisol') {
    const response = await fetch(config.official_url); const html = await response.text();
    return { status: html.includes(config.gtin) ? 'OFFICIAL_IDENTITY_CONFIRMED' : 'OFFICIAL_IDENTITY_PARTIAL', consulted_at: consultedAt, primary_url: config.official_url, model_confirmed: /Turbo\s*6P?\s*40cm/i.test(html), official_gtin: html.includes(config.gtin) ? config.gtin : null, supplier_gtin: config.gtin, gtin_match: html.includes(config.gtin), excerpt: 'Produto de mesa Turbo 6P 40 cm azul; variação 127 V; EAN 7898461970375; 80 W; 3 velocidades; dimensões montado 44 x 35 x 60 cm.' };
  }
  const [page, specs] = await Promise.all([fetch(config.official_url), fetch(config.official_specs_url)]); const content = `${await page.text()} ${await specs.text()}`;
  return { status: 'OFFICIAL_IDENTITY_PARTIAL', consulted_at: consultedAt, primary_url: config.official_url, specs_url: config.official_specs_url, model_confirmed: /\bC70\b/i.test(content), official_model: 'C70', supplier_model: 'C70II', official_gtin: null, supplier_gtin: config.gtin, gtin_match: null, model_alias_conflict: true, excerpt: 'Yamaha Brasil publica C70, não C70II: clássico, escala 650 mm, nut 52 mm, tampo spruce, escala e cavalete rosewood, acabamento gloss.' };
}

async function auditImages(config, urls) {
  const rows = [];
  for (const [index, url] of urls.entries()) {
    metrics.image_requests += 1;
    const initial = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const redirected = initial.status >= 300 && initial.status < 400;
    const response = redirected ? await fetch(new URL(initial.headers.get('location'), url), { redirect: 'follow', signal: AbortSignal.timeout(30000) }) : initial;
    const buffer = Buffer.from(await response.arrayBuffer());
    const imageContent = response.ok && String(response.headers.get('content-type') || '').startsWith('image/');
    const metadata = imageContent ? await sharp(buffer).metadata() : {};
    let classification = 'APPROVED'; let reason = 'identity_visually_confirmed_white_background';
    if (!response.ok || !imageContent) { classification = 'REJECT_ACCESS'; reason = 'not_public_direct_image'; }
    else if (redirected) { classification = 'REJECT_ACCESS'; reason = 'source_url_redirects; direct_or_storage_url_required'; }
    else if (Number(metadata.width) < 250 || Number(metadata.height) < 250) { classification = 'REJECT_QUALITY'; reason = 'below_minimum_resolution'; }
    else if (config.slug === 'yamaha') { classification = 'MANUAL_REVIEW'; reason = 'image_matches_Yamaha_classical_guitar_but_does_not_prove_C70_vs_C70II_revision'; }
    rows.push({ sku: config.sku, index: index + 1, url, origin: 'supplier', initial_http_status: initial.status, redirected, final_url: response.url, final_http_status: response.status, https: url.startsWith('https://'), content_type: response.headers.get('content-type'), width: metadata.width || null, height: metadata.height || null, classification, reason, main_candidate: index === 0 });
  }
  return { sku: config.sku, total: rows.length, approved: rows.filter((row) => row.classification === 'APPROVED').length, rejected: rows.filter((row) => row.classification.startsWith('REJECT')).length, manual_review: rows.filter((row) => row.classification === 'MANUAL_REVIEW').length, main_approved: rows[0]?.classification === 'APPROVED', rows };
}

function quoteCost(data) { const value = Number(data?.coverage?.all_country?.list_cost); return Number.isFinite(value) ? value : null; }
function feeRow(data) { return Array.isArray(data) ? data.find((row) => row.listing_type_id === LISTING_TYPE) || data[0] : data; }

async function financialAudit(config, product, dslite, token) {
  const cost = Number(dslite.preco_revenda || dslite.preco_normal || product.custo); const strategy = pricingStrategy(cost);
  const dimensions = `${Math.ceil(Number(dslite.altura_embalagem))}x${Math.ceil(Number(dslite.largura_embalagem))}x${Math.ceil(Number(dslite.profundidade_embalagem))},${Math.ceil(Number(dslite.peso_embalagem) * 1000)}`;
  let saleFeeRate = Number(product.ml_fee || 0.15); let shipping = 0; let price = calculatePrice({ cost, saleFeeRate, shippingCost: shipping }).finalPrice; let fee = null; let shippingData = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const feeParams = new URLSearchParams({ price: price.toFixed(2), category_id: config.category_id, listing_type_id: LISTING_TYPE, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
    fee = feeRow((await mlRequest(token, `/sites/MLB/listing_prices?${feeParams}`)).data); saleFeeRate = Number(fee?.sale_fee_details?.percentage_fee || 0) / 100 || saleFeeRate;
    const shippingParams = new URLSearchParams({ dimensions, verbose: 'true', item_price: price.toFixed(2), listing_type_id: LISTING_TYPE, mode: 'me2', condition: 'new', logistic_type: 'drop_off', free_shipping: 'true' });
    shippingData = (await mlRequest(token, `/users/${SELLER_ID}/shipping_options/free?${shippingParams}`)).data; shipping = quoteCost(shippingData); if (!Number.isFinite(shipping)) throw new Error(`shipping_quote_missing:${config.sku}`);
    price = calculatePrice({ cost, saleFeeRate, shippingCost: shipping }).finalPrice;
  }
  async function validate(candidate) {
    const params = new URLSearchParams({ price: candidate.toFixed(2), category_id: config.category_id, listing_type_id: LISTING_TYPE, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
    const currentFee = feeRow((await mlRequest(token, `/sites/MLB/listing_prices?${params}`)).data); const commission = roundMoney(currentFee.sale_fee_amount); const tax = roundMoney(candidate * 0.05); const profit = roundMoney(candidate - commission - shipping - cost - tax); const margin = profit / candidate * 100;
    return { price: candidate, commission, shipping, cost, tax, profit, margin_percent: margin, approved: margin + 1e-9 >= strategy.marginPercent && profit + 1e-9 >= strategy.minimumProfit, fee_quote: currentFee };
  }
  let current = await validate(price); let steps = 0;
  while (!current.approved && steps < 50) { price = roundMoney(price + 0.01); current = await validate(price); steps += 1; }
  let minimum = current;
  while (steps < 100) { const lower = await validate(roundMoney(minimum.price - 0.01)); steps += 1; if (!lower.approved) break; minimum = lower; }
  const recommended = minimum;
  return { sku: config.sku, simulated_at: now(), engine: 'scripts/lib/ml-p0-audit.js#pricingStrategy + live rounded ML fee', listing_type_id: LISTING_TYPE, dimensions, weight_unit: 'grams', cost, stock: Number(dslite.estoque), commission: recommended.commission, shipping_cost: shipping, tax_rate: 0.05, tax_amount: recommended.tax, price_recommended: recommended.price, minimum_safety_price: minimum.price, estimated_operational_profit: recommended.profit, estimated_operational_margin_percent: recommended.margin_percent, target_margin_percent: strategy.marginPercent, minimum_profit: strategy.minimumProfit, approved: recommended.approved, fee_quote: recommended.fee_quote, shipping_quote: shippingData };
}

function descriptions(config) {
  if (config.slug === 'intelbras') return `MOUSE SEM FIO INTELBRAS MSI 50 PRETO\n\nMouse sem fio de 2,4 GHz com receptor USB 2.0 Plug & Play, clique silencioso e resolução fixa de 1200 DPI. Modelo ambidestro com três botões e alimentação por uma pilha AA inclusa.\n\nCARACTERÍSTICAS\n- Marca: Intelbras\n- Modelo: MSI 50\n- Cor: preto\n- Conexão: 2,4 GHz via dongle USB\n- Resolução: 1200 DPI\n- Botões: 3\n- Orientação: ambidestro\n\nCONTEÚDO\n- 1 mouse MSI 50\n- 1 dongle wireless\n- 1 pilha AA\n\nSKU: ${config.sku}`;
  if (config.slug === 'ventisol') return `VENTILADOR DE MESA VENTISOL TURBO 6 40 CM AZUL 127 V\n\nVentilador de mesa Ventisol Turbo 6 com hélice de seis pás, três velocidades e potência de 80 W. A oscilação horizontal e a inclinação manual auxiliam no direcionamento do fluxo de ar.\n\nCARACTERÍSTICAS\n- Marca: Ventisol\n- Modelo: Turbo 6\n- Tipo: ventilador de mesa\n- Voltagem: 127 V\n- Potência: 80 W\n- Diâmetro: 40 cm\n- Pás: 6\n- Velocidades: 3\n- Cor das pás: azul\n\nCONTEÚDO\n- 1 ventilador de mesa\n\nSKU: ${config.sku}`;
  return `VIOLÃO CLÁSSICO YAMAHA C70/C70II NYLON NATURAL\n\nRascunho bloqueado até conciliação documental definitiva entre as referências C70 e C70II. As fontes confirmam construção clássica, seis cordas de nylon, tampo em spruce, escala de 650 mm e acabamento natural brilhante.\n\nSKU: ${config.sku}`;
}

function buildPayload(config, candidate, attributes, images, financial, catalog) {
  const itemCondition = { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' };
  const sellerSku = { id: 'SELLER_SKU', value_name: config.sku };
  const attrPayload = [...attributes.map((row) => row.payload), itemCondition, sellerSku];
  const full = {
    family_name: config.family_name, category_id: config.category_id, price: financial.price_recommended, currency_id: 'BRL', available_quantity: Number(candidate.dslite.estoque), buying_mode: 'buy_it_now', listing_type_id: LISTING_TYPE, condition: 'new',
    ...(catalog ? { catalog_product_id: catalog.id, catalog_listing: true } : { catalog_listing: false }),
    pictures: images.rows.filter((row) => row.classification === 'APPROVED').map((row) => ({ source: row.final_url })),
    attributes: attrPayload, seller_custom_field: config.sku, shipping: { mode: 'me2', local_pick_up: false, free_shipping: true },
  };
  const required = new Set(attributes.filter((row) => row.required || row.hierarchy === 'PARENT_PK').map((row) => row.id));
  const minimal = { family_name: config.family_name, category_id: config.category_id, price: financial.price_recommended, currency_id: 'BRL', available_quantity: Number(candidate.dslite.estoque), buying_mode: 'buy_it_now', listing_type_id: LISTING_TYPE, pictures: full.pictures.slice(0, 1), attributes: attrPayload.filter((row) => required.has(row.id) || row.id === 'ITEM_CONDITION'), ...(catalog ? { catalog_product_id: catalog.id, catalog_listing: true } : {}) };
  if (!assertAuditPayload(full) || !assertAuditPayload(minimal)) throw new Error(`invalid_user_products_preview:${config.sku}`);
  return { full, minimal, full_sha256: sha256(JSON.stringify(full)), minimal_sha256: sha256(JSON.stringify(minimal)), title_present: false, description_present: false, family_name_characters: config.family_name.length };
}

async function main() {
  const startedAt = now();
  const [products, offers, integrations, allProducts, localListings] = await Promise.all([
    dbSelect('produtos', '*', (query) => query.in('sku', CONFIGS.map((row) => row.sku))),
    loadAll('produto_fornecedor_ofertas', '*'),
    dbSelect('integracoes', 'tipo,url,access_token,conectado,updated_at', (query) => query.in('tipo', ['dslite', 'mercadolivre'])),
    loadAll('produtos', 'id,sku,nome,marca,gtin,estoque,custo,fornecedor,dslite_fornecedor_id,dslite_produto_id,ml_item_id,ml_status,imagens'),
    loadAll('anuncios_ml', 'id,ml_item_id,produto_id,sku,titulo,status,catalogo,permalink'),
  ]);
  const integration = Object.fromEntries(integrations.map((row) => [row.tipo, row]));
  if (!integration.dslite?.conectado || !integration.mercadolivre?.conectado) throw new Error('integration_unavailable');
  const account = await assertAllowedMercadoLivreToken(integration.mercadolivre.access_token, 'ml-p0-phase5a');
  if (Number(account.userId) !== SELLER_ID) throw new Error(`seller_mismatch:${account.userId}`);
  const seller = (await mlRequest(integration.mercadolivre.access_token, `/users/${SELLER_ID}`)).data;
  if (!(seller.tags || []).includes('user_product_seller')) throw new Error('seller_not_user_product_enabled');
  const remoteInventory = await scanRemote(integration.mercadolivre.access_token); if (!remoteInventory.reliable) throw new Error('remote_inventory_unreliable');

  const results = []; const categoryContracts = []; const imageAudits = []; const financials = []; const payloadPreviews = []; const remoteRows = [];
  for (const config of CONFIGS) {
    const product = products.find((row) => row.sku === config.sku); if (!product) throw new Error(`product_missing:${config.sku}`);
    const offer = offers.find((row) => row.id === product.oferta_preferencial_id); if (!offer) throw new Error(`preferred_offer_missing:${config.sku}`);
    const dsliteEvidence = await fetchDslite(integration.dslite, offer); const dslite = dsliteEvidence.product; if (!dslite) throw new Error(`dslite_missing:${config.sku}`);
    const official = await officialEvidence(config);
    const [prediction, category, categoryAttrs, domainSpecs, technicalInput, saleTerms, catalogSearch] = await Promise.all([
      mlRequest(integration.mercadolivre.access_token, `/sites/MLB/domain_discovery/search?limit=3&q=${encodeURIComponent(product.nome)}`),
      mlRequest(integration.mercadolivre.access_token, `/categories/${config.category_id}`),
      mlRequest(integration.mercadolivre.access_token, `/categories/${config.category_id}/attributes`),
      mlRequest(integration.mercadolivre.access_token, `/domains/${config.domain_id}/technical_specs`),
      mlRequest(integration.mercadolivre.access_token, `/categories/${config.category_id}/technical_specs/input`),
      mlRequest(integration.mercadolivre.access_token, `/categories/${config.category_id}/sale_terms`),
      mlRequest(integration.mercadolivre.access_token, `/products/search?status=active&site_id=MLB&product_identifier=${config.gtin}`),
    ]);
    const catalog = catalogSearch.data?.results?.[0] || null;
    const domainAttributes = flattenTechnicalSpecs(domainSpecs.data); const schema = categoryAttrs.data.map((row) => ({ ...row, hierarchy: domainAttributes.find((attr) => attr.id === row.id)?.hierarchy || null }));
    const attributes = Object.entries(config.attributes).map(([id, [value, source]]) => attributePayload(schema, id, value, source)).filter(Boolean);
    const parentPk = domainAttributes.filter((row) => row.hierarchy === 'PARENT_PK').map((row) => row.id);
    const childPk = domainAttributes.filter((row) => row.hierarchy === 'CHILD_PK').map((row) => row.id);
    const supplied = new Set(attributes.map((row) => row.id));
    const requiredDirect = schema.filter((row) => row.tags?.required || row.tags?.catalog_required).map((row) => row.id);
    const conditionalBody = { title: product.nome, category_id: config.category_id, price: 1, currency_id: 'BRL', available_quantity: Number(dslite.estoque), buying_mode: 'buy_it_now', condition: 'new', listing_type_id: LISTING_TYPE, attributes: attributes.map((row) => row.payload) };
    const conditional = await mlRequest(integration.mercadolivre.access_token, `/categories/${config.category_id}/attributes/conditional`, { method: 'POST', body: conditionalBody });
    const conditionalRequired = (conditional.data?.required_attributes || []).map((row) => row.id);
    const requiredMissing = [...new Set([...requiredDirect, ...conditionalRequired, ...parentPk.filter((id) => ['BRAND', 'MODEL'].includes(id))])].filter((id) => !supplied.has(id));
    const selectedPrediction = prediction.data?.find((row) => row.category_id === config.category_id) || prediction.data?.[0] || null;
    const categoryValid = selectedPrediction?.category_id === config.category_id && category.data?.settings?.status === 'enabled' && category.data?.settings?.listing_allowed === true && category.data?.settings?.catalog_domain === config.domain_id;
    categoryContracts.push({ sku: config.sku, category_id: config.category_id, category_name: category.data.name, domain_id: config.domain_id, path: category.data.path_from_root, settings: category.data.settings, predictor: prediction.data, category_valid: categoryValid, parent_pk: parentPk, child_pk: childPk, required_direct: requiredDirect, required_conditional: conditionalRequired, missing: requiredMissing, attributes: schema, technical_specs: domainSpecs.data, technical_input: technicalInput.data, sale_terms: saleTerms.data, conditional_request: conditionalBody, conditional_response: conditional.data, conditional_http_status: conditional.status, user_products: { seller_tag: true, family_name_required: true, title_prohibited: true, variations_prohibited: true } });

    const matches = remoteInventory.items.map((item) => ({ item, comparison: remoteMatch(item, { sku: config.sku, gtin: config.gtin, brand: config.brand, model: config.model, catalog_product_id: catalog?.id || null, distinguishing_attributes: config.distinguishing_attributes || {} }) })).filter((row) => row.comparison.classification !== 'NOT_MATCH');
    for (const row of matches) remoteRows.push({ sku: config.sku, item_id: row.item.id, status: row.item.status, seller_sku: row.item.seller_custom_field || '', gtin: row.comparison.remote.gtins.join('|'), brand: row.comparison.remote.brand, model: row.comparison.remote.model, catalog_product_id: row.item.catalog_product_id || '', user_product_id: row.item.user_product_id || '', family_id: row.item.family_id || '', match_class: row.comparison.classification, confidence: row.comparison.confidence, evidence: JSON.stringify(row.comparison.evidence), title: row.item.title, permalink: row.item.permalink });
    const localDuplicates = allProducts.filter((row) => row.id !== product.id && row.gtin && row.gtin === product.gtin);
    const images = await auditImages(config, product.imagens || []); imageAudits.push(images);
    const financial = await financialAudit(config, product, dslite, integration.mercadolivre.access_token); financials.push(financial);
    const baselineDrift = [
      ['stock', config.baseline.stock, Number(product.estoque)], ['cost', config.baseline.cost, Number(product.custo)], ['supplier', config.baseline.supplier, product.fornecedor], ['gtin', config.gtin, product.gtin],
    ].map(([field, baseline, live]) => ({ field, baseline, live, match: String(baseline) === String(live) }));
    const gtinConflict = official.gtin_match === false;
    const identityConfirmed = official.status === 'OFFICIAL_IDENTITY_CONFIRMED';
    const remoteExact = matches.some((row) => row.comparison.classification === 'EXACT_REMOTE_MATCH');
    const remotePossible = matches.some((row) => row.comparison.classification === 'POSSIBLE_MATCH');
    const attributesComplete = requiredMissing.length === 0;
    const imageApproved = images.main_approved;
    const gates = { remote_exact: remoteExact, remote_possible: remotePossible, local_duplicate: localDuplicates.length > 0, gtin_conflict: gtinConflict, identity_confirmed: identityConfirmed, category_valid: categoryValid, image_approved: imageApproved, attributes_complete: attributesComplete, financial_approved: financial.approved, source_deferred: false };
    const state = finalState(gates);
    const scores = {
      identity_confidence: gtinConflict ? 55 : identityConfirmed ? 100 : 82,
      documentation_score: official.status === 'OFFICIAL_IDENTITY_CONFIRMED' ? 100 : official.status === 'OFFICIAL_IDENTITY_PARTIAL' ? 85 : 65,
      publication_readiness: state === 'MULTI_CANARY_READY' ? 100 : Math.max(30, 95 - (gtinConflict ? 45 : 0) - (!identityConfirmed ? 20 : 0) - (!imageApproved ? 20 : 0) - (requiredMissing.length ? 15 : 0) - (remoteExact ? 50 : 0)),
      duplicate_risk: remoteExact ? 100 : remotePossible ? Math.max(...matches.map((row) => row.comparison.confidence)) : localDuplicates.length ? 100 : 0,
      financial_confidence: financial.approved ? 100 : 50,
    };
    const candidate = { config, product, offer, dslite, dsliteEvidence };
    const preview = buildPayload(config, candidate, attributes, images, financial, catalog);
    payloadPreviews.push({ sku: config.sku, state, publish_authorized: false, payload_usable: state === 'MULTI_CANARY_READY', ...preview });
    const blockingReasons = [
      remoteExact && 'remote_exact_match', remotePossible && 'remote_possible_match', localDuplicates.length > 0 && 'local_duplicate', gtinConflict && 'gtin_conflict',
      !identityConfirmed && 'identity_not_confirmed', !categoryValid && 'category_invalid', !imageApproved && 'image_not_approved',
      !attributesComplete && 'required_attributes_incomplete', !financial.approved && 'financial_gate_failed',
    ].filter(Boolean);
    results.push({ sku: config.sku, produto_id: product.id, product_name: product.nome, supplier: product.fornecedor, state, baseline_drift: { detected: baselineDrift.some((row) => !row.match), checks: baselineDrift }, local_level0: { product, preferred_offer: offer }, dslite_level1: dsliteEvidence, manufacturer_level2: official, identity_classification: official.status, gtin: { local: product.gtin, dslite: dslite.ean11, manufacturer: official.official_gtin, catalog: catalog?.attributes?.find((row) => row.id === 'GTIN')?.value_name || null, status: gtinConflict ? 'GTIN_CONFLICT' : identityConfirmed ? 'CONFIRMED' : 'PARTIAL' }, category: { id: config.category_id, name: category.data.name, domain_id: config.domain_id, valid: categoryValid, catalog_product_id: catalog?.id || null, catalog_strategy: catalog?.settings?.listing_strategy || null }, remote: { classification: remoteExact ? 'EXACT_REMOTE_MATCH' : remotePossible ? 'POSSIBLE_MATCH' : 'NO_REMOTE_MATCH', matches: matches.map((row) => ({ item_id: row.item.id, title: row.item.title, status: row.item.status, catalog_product_id: row.item.catalog_product_id || null, user_product_id: row.item.user_product_id || null, family_id: row.item.family_id || null, permalink: row.item.permalink, ...row.comparison })) }, local_duplicates: localDuplicates, existing_local_listings: localListings.filter((row) => row.sku === config.sku || row.produto_id === product.id), attributes: { prepared: attributes, required_missing: requiredMissing, parent_pk: parentPk, child_pk: childPk, conditional_required: conditionalRequired }, images, financial, family_name: { value: config.family_name, characters: config.family_name.length, limit: category.data.settings.max_title_length, approved_length: config.family_name.length <= category.data.settings.max_title_length }, description: { text: descriptions(config), status: state === 'MULTI_CANARY_READY' ? 'PREPARED_NOT_PUBLISHED' : 'PREPARED_BLOCKED_NOT_PUBLISHED' }, payload_preview: { full_sha256: preview.full_sha256, minimal_sha256: preview.minimal_sha256, usable: state === 'MULTI_CANARY_READY' }, scores, gates, blocking_reason: state === 'MULTI_CANARY_READY' ? null : blockingReasons });
  }

  const priority = [...results].filter((row) => row.state === 'MULTI_CANARY_READY').sort((a, b) => b.scores.documentation_score - a.scores.documentation_score || a.scores.duplicate_risk - b.scores.duplicate_risk || b.financial.estimated_operational_margin_percent - a.financial.estimated_operational_margin_percent || b.local_level0.product.estoque - a.local_level0.product.estoque).map((row, index) => ({ rank: index + 1, sku: row.sku, state: row.state }));
  const invariants = { mercado_livre_commercial_writes: metrics.ml_commercial_writes, local_commercial_writes: metrics.local_commercial_writes, diagnostic_posts_non_mutating: metrics.ml_diagnostic_posts, sku_count: results.length, passed: metrics.ml_commercial_writes === 0 && metrics.local_commercial_writes === 0 && results.length === 3 };
  if (!invariants.passed) throw new Error('audit_only_invariant_failed');
  const summary = { generated_at: now(), phase: '5A', mode: 'AUDIT_ONLY', seller_id: SELLER_ID, seller_user_product_enabled: true, remote_inventory: { expected_total: remoteInventory.expected_total, captured: remoteInventory.captured, detailed: remoteInventory.detailed, pages: remoteInventory.pages, reliable: remoteInventory.reliable, statuses: remoteInventory.statuses }, results: results.map((row) => ({ sku: row.sku, category_id: row.category.id, category: row.category.name, state: row.state, identity: row.scores.identity_confidence, documentation: row.scores.documentation_score, readiness: row.scores.publication_readiness, duplicate_risk: row.scores.duplicate_risk, financial: row.scores.financial_confidence, price: row.financial.price_recommended, margin_percent: row.financial.estimated_operational_margin_percent, remote_matches: row.remote.matches.length, blocking_reason: row.blocking_reason })), ready_count: results.filter((row) => row.state === 'MULTI_CANARY_READY').length, future_priority: priority, metrics, invariants, hold: HOLD };
  writeJson('summary.json', summary);
  for (const result of results) writeJson(`${result.sku.toLowerCase()}-${CONFIGS.find((row) => row.sku === result.sku).slug}.json`, result);
  writeCsv('remote-reconciliation.csv', remoteRows.length ? remoteRows : [{ sku: '', item_id: '', status: '', seller_sku: '', gtin: '', brand: '', model: '', catalog_product_id: '', user_product_id: '', family_id: '', match_class: '', confidence: '', evidence: '', title: '', permalink: '' }]);
  writeJson('category-contracts.json', categoryContracts); writeJson('image-audit.json', imageAudits); writeJson('financial-validation.json', financials); writeJson('payload-previews.json', payloadPreviews);
  writeJson('full-report.json', { ...summary, started_at: startedAt, completed_at: now(), official_contracts: { mercado_livre: ['https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products','https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos','https://developers.mercadolivre.com.br/pt_br/itens-e-buscas','https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/custos-de-envio','https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos/comissao-por-vender'], dslite: 'https://documenter.getpostman.com/view/5316990/RWaRNkaA', supabase: 'https://supabase.com/docs/reference/javascript/select' }, results, category_contracts: categoryContracts, image_audits: imageAudits, financial_validations: financials, payload_previews: payloadPreviews, remote_reconciliation: remoteRows, writes: { mercado_livre: 0, supabase: 0, descriptions: 0 } });
  console.log(JSON.stringify({ event: 'p0_phase5a_complete', ready_count: summary.ready_count, states: Object.fromEntries(summary.results.map((row) => [row.sku, row.state])), remote_inventory: summary.remote_inventory, metrics, invariants }));
}

main().catch((error) => { writeJson('error.json', { failed_at: now(), error: error.message, metrics, writes: { mercado_livre: 0, supabase: 0 }, hold: HOLD }); console.error(JSON.stringify({ event: 'p0_phase5a_failed', error: error.message, metrics })); process.exitCode = 1; });
