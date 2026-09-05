if (require.main === module) throw new Error('M2M: execução legada aposentada. Usar Radar e simulação/aprovação canônica; histórico preservado.');
/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  checkpointClassification,
  evaluateEligibility,
  groupWriteTargets,
  priceBand,
  priceForMargin,
  resolvePreferredOffer,
  round,
  unitEconomics,
} = require('./lib/ml-pricing-experiment');

dotenv.config({ path: '.env.local', quiet: true });

const ROOT = process.cwd();
const EXPERIMENT_ID = 'PRICING_EXPERIMENT_HIGH_MARGIN_ZERO_TRAFFIC_2026_09';
const CONFIG_KEY = 'pricing_experiment_high_margin_zero_traffic_2026_09';
const SOURCE_DIR = path.join(ROOT, 'reports', 'auditoria-saneamento-margem-2026-09-04-final-v1');
const SOURCE_CSV = path.join(SOURCE_DIR, '05_MARGEM_PREMIUM_PRESERVADA.csv');
const TAX_RATE = 0.082799;
const MAX_SOURCE_GROUPS = 430;
const FRESHNESS_MINUTES = 30;
const TRANSIENT = new Set([408, 409, 424, 425, 429, 500, 502, 503, 504]);
const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const DRY_RUN = process.argv.includes('--dry-run') || !APPLY;
const CONFIRM = String(process.argv.find((arg) => arg.startsWith('--confirm=')) || '').slice('--confirm='.length);
const OUTPUT_NAME = APPLY
  ? (RESUME ? 'experimento-pricing-alta-margem-2026-09-04-d0-final' : 'experimento-pricing-alta-margem-2026-09-04-d0')
  : 'experimento-pricing-alta-margem-2026-09-04-d0-dry';
const OUTPUT_DIR = path.join(ROOT, 'reports', OUTPUT_NAME);
const counters = { ml_get: 0, ml_put: 0, dslite_get: 0, db_select: 0, db_update: 0, db_insert: 0, db_upsert: 0 };

function chunks(rows, size) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

async function mapLimit(rows, limit, mapper) {
  const output = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return output;
}

function nowIso() { return new Date().toISOString(); }
function isoDay(value = new Date()) { return new Date(value).toISOString().slice(0, 10); }
function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function safeError(value) {
  const raw = String(value?.message || value?.error || value || 'erro desconhecido');
  return raw.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]').slice(0, 1000);
}
function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function csvCell(value) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function writeCsv(name, rows, headers) {
  const content = [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, name), `${content}\n`);
}
function writeJson(name, value) { fs.writeFileSync(path.join(OUTPUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`); }
function readCsv(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
}
function elapsedMinutes(timestamp) { return (Date.now() - new Date(timestamp || 0).getTime()) / 60000; }
function parseItemIds(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { return []; }
}
function itemSku(item) {
  const direct = item?.seller_custom_field || item?.seller_sku;
  if (direct) return String(direct).trim().toUpperCase();
  const variation = Array.isArray(item?.variations) && item.variations.length === 1 ? item.variations[0] : null;
  return String(variation?.seller_custom_field || variation?.seller_sku || '').trim().toUpperCase();
}

function loadSource() {
  if (!fs.existsSync(SOURCE_CSV)) throw new Error(`Coorte de origem ausente: ${SOURCE_CSV}`);
  const workbook = XLSX.readFile(SOURCE_CSV, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length !== MAX_SOURCE_GROUPS) throw new Error(`Coorte incompatível: ${rows.length}/430 pricing groups`);
  const unique = new Set(rows.map((row) => String(row.pricing_group_id)));
  if (unique.size !== MAX_SOURCE_GROUPS) throw new Error(`Coorte contém grupos duplicados: ${unique.size}/430`);
  return rows.map((row) => ({
    ...row,
    sku: String(row.sku || '').trim().toUpperCase(),
    pricing_group_id: String(row.pricing_group_id || '').trim(),
    source_ml_item_ids: parseItemIds(row.ml_item_ids),
  }));
}

function loadPriorExecution() {
  if (!RESUME) return { cohort: [], successes: [] };
  const directory = path.join(ROOT, 'reports', 'experimento-pricing-alta-margem-2026-09-04-d0');
  const cohortPath = path.join(directory, '01_COORTE_EXPERIMENTAL.csv');
  const successPath = path.join(directory, '02_EXECUCOES_SUCESSO.csv');
  if (!fs.existsSync(cohortPath) || !fs.existsSync(successPath)) {
    throw new Error('Artefatos da execução parcial não foram encontrados para retomada');
  }
  return { cohort: readCsv(cohortPath), successes: readCsv(successPath) };
}

async function getMlIntegration(db) {
  counters.db_select += 1;
  const { data, error } = await db.from('integracoes')
    .select('id,access_token,refresh_token,token_expires_at,client_id,client_secret')
    .eq('tipo', 'mercadolivre').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data?.access_token) throw new Error(error?.message || 'Integração Mercado Livre indisponível');
  let integration = data;
  if (new Date(data.token_expires_at || 0).getTime() <= Date.now() + 30 * 60 * 1000) {
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: data.client_id || '', client_secret: data.client_secret || '', refresh_token: data.refresh_token || '',
      }), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new Error(`Falha ao renovar token ML: HTTP ${response.status}`);
    await assertAllowedMercadoLivreToken(payload.access_token, 'pricing-experiment-token-refresh');
    counters.db_update += 1;
    const { error: updateError } = await db.from('integracoes').update({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || data.refresh_token,
      token_expires_at: new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString(),
      updated_at: nowIso(),
    }).eq('id', data.id);
    if (updateError) throw new Error(`Token renovado, mas não persistido: ${updateError.message}`);
    integration = { ...data, access_token: payload.access_token };
  } else {
    await assertAllowedMercadoLivreToken(data.access_token, 'pricing-experiment');
  }
  return integration;
}

function createMl(accessToken) {
  return async function ml(pathname, options = {}, readAttempt = 1) {
    const method = String(options.method || 'GET').toUpperCase();
    if (method === 'GET') counters.ml_get += 1;
    if (method === 'PUT') counters.ml_put += 1;
    try {
      const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(45000), cache: 'no-store',
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (method === 'GET' && TRANSIENT.has(response.status) && readAttempt < 3) return ml(pathname, options, readAttempt + 1);
      return { ok: response.ok, status: response.status, data, error: response.ok ? null : safeError(data || `HTTP ${response.status}`), observed_at: nowIso() };
    } catch (error) {
      if (method === 'GET' && readAttempt < 3) return ml(pathname, options, readAttempt + 1);
      return { ok: false, status: 0, data: null, error: safeError(error), observed_at: nowIso() };
    }
  };
}

async function loadDslitePriceStock(db, offers) {
  counters.db_select += 1;
  const { data: integration, error } = await db.from('integracoes')
    .select('url,access_token').eq('tipo', 'dslite').eq('conectado', true)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !integration?.url || !integration?.access_token) {
    throw new Error(error?.message || 'Integração DSLite indisponível');
  }
  const baseUrl = String(integration.url).replace(/\/+$/, '');
  const supplierIds = [...new Set(offers.map((offer) => String(offer.dslite_fornecedor_id || '')).filter(Boolean))];
  const output = new Map();
  for (const supplierId of supplierIds) {
    for (let page = 1; ; page += 1) {
      counters.dslite_get += 1;
      const response = await fetch(`${baseUrl}/v1/CrossDocking/PrecoEstoque/${encodeURIComponent(supplierId)}?page=${page}&limit=100`, {
        headers: { Token: integration.access_token, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000), cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`DSLite preço/estoque ${supplierId}: HTTP ${response.status}`);
      const rows = payload?.produtos || [];
      for (const row of rows) output.set(`${supplierId}:${String(row.produtoid || '')}`, row);
      const detail = payload?.detalhesConsulta || {};
      const returned = Number(detail.registrosRetornados ?? rows.length);
      const total = Number(detail.totalRegistros ?? 0);
      const offset = Number(detail.offset ?? (page - 1) * returned);
      if (!rows.length || !returned || offset + returned >= total) break;
    }
  }
  return output;
}

function dsliteCost(row) {
  const value = Number(row?.preco_crossdocking || row?.preco_normal || 0);
  return value > 0 ? round(value) : null;
}

function priceInfo(payload, item) {
  const prices = Array.isArray(payload?.prices) ? payload.prices : [];
  const perQuantity = Array.isArray(payload?.price_per_quantity) ? payload.price_per_quantity : [];
  const marketplace = prices.filter((row) => {
    const contexts = row?.conditions?.context_restrictions || [];
    return row?.eligible !== false && (!contexts.length || contexts.includes('channel_marketplace'));
  });
  const standard = marketplace.find((row) => String(row?.type || '').toLowerCase() === 'standard'
    && Number(row?.conditions?.min_purchase_unit || 1) === 1);
  return {
    amount: numberOrNull(standard?.amount) || numberOrNull(item?.price),
    hasPromotion: marketplace.some((row) => String(row?.type || '').toLowerCase() === 'promotion'),
    hasQuantityPricing: perQuantity.length > 0 || marketplace.some((row) => Number(row?.conditions?.min_purchase_unit || 1) > 1),
  };
}

function flattenFeeRows(payload) {
  const rows = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if ('sale_fee_amount' in value || 'sale_fee_details' in value) rows.push(value);
      else Object.values(value).forEach(visit);
    }
  };
  visit(payload);
  return rows;
}

function extractFee(payload, listingType, price) {
  const rows = flattenFeeRows(payload);
  const row = rows.find((candidate) => String(candidate.listing_type_id || '') === String(listingType || '')) || rows[0];
  if (!row) return null;
  const amount = numberOrNull(row.sale_fee_amount);
  const percentage = numberOrNull(row?.sale_fee_details?.percentage_fee ?? row?.sale_fee_details?.meli_percentage_fee);
  const fixed = numberOrNull(row?.sale_fee_details?.fixed_fee) || 0;
  const rate = percentage !== null ? percentage / 100 : amount !== null ? Math.max(0, (amount - fixed) / Number(price)) : null;
  return amount === null || rate === null ? null : { amount: round(amount), rate, fixed: round(fixed) };
}

function extractShipping(payload) {
  const amount = numberOrNull(payload?.coverage?.all_country?.list_cost);
  return amount !== null && amount >= 0 ? round(amount) : null;
}

function feePath(item, price) {
  const query = new URLSearchParams({
    price: String(price), category_id: String(item.category_id || ''), currency_id: String(item.currency_id || 'BRL'),
    listing_type_id: String(item.listing_type_id || ''), logistic_type: String(item.shipping?.logistic_type || 'not_specified'),
    shipping_mode: String(item.shipping?.mode || 'not_specified'),
  });
  return `/sites/MLB/listing_prices?${query}`;
}

function shippingPath(item, price, sellerId) {
  const query = new URLSearchParams({
    item_id: String(item.id), item_price: String(price), listing_type_id: String(item.listing_type_id || ''),
    mode: String(item.shipping?.mode || 'me2'), condition: String(item.condition || 'new'),
    logistic_type: String(item.shipping?.logistic_type || 'drop_off'), free_shipping: String(item.shipping?.free_shipping === true), verbose: 'true',
  });
  return `/users/${encodeURIComponent(String(item.seller_id || sellerId))}/shipping_options/free?${query}`;
}

async function pricingAt(ml, item, price, sellerId) {
  const [feeResponse, shippingResponse] = await Promise.all([
    ml(feePath(item, price)), ml(shippingPath(item, price, sellerId)),
  ]);
  const fee = feeResponse.ok ? extractFee(feeResponse.data, item.listing_type_id, price) : null;
  const shipping = shippingResponse.ok ? extractShipping(shippingResponse.data) : null;
  return { ok: Boolean(fee && shipping !== null), fee, shipping, feeResponse, shippingResponse };
}

async function solveGroupTarget(ml, items, currentPrice, cost, sellerId) {
  let candidate = currentPrice;
  let band = priceBand(currentPrice);
  if (!band) return { ok: false, reason: 'PRECO_ATUAL_INVALIDO' };
  let finalPricing = [];
  for (let iteration = 1; iteration <= 5; iteration += 1) {
    const pricing = await Promise.all(items.map((item) => pricingAt(ml, item, candidate, sellerId)));
    if (pricing.some((row) => !row.ok)) return { ok: false, reason: 'TARIFA_OU_FRETE_INDISPONIVEL' };
    const required = pricing.map((row) => priceForMargin({
      cost, shippingAmount: row.shipping, feeRate: row.fee.rate, fixedFee: row.fee.fixed,
      taxRate: TAX_RATE, marginRate: band.target,
    }));
    if (required.some((value) => !value)) return { ok: false, reason: 'CALCULO_ALVO_INVALIDO' };
    const next = Math.max(...required);
    const nextBand = priceBand(next);
    if (!nextBand) return { ok: false, reason: 'FAIXA_FINAL_INVALIDA' };
    finalPricing = pricing;
    if (Math.abs(next - candidate) < 0.005 && nextBand.id === band.id) {
      const economics = finalPricing.map((row) => unitEconomics({
        price: next, cost, feeRate: row.fee.rate, fixedFee: row.fee.fixed, shippingAmount: row.shipping, taxRate: TAX_RATE,
      }));
      return { ok: true, price: round(next), band, economics, pricing: finalPricing, iterations: iteration };
    }
    candidate = next;
    band = nextBand;
  }
  return { ok: false, reason: 'FAIXA_NAO_ESTABILIZADA' };
}

function visitTotal(payload) {
  if (Array.isArray(payload?.results)) return payload.results.reduce((sum, row) => sum + Number(row.total || row.visits || 0), 0);
  return Number(payload?.total || 0);
}

function visitWindows(payload, asOf) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const end = new Date(`${isoDay(asOf)}T23:59:59.999Z`).getTime();
  const output = {};
  for (const days of [30, 90, 150]) {
    const start = end - days * 86400000;
    output[days] = results.reduce((sum, row) => {
      const date = new Date(row.date || row.date_from || 0).getTime();
      return date > start && date <= end ? sum + Number(row.total || row.visits || 0) : sum;
    }, 0);
  }
  if (!results.length && numberOrNull(payload?.total) !== null) output[150] = Number(payload.total);
  return output;
}

async function loadAutomationItems(ml, sellerId) {
  const output = new Set();
  for (let offset = 0; ; offset += 100) {
    const response = await ml(`/pricing-automation/users/${encodeURIComponent(sellerId)}/items?offset=${offset}&limit=100`);
    if (!response.ok) throw new Error(`Falha ao consultar automatizações de preço ML: ${response.error}`);
    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    items.forEach((item) => output.add(String(item?.item_id || item?.id || item)));
    const total = Number(response.data?.paging?.total || items.length);
    if (offset + items.length >= total || items.length === 0) break;
  }
  return output;
}

async function loadOrders(ml, sellerId, asOf) {
  const orders = [];
  for (let offset = 0; ; offset += 50) {
    const query = new URLSearchParams({
      seller: sellerId,
      'order.date_created.from': new Date(asOf.getTime() - 150 * 86400000).toISOString(),
      'order.date_created.to': asOf.toISOString(), sort: 'date_asc', offset: String(offset), limit: '50',
    });
    const response = await ml(`/orders/search?${query}`);
    if (!response.ok) throw new Error(`Falha ao consultar vendas ML: ${response.error}`);
    const rows = response.data?.results || [];
    orders.push(...rows);
    if (offset + rows.length >= Number(response.data?.paging?.total || 0) || rows.length === 0) break;
  }
  return orders;
}

function orderMetrics(orders, itemIds, asOf) {
  const accepted = new Set(itemIds);
  const end = asOf.getTime();
  const result = {};
  for (const days of [30, 90, 150]) {
    const ids = new Set();
    for (const order of orders) {
      if (!['paid', 'partially_refunded'].includes(String(order.status || ''))) continue;
      const created = new Date(order.date_created || 0).getTime();
      if (created < end - days * 86400000 || created > end) continue;
      if ((order.order_items || []).some((row) => accepted.has(String(row?.item?.id || '')))) ids.add(String(order.id));
    }
    result[days] = ids.size;
  }
  return result;
}

async function fetchItems(ml, itemIds) {
  const map = new Map();
  for (const page of chunks([...new Set(itemIds)], 20)) {
    const response = await ml(`/items?ids=${encodeURIComponent(page.join(','))}`);
    if (!response.ok || !Array.isArray(response.data)) continue;
    response.data.forEach((wrapper) => { if (wrapper?.body?.id) map.set(String(wrapper.body.id), wrapper.body); });
  }
  return map;
}

async function preflightGroup({ source, product, offers, dslitePriceStock, ads, itemsById, automationItems, orders, ml, sellerId, asOf }) {
  const result = {
    pricing_group_id: source.pricing_group_id, sku: source.sku, product_id: product?.id || null,
    product_name: product?.nome || source.product_name || '', title: '', ml_item_ids: source.source_ml_item_ids,
    catalog_synchronized_pair: String(source.catalog_synchronized_pair) === 'true',
    status: 'EXCLUIDO_TRAVA', exclusion_reasons: [], evidence: {},
  };
  if (!product) {
    result.exclusion_reasons = ['EXCLUIDO_PRODUTO_NAO_ENCONTRADO'];
    return result;
  }
  const groupAds = ads.filter((ad) => String(ad.produto_id) === String(product.id)
    && source.source_ml_item_ids.includes(String(ad.ml_item_id)));
  const itemIds = [...new Set(groupAds.map((ad) => String(ad.ml_item_id)))];
  const items = itemIds.map((id) => itemsById.get(id)).filter(Boolean);
  result.ml_item_ids = itemIds;
  result.title = items[0]?.title || product.nome || '';
  if (!itemIds.length || items.length !== itemIds.length || itemIds.length !== source.source_ml_item_ids.length) {
    result.exclusion_reasons = ['EXCLUIDO_VINCULO_INCONCLUSIVO'];
    return result;
  }
  if (items.some((item) => itemSku(item) && itemSku(item) !== source.sku)) {
    result.exclusion_reasons = ['EXCLUIDO_IDENTIDADE_SKU'];
    return result;
  }
  if (items.some((item) => item.status !== 'active')) {
    result.exclusion_reasons = ['EXCLUIDO_ANUNCIO_NAO_ATIVO'];
    return result;
  }
  const currentOffers = offers.map((offer) => {
    const live = dslitePriceStock.get(`${String(offer.dslite_fornecedor_id || '')}:${String(offer.dslite_produto_id || '')}`);
    return live ? { ...offer, custo: dsliteCost(live) ?? offer.custo, estoque: Number(live.estoque ?? offer.estoque), direct_current: true } : offer;
  });
  const resolution = resolvePreferredOffer(product, currentOffers);
  const offer = resolution.offer;
  const offerFresh = offer?.direct_current === true
    || Boolean(offer?.last_sync_at && elapsedMinutes(offer.last_sync_at) <= FRESHNESS_MINUTES);
  const cost = numberOrNull(offer?.custo);
  const stock = Math.min(Number(offer?.estoque || 0), Math.max(...items.map((item) => Number(item.available_quantity || 0))));
  const prices = await Promise.all(items.map((item) => ml(`/items/${encodeURIComponent(item.id)}/prices`)));
  const priceDetails = prices.map((response, index) => response.ok ? priceInfo(response.data, items[index]) : null);
  const salePrices = await Promise.all(items.map((item) => ml(`/items/${encodeURIComponent(item.id)}/sale_price?context=channel_marketplace`)));
  const visitResponses = await Promise.all(items.map((item) => (
    ml(`/items/${encodeURIComponent(item.id)}/visits/time_window?last=150&unit=day&ending=${isoDay(asOf)}`)
  )));
  const windowsByItem = visitResponses.map((response) => response.ok ? visitWindows(response.data, asOf) : null);
  const visits = Object.fromEntries([30, 90, 150].map((days) => [days,
    windowsByItem.every(Boolean)
      ? windowsByItem.reduce((sum, windows) => sum + Number(windows?.[days] || 0), 0) : null,
  ]));
  const sales = orderMetrics(orders, itemIds, asOf);
  const amounts = priceDetails.map((detail) => detail?.amount).filter((value) => value !== null);
  const samePrice = amounts.length === items.length && Math.max(...amounts) - Math.min(...amounts) < 0.01;
  const currentPrice = samePrice ? round(amounts[0]) : null;
  let syncConfirmed = itemIds.length === 1;
  let syncEvidence = null;
  if (itemIds.length > 1) {
    const response = await ml(`/public/buybox/sync/${encodeURIComponent(itemIds[0])}`);
    const relations = (response.data?.relations || []).map((row) => String(row?.item_id || row?.id || row));
    syncConfirmed = response.ok && String(response.data?.status || '').toUpperCase() === 'SYNC'
      && itemIds.every((id) => id === itemIds[0] || relations.includes(id));
    syncEvidence = { status: response.status, sync_status: response.data?.status || null, relations };
  }
  const currentPricing = currentPrice ? await Promise.all(items.map((item) => pricingAt(ml, item, currentPrice, sellerId))) : [];
  const currentEconomics = currentPricing.map((row) => row.ok && cost !== null ? unitEconomics({
    price: currentPrice, cost, feeRate: row.fee.rate, fixedFee: row.fee.fixed, shippingAmount: row.shipping, taxRate: TAX_RATE,
  }) : null);
  const currentWorst = currentEconomics.filter(Boolean).sort((a, b) => a.marginPct - b.marginPct)[0] || null;
  const marginClass = currentWorst && priceBand(currentPrice) && currentWorst.marginPct / 100 > priceBand(currentPrice).limit
    ? 'MARGEM_SUPERIOR_AO_LIMITE_DE_BUSCA' : 'MARGEM_FORA_DA_COORTE_ATUAL';
  const target = currentPrice && cost !== null ? await solveGroupTarget(ml, items, currentPrice, cost, sellerId) : { ok: false, reason: 'DADOS_FINANCEIROS_AUSENTES' };
  const experimentalWorstIndex = target.ok
    ? target.economics.reduce((worst, value, index, rows) => (
        value && (!rows[worst] || value.marginPct < rows[worst].marginPct) ? index : worst
      ), 0)
    : -1;
  const experimentalWorst = target.ok ? target.economics[experimentalWorstIndex] : null;
  const hasPromotion = priceDetails.some((detail) => detail?.hasPromotion)
    || salePrices.some((response) => response.ok && numberOrNull(response.data?.regular_amount) > numberOrNull(response.data?.amount));
  const hasQuantityPricing = priceDetails.some((detail) => detail?.hasQuantityPricing);
  const origin = itemIds.includes(String(product.ml_item_id || ''))
    ? String(product.ml_item_id)
    : String((items.find((item) => item.catalog_listing !== true) || items[0]).id);
  const outbox = await (() => {
    counters.db_select += 1;
    return global.__experimentDb.from('anuncios_ml_outbox').select('id,status,payload,desired_price,desired_quantity,desired_status,source')
      .in('ml_item_id', itemIds).in('status', ['pending', 'retry', 'processing']);
  })();
  const outboxProcessing = (outbox.data || []).some((row) => row.status === 'processing'
    && (row.desired_price !== null || row.payload?.apply_price === true || row.payload?.apply_quantity_pricing === true));
  const currentData = Boolean(cost !== null && cost > 0 && offerFresh && syncConfirmed && samePrice
    && prices.every((row) => row.ok) && salePrices.every((row) => row.ok)
    && Object.values(visits).every((value) => value !== null)
    && currentPricing.every((row) => row.ok) && target.ok && experimentalWorst);
  const eligibility = evaluateEligibility({
    sku: source.sku, currentMarginClassification: marginClass,
    visits150: visits[150], orders150: sales[150], productActive: product.ativo !== false,
    active: items.every((item) => item.status === 'active'), stock,
    currentData, hasPromotion, hasQuantityPricing,
    hasMlPriceAutomation: itemIds.some((id) => automationItems.has(id)), outboxProcessing,
    experimentalPrice: target.price, currentPrice, experimentalResult: experimentalWorst?.result,
  });
  Object.assign(result, {
    status: eligibility.eligible ? 'ELEGIVEL' : 'EXCLUIDO_TRAVA', exclusion_reasons: eligibility.reasons,
    supplier: offer?.fornecedor_nome || null, supplier_offer_id: offer?.id || null, supplier_cost: cost,
    supplier_offer_last_sync_at: offer?.last_sync_at || null, stock,
    current_price: currentPrice, current_margin_pct: currentWorst?.marginPct ?? null, current_profit: currentWorst?.result ?? null,
    experimental_price: target.price || null, target_margin_pct: target.ok ? target.band.target * 100 : null,
    experimental_margin_pct: experimentalWorst?.marginPct ?? null, experimental_profit: experimentalWorst?.result ?? null,
    price_band: target.ok ? target.band.id : null, fee_amount: target.ok ? target.pricing[experimentalWorstIndex].fee.amount : null,
    fee_rate: target.ok ? target.pricing[experimentalWorstIndex].fee.rate : null, fixed_fee: target.ok ? target.pricing[experimentalWorstIndex].fee.fixed : null,
    shipping_amount: target.ok ? target.pricing[experimentalWorstIndex].shipping : null, tax_rate: TAX_RATE,
    visits_30d: visits[30], visits_90d: visits[90], visits_150d: visits[150],
    sales_30d: sales[30], sales_90d: sales[90], sales_150d: sales[150],
    has_promotion: hasPromotion, has_quantity_pricing: hasQuantityPricing,
    has_ml_price_automation: itemIds.some((id) => automationItems.has(id)), sync_confirmed: syncConfirmed,
    origin_ml_item_id: origin, price_to_win: numberOrNull(source.price_to_win),
    evidence: { prices: prices.map((row) => row.status), sale_prices: salePrices.map((row) => row.status), visits: visitResponses.map((row) => row.status), sync: syncEvidence, offer_source: resolution.source, target_error: target.ok ? null : target.reason },
    pending_outbox_rows: outbox.data || [],
  });
  return result;
}

function runtimeState(groups, startedAt) {
  return {
    version: 1, experiment_id: EXPERIMENT_ID, status: 'executing', started_at: startedAt,
    monitoring_until: new Date(new Date(startedAt).getTime() + 30 * 86400000).toISOString(),
    traffic_threshold_150d: 5, tax_rate: TAX_RATE,
    groups: groups.map((row) => ({
      pricing_group_id: row.pricing_group_id, sku: row.sku, product_id: row.product_id,
      ml_item_ids: row.ml_item_ids, origin_ml_item_id: row.origin_ml_item_id, title: row.title,
      status: 'active', started_at: startedAt, baseline_price: row.current_price,
      baseline_margin_pct: row.current_margin_pct, experimental_price: row.experimental_price,
      target_margin_pct: row.target_margin_pct, cost: row.supplier_cost,
      fee_amount: row.fee_amount, shipping_amount: row.shipping_amount, tax_rate: TAX_RATE,
      baseline_visits: { 30: row.visits_30d, 90: row.visits_90d, 150: row.visits_150d },
      baseline_sales: { 30: row.sales_30d, 90: row.sales_90d, 150: row.sales_150d }, checkpoints: {},
    })), updated_at: nowIso(),
  };
}

async function saveState(db, state) {
  counters.db_upsert += 1;
  const { error } = await db.from('sync_runtime_config').upsert({ key: CONFIG_KEY, value: JSON.stringify(state), updated_at: nowIso() }, { onConflict: 'key' });
  if (error) throw new Error(`Falha ao persistir proteção da coorte: ${error.message}`);
}

async function neutralizePendingPriceOutboxes(db, groups) {
  const itemIds = [...new Set(groups.flatMap((row) => row.ml_item_ids))];
  for (const page of chunks(itemIds, 100)) {
    counters.db_select += 1;
    const { data, error } = await db.from('anuncios_ml_outbox')
      .select('id,status,payload,desired_price,desired_quantity,desired_status').in('ml_item_id', page).in('status', ['pending', 'retry', 'processing']);
    if (error) throw new Error(`Falha ao reler outbox: ${error.message}`);
    if ((data || []).some((row) => row.status === 'processing'
      && (row.desired_price !== null || row.payload?.apply_price === true || row.payload?.apply_quantity_pricing === true))) {
      throw new Error('Outbox de preço entrou em processamento após a validação; execução interrompida');
    }
    for (const row of data || []) {
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      if (!(row.desired_price !== null || payload.apply_price === true || payload.apply_quantity_pricing === true)) continue;
      const preservesOtherOperation = payload.apply_quantity === true || payload.apply_status === true
        || row.desired_quantity !== null || row.desired_status !== null;
      counters.db_update += 1;
      const patch = preservesOtherOperation ? {
        desired_price: null,
        payload: { ...payload, apply_price: false, apply_quantity_pricing: false, experiment_price_removed_at: nowIso() },
        updated_at: nowIso(),
      } : {
        status: 'cancelled', desired_price: null,
        payload: { ...payload, apply_price: false, apply_quantity_pricing: false, experiment_price_cancelled_at: nowIso() },
        processed_at: nowIso(), updated_at: nowIso(), last_error: 'Preço cancelado para preservar coorte experimental',
      };
      const { error: updateError } = await db.from('anuncios_ml_outbox').update(patch).eq('id', row.id).in('status', ['pending', 'retry']);
      if (updateError) throw new Error(`Falha ao neutralizar outbox ${row.id}: ${updateError.message}`);
    }
  }
}

async function readStandardPrices(ml, itemIds) {
  const map = new Map();
  const responses = await Promise.all(itemIds.map(async (id) => {
    const response = await ml(`/items/${encodeURIComponent(id)}/prices`);
    const info = response.ok ? priceInfo(response.data, {}) : null;
    return { id, response, price: info?.amount || null };
  }));
  responses.forEach((row) => map.set(row.id, row));
  return map;
}

async function verifyPrices(ml, group, expected) {
  const stableReadsRequired = group.ml_item_ids.length > 1 ? 2 : 1;
  const delays = group.ml_item_ids.length > 1 ? [0, 2000, 5000, 10000] : [0, 1500, 3000];
  let latest = null;
  let stableReads = 0;
  for (const delayMs of delays) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await readStandardPrices(ml, group.ml_item_ids);
    if (group.ml_item_ids.every((id) => latest.get(id)?.response.ok && Math.abs(Number(latest.get(id)?.price) - expected) < 0.01)) {
      stableReads += 1;
      if (stableReads >= stableReadsRequired) {
        return { ok: true, observed: Object.fromEntries(group.ml_item_ids.map((id) => [id, latest.get(id)?.price])) };
      }
    } else stableReads = 0;
  }
  return { ok: false, observed: Object.fromEntries(group.ml_item_ids.map((id) => [id, latest?.get(id)?.price || null])) };
}

async function putPrice(ml, itemId, price) {
  return ml(`/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price }),
  });
}

async function putGroupPrice(ml, group, price) {
  const writes = [];
  for (const itemId of groupWriteTargets(group.origin_ml_item_id, group.ml_item_ids)) {
    const response = await putPrice(ml, itemId, price);
    writes.push({ item_id: itemId, ok: response.ok, status: response.status, error: response.error, warnings: response.data?.warnings || [] });
    if (!response.ok) break;
  }
  return writes;
}

async function executeGroup(db, ml, group) {
  const writes = await putGroupPrice(ml, group, group.experimental_price);
  const writeOk = writes.length === groupWriteTargets(group.origin_ml_item_id, group.ml_item_ids).length
    && writes.every((row) => row.ok);
  const warnings = writes.flatMap((row) => Array.isArray(row.warnings) ? row.warnings : []);
  const verified = await verifyPrices(ml, group, group.experimental_price);
  if (!writeOk || !verified.ok) {
    let baseline = await verifyPrices(ml, group, group.current_price);
    if (!baseline.ok) {
      const rollbackWrites = await putGroupPrice(ml, group, group.current_price);
      baseline = await verifyPrices(ml, group, group.current_price);
      if (rollbackWrites.some((row) => !row.ok)) baseline.ok = false;
    }
    return {
      ok: false, fatal: !baseline.ok,
      error: writes.find((row) => !row.ok)?.error || 'Confirmação pós-escrita falhou',
      write_status: Object.fromEntries(writes.map((row) => [row.item_id, row.status])),
      observed: verified.observed, rollback_confirmed: baseline.ok,
    };
  }
  counters.db_update += 2;
  const [productUpdate, adUpdate] = await Promise.all([
    db.from('produtos').update({ custom_price: group.experimental_price, updated_at: nowIso() }).eq('id', group.product_id),
    db.from('anuncios_ml').update({ preco_ml: group.experimental_price, updated_at: nowIso() }).in('ml_item_id', group.ml_item_ids),
  ]);
  if (productUpdate.error || adUpdate.error) {
    const rollbackWrites = await putGroupPrice(ml, group, group.current_price);
    const rollback = await verifyPrices(ml, group, group.current_price);
    counters.db_update += 2;
    const [productRollback, adRollback] = await Promise.all([
      db.from('produtos').update({ custom_price: group.current_price, updated_at: nowIso() }).eq('id', group.product_id),
      db.from('anuncios_ml').update({ preco_ml: group.current_price, updated_at: nowIso() }).in('ml_item_id', group.ml_item_ids),
    ]);
    const rollbackOk = rollbackWrites.every((row) => row.ok) && rollback.ok && !productRollback.error && !adRollback.error;
    return { ok: false, fatal: !rollbackOk, error: `Persistência local falhou; rollback ${rollbackOk ? 'confirmado' : 'não confirmado'}`, observed: rollback.observed };
  }
  return {
    ok: true, write_status: Object.fromEntries(writes.map((row) => [row.item_id, row.status])),
    observed: verified.observed, confirmed_at: nowIso(), warnings,
  };
}

function reportFiles({ sourceRows, preflight, successes, failures, priorExecution, startedAt, finishedAt }) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: false });
  const priorIds = new Set(priorExecution.cohort.map((row) => String(row.pricing_group_id)));
  const excluded = preflight.filter((row) => row.status !== 'ELEGIVEL' && !priorIds.has(row.pricing_group_id));
  const successIds = new Set(successes.map((row) => row.pricing_group_id));
  const currentCohort = APPLY
    ? preflight.filter((row) => successIds.has(row.pricing_group_id))
    : preflight.filter((row) => row.status === 'ELEGIVEL');
  const cohort = [...priorExecution.cohort, ...currentCohort];
  const allSuccesses = [...priorExecution.successes, ...successes];
  const financialRows = [...priorExecution.cohort, ...preflight.filter((row) => row.current_price && !priorIds.has(row.pricing_group_id))];
  const avg = (rows, field) => rows.length ? round(rows.reduce((sum, row) => sum + Number(row[field] || 0), 0) / rows.length, 4) : 0;
  fs.writeFileSync(path.join(OUTPUT_DIR, '00_RESUMO_EXECUTIVO.md'), `# Resumo executivo — experimento de pricing D0\n\n| Métrica | Resultado |\n|---|---:|\n| Universo inicial | ${sourceRows.length} |\n| Elegíveis após travas | ${cohort.length} |\n| Alterados e confirmados | ${allSuccesses.length} |\n| Confirmados nesta execução | ${successes.length} |\n| Confirmados antes da retomada | ${priorExecution.successes.length} |\n| Excluídos | ${excluded.length} |\n| Falhas de execução pendentes | ${failures.length} |\n| Sem alteração necessária | ${excluded.filter((row) => row.exclusion_reasons?.includes('SEM_REDUCAO_NECESSARIA')).length} |\n| Redução média | R$ ${round(avg(cohort, 'current_price') - avg(cohort, 'experimental_price')).toFixed(2)} |\n| Margem média anterior | ${avg(cohort, 'current_margin_pct').toFixed(4)}% |\n| Margem média experimental | ${avg(cohort, 'experimental_margin_pct').toFixed(4)}% |\n\nModo: **${APPLY ? 'EXECUÇÃO AUTORIZADA' : 'DRY-RUN'}**. Nenhum grupo com promoção, preço por quantidade ou automatização nativa do Mercado Livre foi alterado.\n`);
  const cohortHeaders = ['sku','pricing_group_id','product_id','product_name','ml_item_ids','origin_ml_item_id','title','current_price','current_profit','current_margin_pct','experimental_price','experimental_profit','experimental_margin_pct','target_margin_pct','supplier_cost','fee_amount','shipping_amount','tax_rate','visits_30d','visits_90d','visits_150d','sales_30d','sales_90d','sales_150d','stock','price_to_win','catalog_synchronized_pair','sync_confirmed'];
  writeCsv('01_COORTE_EXPERIMENTAL.csv', cohort, cohortHeaders);
  writeCsv('02_EXECUCOES_SUCESSO.csv', allSuccesses, ['sku','pricing_group_id','origin_ml_item_id','ml_item_ids','previous_price','applied_price','http_status','confirmed_at','observed_prices','warnings']);
  writeCsv('03_EXCLUIDOS_TRAVAS.csv', excluded, ['sku','pricing_group_id','product_name','ml_item_ids','exclusion_reasons','current_price','current_margin_pct','visits_150d','sales_150d','has_promotion','has_quantity_pricing','has_ml_price_automation','evidence']);
  writeCsv('04_FALHAS_EXECUCAO.csv', failures, ['sku','pricing_group_id','error','fatal','write_status','observed','rollback_confirmed']);
  writeCsv('05_PARES_CATALOGO_SINCRONIZADOS.csv', cohort.filter((row) => row.catalog_synchronized_pair), ['sku','pricing_group_id','origin_ml_item_id','ml_item_ids','current_price','experimental_price','sync_confirmed']);
  writeCsv('06_MEMORIA_FINANCEIRA.csv', financialRows, ['sku','pricing_group_id','current_price','supplier_cost','fee_amount','shipping_amount','tax_rate','current_profit','current_margin_pct','experimental_price','experimental_profit','experimental_margin_pct','target_margin_pct','price_band']);
  fs.writeFileSync(path.join(OUTPUT_DIR, '07_PLANO_MONITORAMENTO_30D.md'), `# Plano de monitoramento\n\nA task \`sync_ml_pricing_experiment_monitor\` executará de forma idempotente:\n\n- D+7: segurança e \`OBSERVACAO_SEM_TRAFEGO\` para zero visitas.\n- D+15: leitura intermediária e \`ALERTA_AMARELO_SEM_TRAFEGO\`.\n- D+30: auditoria formal e classificação final.\n\nSe o resultado unitário ficar negativo, o grupo será pausado e receberá \`ALERTA_CRITICO_PREJUIZO_EXPERIMENTO\`. Após D+30, o bloqueio de preço permanecerá até decisão da Diretoria.\n\nInício de referência: ${startedAt}. D+7: ${new Date(new Date(startedAt).getTime() + 7 * 86400000).toISOString()}; D+15: ${new Date(new Date(startedAt).getTime() + 15 * 86400000).toISOString()}; D+30: ${new Date(new Date(startedAt).getTime() + 30 * 86400000).toISOString()}.\n`);
  const names = ['00_RESUMO_EXECUTIVO.md','01_COORTE_EXPERIMENTAL.csv','02_EXECUCOES_SUCESSO.csv','03_EXCLUIDOS_TRAVAS.csv','04_FALHAS_EXECUCAO.csv','05_PARES_CATALOGO_SINCRONIZADOS.csv','06_MEMORIA_FINANCEIRA.csv','07_PLANO_MONITORAMENTO_30D.md'];
  const manifest = {
    experiment_id: EXPERIMENT_ID, mode: APPLY ? 'APPLY' : 'DRY_RUN', started_at: startedAt, finished_at: finishedAt,
    parameters: { source_groups: 430, visits_150d_max: 5, recurring_sales_min_orders: 2, freshness_minutes: 30, tax_rate: TAX_RATE, tax_rate_source: 'conservative_estimate', quantity_pricing: 'excluded' },
    counts: { source: sourceRows.length, eligible: cohort.length, changed: allSuccesses.length, changed_this_run: successes.length, excluded: excluded.length, failures: failures.length },
    counters, safety: { automatic_price_protection: APPLY && successes.length > 0, no_schema_change: true, no_write_retry: true },
    official_sources: [
      'https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/atualiza-tuas-publicacoes',
      'https://developers.mercadolivre.com.br/pt_br/api-de-precos',
      'https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos',
      'https://supabase.com/docs/reference/javascript/upsert',
    ],
  };
  manifest.files = names.map((name) => ({ name, sha256: sha256(path.join(OUTPUT_DIR, name)), bytes: fs.statSync(path.join(OUTPUT_DIR, name)).size }));
  writeJson('manifest.json', manifest);
  execFileSync('zip', ['-q', '-r', `${OUTPUT_DIR}.zip`, path.basename(OUTPUT_DIR)], { cwd: path.dirname(OUTPUT_DIR) });
  return manifest;
}

async function main() {
  if (APPLY && CONFIRM !== EXPERIMENT_ID) throw new Error('Confirmação explícita da coorte ausente ou inválida');
  if (fs.existsSync(OUTPUT_DIR) || fs.existsSync(`${OUTPUT_DIR}.zip`)) throw new Error(`Saída já existe: ${OUTPUT_DIR}`);
  const startedAt = nowIso();
  const asOf = new Date();
  const sourceRows = loadSource();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) throw new Error('Supabase self-hosted não configurado em .env.local');
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  global.__experimentDb = db;
  let existingState = null;
  if (APPLY) {
    counters.db_select += 1;
    const { data, error } = await db.from('sync_runtime_config').select('value').eq('key', CONFIG_KEY).maybeSingle();
    if (error) throw new Error(`Falha ao verificar coorte existente: ${error.message}`);
    if (data?.value) existingState = JSON.parse(String(data.value));
    if (RESUME) {
      if (!existingState || existingState.experiment_id !== EXPERIMENT_ID || !['active', 'executing'].includes(existingState.status)) {
        throw new Error('Não existe coorte ativa compatível para retomada');
      }
    } else if (existingState?.status !== 'closed' && existingState) {
      throw new Error(`Já existe uma coorte ${existingState.status || 'inválida'}; execução recusada`);
    }
  }
  const priorExecution = loadPriorExecution();
  const integration = await getMlIntegration(db);
  const ml = createMl(integration.access_token);
  const me = await ml('/users/me?attributes=id,nickname');
  if (!me.ok || !me.data?.id) throw new Error(`Falha ao identificar seller ML: ${me.error}`);
  const sellerId = String(me.data.id);
  const automationItems = await loadAutomationItems(ml, sellerId);
  const orders = await loadOrders(ml, sellerId, asOf);

  const skus = sourceRows.map((row) => row.sku);
  const products = [];
  for (const page of chunks(skus, 100)) {
    counters.db_select += 1;
    const { data, error } = await db.from('produtos').select('id,sku,nome,custo,estoque,ativo,custom_price,ml_item_id,ml_status,oferta_preferencial_id,fornecedor_preferencial_manual,dslite_ultima_sync').in('sku', page);
    if (error) throw new Error(error.message);
    products.push(...(data || []));
  }
  const productBySku = new Map(products.map((row) => [String(row.sku).trim().toUpperCase(), row]));
  const productIds = products.map((row) => row.id);
  const offers = [];
  const ads = [];
  for (const page of chunks(productIds, 100)) {
    counters.db_select += 2;
    const [offerResponse, adResponse] = await Promise.all([
      db.from('produto_fornecedor_ofertas').select('id,produto_id,fornecedor_nome,dslite_fornecedor_id,dslite_produto_id,custo,estoque,ativo,prioridade,last_sync_at,updated_at').in('produto_id', page),
      db.from('anuncios_ml').select('id,produto_id,ml_item_id,sku,titulo,status,catalogo,preco_ml,updated_at').in('produto_id', page),
    ]);
    if (offerResponse.error || adResponse.error) throw new Error(offerResponse.error?.message || adResponse.error?.message);
    offers.push(...(offerResponse.data || [])); ads.push(...(adResponse.data || []));
  }
  const offersByProduct = new Map();
  for (const offer of offers) offersByProduct.set(String(offer.produto_id), [...(offersByProduct.get(String(offer.produto_id)) || []), offer]);
  const dslitePriceStock = await loadDslitePriceStock(db, offers);
  const allItemIds = [...new Set(sourceRows.flatMap((row) => row.source_ml_item_ids))];
  const itemsById = await fetchItems(ml, allItemIds);
  console.log(`Pré-validação iniciada: ${sourceRows.length} grupos, ${allItemIds.length} anúncios.`);
  const preflight = await mapLimit(sourceRows, 3, async (source, index) => {
    const product = productBySku.get(source.sku);
    const row = await preflightGroup({
      source, product, offers: offersByProduct.get(String(product?.id)) || [], dslitePriceStock, ads, itemsById,
      automationItems, orders, ml, sellerId, asOf,
    });
    if ((index + 1) % 25 === 0) console.log(`Pré-validados ${index + 1}/${sourceRows.length}.`);
    return row;
  });
  const existingGroupIds = new Set((existingState?.groups || []).map((group) => String(group.pricing_group_id)));
  const eligible = preflight.filter((row) => row.status === 'ELEGIVEL' && !existingGroupIds.has(row.pricing_group_id));
  const successes = [];
  const failures = [];

  if (APPLY && eligible.length) {
    const nextState = runtimeState(eligible, startedAt);
    let state = existingState ? {
      ...existingState,
      status: 'executing',
      monitoring_until: nextState.monitoring_until,
      groups: [...existingState.groups, ...nextState.groups],
      updated_at: nowIso(),
    } : nextState;
    await saveState(db, state);
    try {
      await neutralizePendingPriceOutboxes(db, eligible);
    } catch (error) {
      state = { ...state, status: 'closed', groups: [], updated_at: nowIso() };
      await saveState(db, state);
      throw error;
    }
    const pair = eligible.find((row) => row.catalog_synchronized_pair);
    const ordered = [...new Set([pair, ...eligible].filter(Boolean))];
    let fatal = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const group = ordered[index];
      if (fatal) {
        failures.push({ sku: group.sku, pricing_group_id: group.pricing_group_id, error: 'NÃO_EXECUTADO_APÓS_FALHA_FATAL', fatal: true });
        continue;
      }
      const result = await executeGroup(db, ml, group);
      if (result.ok) {
        successes.push({
          sku: group.sku, pricing_group_id: group.pricing_group_id, origin_ml_item_id: group.origin_ml_item_id,
          ml_item_ids: group.ml_item_ids, previous_price: group.current_price, applied_price: group.experimental_price,
          http_status: result.write_status, confirmed_at: result.confirmed_at, observed_prices: result.observed,
          warnings: result.warnings,
        });
      } else {
        failures.push({ sku: group.sku, pricing_group_id: group.pricing_group_id, ...result });
        fatal = result.fatal === true;
      }
      const groupState = state.groups.find((entry) => entry.pricing_group_id === group.pricing_group_id);
      if (groupState && !result.ok) groupState.status = 'execution_failed';
      state.updated_at = nowIso();
      await saveState(db, state);
      if (index === 4 && failures.length) fatal = true;
    }
    const successSet = new Set(successes.map((row) => row.pricing_group_id));
    state.groups = state.groups.filter((group) => existingGroupIds.has(group.pricing_group_id) || successSet.has(group.pricing_group_id));
    if (!state.groups.length) state.status = 'closed';
    else state.status = 'active';
    await saveState(db, state);
    counters.db_insert += 1;
    await db.from('jobs').insert({
      tipo: 'ml_pricing_experiment_d0', status: failures.length ? 'completo_parcial' : 'completo', progresso: 100,
      total: eligible.length, processados: successes.length, finished_at: nowIso(),
      log: [{ event_type: 'experiment_d0', timestamp: nowIso(), experiment_id: EXPERIMENT_ID, eligible: eligible.length, changed: successes.length, failures: failures.length }],
    });
  }

  const manifest = reportFiles({ sourceRows, preflight, successes, failures, priorExecution, startedAt, finishedAt: nowIso() });
  console.log(JSON.stringify({ output: OUTPUT_DIR, zip: `${OUTPUT_DIR}.zip`, ...manifest.counts, mode: manifest.mode }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ error: safeError(error), mode: APPLY ? 'APPLY' : 'DRY_RUN', counters }, null, 2));
  process.exitCode = 1;
});
