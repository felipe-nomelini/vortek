/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { loadPricingTaxRate } = require('./lib/pricing-tax-context');
const {
  buildSeoTitle,
  calculateSeoReactivationProfit,
  chooseReactivationOffer,
  evaluateReactivationCandidate,
  evaluateSeoCandidate,
  normalizeSeoTitleForComparison,
  validateSeoTitle,
} = require('../src/lib/ml/seo-reactivation.ts');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const REPORT_PATH = path.resolve(
  process.argv.find((argument) => argument.startsWith('--report='))?.slice(9)
    || 'reports/seo-reactivation.json',
);
const PAGE_SIZE = 1000;
const BATCH_SIZE = 50;
const MAX_BATCH_ERRORS = 5;
const SOURCE = 'seo-reactivation';
const supabaseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) throw new Error('Configuração do Supabase indisponível');

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let pricingTaxRate = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(value) {
  return String(value || '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function sku(value) {
  return text(value).toUpperCase();
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function productOf(listing) {
  return Array.isArray(listing?.produtos) ? listing.produtos[0] : listing?.produtos;
}

function subStatuses(item) {
  return Array.isArray(item?.sub_status)
    ? item.sub_status.map(lower).filter(Boolean)
    : [];
}

function sellerSku(item) {
  const attribute = (Array.isArray(item?.attributes) ? item.attributes : []).find(
    (row) => text(row?.id).toUpperCase() === 'SELLER_SKU',
  );
  return sku(item?.seller_sku || attribute?.value_name || attribute?.value_id || item?.seller_custom_field);
}

function attributeValue(item, id) {
  const expected = text(id).toUpperCase();
  const attribute = (Array.isArray(item?.attributes) ? item.attributes : []).find(
    (row) => text(row?.id).toUpperCase() === expected,
  );
  return text(attribute?.value_name || attribute?.value_id) || null;
}

function isUserProduct(item) {
  return text(item?.family_name).length > 0
    || (Array.isArray(item?.tags) && item.tags.map(lower).includes('user_product_listing'));
}

function listingProfit(listing, livePrice = listing?.preco_ml, costOverride = null) {
  const product = productOf(listing);
  if (!product) return null;
  return calculateSeoReactivationProfit({
    price: Number(livePrice),
    cost: costOverride === null ? Number(product.custo) : Number(costOverride),
    shipping: Number(product.ml_shipping || 0),
    mlFee: Number(product.ml_fee ?? 0.15),
    taxRate: pricingTaxRate,
  });
}

async function fetchAll(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryFactory().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function getIntegration(type) {
  const { data, error } = await supabase
    .from('integracoes')
    .select('url,access_token,refresh_token,token_expires_at,client_id,client_secret')
    .eq('tipo', type)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`Integração ${type} indisponível: ${error?.message || 'sem registro'}`);
  return data;
}

let mlToken = null;
async function getMlToken(forceRefresh = false) {
  if (mlToken && !forceRefresh) return mlToken;
  const integration = await getIntegration('mercadolivre');
  const expiresAt = new Date(integration.token_expires_at || 0).getTime();
  if (!forceRefresh && integration.access_token && expiresAt > Date.now() + 60_000) {
    await assertAllowedMercadoLivreToken(integration.access_token, `${SOURCE}:cached`);
    mlToken = integration.access_token;
    return mlToken;
  }

  const response = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id || '',
      client_secret: integration.client_secret || '',
      refresh_token: integration.refresh_token || '',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Falha no refresh ML: HTTP ${response.status} ${payload.error || payload.message || ''}`);
  }
  await assertAllowedMercadoLivreToken(payload.access_token, `${SOURCE}:refresh`);
  const { error } = await supabase.from('integracoes').update({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || integration.refresh_token,
    token_expires_at: new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString(),
    last_refresh_at: new Date().toISOString(),
    last_refresh_error: null,
    last_refresh_error_code: null,
  }).eq('tipo', 'mercadolivre');
  if (error) throw new Error(`Falha ao persistir token ML: ${error.message}`);
  mlToken = payload.access_token;
  return mlToken;
}

async function mlRequest(pathname, options = {}, attempt = 1) {
  const accessToken = await getMlToken(attempt > 1 && options.forceRefresh === true);
  let response;
  try {
    response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (attempt < 3) {
      await sleep(750 * attempt);
      return mlRequest(pathname, options, attempt + 1);
    }
    return { ok: false, status: 0, data: null, error: error?.message || 'Falha de rede' };
  }
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (response.status === 401 && attempt === 1) {
    return mlRequest(pathname, { ...options, forceRefresh: true }, attempt + 1);
  }
  if ([408, 409, 424, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(900 * attempt);
    return mlRequest(pathname, options, attempt + 1);
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? null : text(data?.message || data?.error || raw) || `HTTP ${response.status}`,
  };
}

let dsliteConfig = null;
async function getDsliteConfig() {
  if (dsliteConfig) return dsliteConfig;
  const integration = await getIntegration('dslite');
  if (!integration.url || !integration.access_token) throw new Error('Configuração DSLite incompleta');
  dsliteConfig = { url: integration.url.replace(/\/+$/, ''), token: integration.access_token };
  return dsliteConfig;
}

async function dsliteProduct(fornecedorId, produtoId, attempt = 1) {
  const config = await getDsliteConfig();
  let response;
  try {
    response = await fetch(
      `${config.url}/v1/CrossDocking/Catalogo/${encodeURIComponent(fornecedorId)}/${encodeURIComponent(produtoId)}`,
      {
        headers: { 'Content-Type': 'application/json', Token: config.token },
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (error) {
    if (attempt < 3) {
      await sleep(750 * attempt);
      return dsliteProduct(fornecedorId, produtoId, attempt + 1);
    }
    return { ok: false, status: 0, product: null, error: error?.message || 'Falha de rede DSLite' };
  }
  const payload = await response.json().catch(() => null);
  if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(1000 * attempt);
    return dsliteProduct(fornecedorId, produtoId, attempt + 1);
  }
  const product = payload?.produto || (Array.isArray(payload?.produtos) ? payload.produtos[0] : null);
  return {
    ok: response.ok && Boolean(product),
    status: response.status,
    product,
    error: response.ok && product ? null : `DSLite HTTP ${response.status}: produto não retornado`,
  };
}

async function loadListings() {
  return fetchAll(() => supabase.from('anuncios_ml').select(`
    ml_item_id,produto_id,sku,titulo,status,preco_ml,vendidos,visitas,catalogo,
    produtos(
      id,sku,nome,marca,custo,ml_fee,ml_shipping,estoque,ativo,
      oferta_preferencial_id,fornecedor_preferencial_manual
    )
  `).in('status', ['ativo', 'pausado']).order('ml_item_id', { ascending: true }));
}

async function loadOffers(productIds) {
  const unique = Array.from(new Set(productIds.map(text).filter(Boolean)));
  const result = [];
  for (let index = 0; index < unique.length; index += 200) {
    const { data, error } = await supabase.from('produto_fornecedor_ofertas').select(
      'id,produto_id,dslite_fornecedor_id,dslite_produto_id,fornecedor_nome,custo,estoque,ativo,prioridade,last_sync_at',
    ).in('produto_id', unique.slice(index, index + 200));
    if (error) throw new Error(error.message);
    result.push(...(data || []));
  }
  return result;
}

async function loadBlocklist() {
  const { data, error } = await supabase.from('ml_manual_blocklist')
    .select('sku,ml_item_id,motivo').eq('ativo', true);
  if (error) throw new Error(error.message);
  return {
    skus: new Set((data || []).map((row) => sku(row.sku)).filter(Boolean)),
    items: new Set((data || []).map((row) => sku(row.ml_item_id)).filter(Boolean)),
  };
}

function isBlocked(blocklist, listing) {
  return blocklist.items.has(sku(listing.ml_item_id)) || blocklist.skus.has(sku(listing.sku));
}

async function fetchLiveItems(itemIds) {
  const byId = new Map();
  for (let index = 0; index < itemIds.length; index += 20) {
    const ids = itemIds.slice(index, index + 20);
    const result = await mlRequest(
      `/items/bulk?ids=${ids.map(encodeURIComponent).join(',')}&attributes=body.title,body.family_name,body.user_product_id,body.seller_id,body.seller_sku,body.seller_custom_field,body.attributes,body.status,body.sub_status,body.price,body.sold_quantity,body.available_quantity,body.catalog_listing,body.catalog_product_id,body.category_id,body.tags,body.pictures,body.variations,body.permalink,body.thumbnail,body.listing_type_id`,
    );
    if (!result.ok || !Array.isArray(result.data)) {
      for (const id of ids) byId.set(id, { error: result.error || `HTTP ${result.status}`, item: null });
      continue;
    }
    for (const row of result.data) {
      const id = sku(row?.id);
      if (!id) continue;
      byId.set(id, row.status_code === 200
        ? { error: null, item: row.body ? { ...row.body, id } : null }
        : { error: text(row?.body?.message) || `HTTP ${row.status_code}`, item: null });
    }
  }
  return byId;
}

const categoryMaxCache = new Map();
async function categoryMaxTitleLength(categoryId) {
  const id = text(categoryId);
  if (!id) return 60;
  if (categoryMaxCache.has(id)) return categoryMaxCache.get(id);
  const result = await mlRequest(`/categories/${encodeURIComponent(id)}`);
  const value = Math.max(20, Math.min(60, Number(result.data?.settings?.max_title_length) || 60));
  categoryMaxCache.set(id, value);
  return value;
}

async function liveVisits(itemId, startTime = null) {
  const dateTo = new Date().toISOString().slice(0, 10);
  const start = startTime && Number.isFinite(new Date(startTime).getTime())
    ? new Date(startTime)
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const result = await mlRequest(
    `/items/${encodeURIComponent(itemId)}/visits?date_from=${start.toISOString().slice(0, 10)}&date_to=${dateTo}`,
  );
  if (!result.ok) return null;
  const rows = Array.isArray(result.data) ? result.data
    : Array.isArray(result.data?.results) ? result.data.results
      : result.data?.item_id ? [result.data] : [];
  const row = rows.find((entry) => sku(entry?.item_id || entry?.id) === sku(itemId)) || rows[0];
  const count = Number(row?.total_visits ?? row?.visits ?? row?.quantity);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null;
}

async function userProductHasAnySales(sellerId, userProductId) {
  if (!userProductId) return false;
  const search = await mlRequest(
    `/users/${encodeURIComponent(sellerId)}/items/search?user_product_id=${encodeURIComponent(userProductId)}`,
  );
  if (!search.ok) throw new Error(search.error || 'Falha ao consultar condições do User Product');
  const ids = Array.isArray(search.data?.results) ? search.data.results.map(sku).filter(Boolean) : [];
  if (ids.length === 0) return false;
  const live = await fetchLiveItems(ids);
  return ids.some((id) => Number(live.get(id)?.item?.sold_quantity || 0) > 0);
}

function baseAudit(listing, live, profit) {
  return {
    sku: sku(listing.sku),
    ml_item_id: sku(listing.ml_item_id),
    profit_brl: profit,
    sold_quantity: Number(live?.sold_quantity ?? listing.vendidos ?? 0),
    visits: Number(listing.visitas || 0),
    local_status: lower(listing.status),
    live_status: lower(live?.status) || null,
    live_sub_status: subStatuses(live),
  };
}

async function resolveLiveOffers(offers) {
  const live = [];
  for (const offer of offers.filter((row) => row.ativo !== false)) {
    const result = await dsliteProduct(offer.dslite_fornecedor_id, offer.dslite_produto_id);
    if (!result.ok || !result.product) {
      live.push({ ...offer, live_ok: false, live_error: result.error, live_stock: 0, live_cost: 0 });
      continue;
    }
    const stock = Math.max(0, Math.trunc(Number(result.product.estoque_total ?? result.product.estoque ?? 0)));
    const costs = [
      result.product.preco_promocional,
      result.product.preco_crossdocking,
      result.product.preco_normal,
    ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
    live.push({
      ...offer,
      live_ok: true,
      live_error: null,
      live_stock: stock,
      live_cost: costs[0] || Number(offer.custo || 0),
      supplier_title: text(result.product.titulo),
      supplier_brand: text(result.product.marca),
      supplier_model: text(result.product.modelo),
    });
    await sleep(80);
  }
  return live;
}

async function buildDryRun() {
  const startedAt = new Date().toISOString();
  const listings = await loadListings();
  const blocklist = await loadBlocklist();
  const reactivationLocal = listings.filter((listing) => {
    const profit = listingProfit(listing);
    return lower(listing.status) === 'pausado' && profit !== null && profit >= 15 && Number(listing.vendidos) > 0;
  });
  const seoLocal = listings.filter((listing) => {
    const profit = listingProfit(listing);
    return lower(listing.status) === 'ativo' && Number(listing.vendidos) === 0
      && Number(listing.visitas) > 0 && profit !== null && profit > 10;
  });
  const candidates = [...reactivationLocal, ...seoLocal];
  const liveMap = await fetchLiveItems(candidates.map((row) => sku(row.ml_item_id)));
  const me = await mlRequest('/users/me');
  if (!me.ok || !me.data?.id) throw new Error(`Falha ao validar conta ML: ${me.error || me.status}`);
  const sellerId = String(me.data.id);
  const productIds = reactivationLocal.map((row) => text(row.produto_id)).filter(Boolean);
  const offers = await loadOffers(productIds);
  const offersByProduct = new Map();
  for (const offer of offers) {
    const list = offersByProduct.get(offer.produto_id) || [];
    list.push(offer);
    offersByProduct.set(offer.produto_id, list);
  }

  const report = {
    schema_version: 1,
    generated_at: startedAt,
    mode: 'dry_run',
    criteria: {
      reactivation: { status: 'paused', profit_min_brl: 15, sold_min: 1, live_supplier_stock_min: 1 },
      seo: { status: 'active', sold_quantity: 0, visits_min: 1, profit_above_brl: 10 },
      seo_title: { source: 'local_product_and_verified_ml_attributes', max_length: 60, catalog_excluded: true },
      batch_size: BATCH_SIZE,
      max_errors_per_batch: MAX_BATCH_ERRORS,
    },
    source_counts: {
      listings_scanned: listings.length,
      reactivation_preliminary: reactivationLocal.length,
      seo_preliminary: seoLocal.length,
    },
    planned_reactivation: [],
    planned_seo: [],
    reactivated: [],
    optimized: [],
    skipped: [],
    errors: [],
    summary: {},
  };

  for (const listing of reactivationLocal) {
    const itemId = sku(listing.ml_item_id);
    const liveResult = liveMap.get(itemId);
    const live = liveResult?.item;
    if (!live) {
      report.errors.push({ sku: sku(listing.sku), ml_item_id: itemId, stage: 'live_read', error: liveResult?.error || 'Anúncio ausente' });
      continue;
    }
    if (String(live.seller_id) !== sellerId || sellerSku(live) !== sku(listing.sku)) {
      report.skipped.push({ ...baseAudit(listing, live, listingProfit(listing, live.price)), reason: 'live_identity_mismatch' });
      continue;
    }
    const liveOffers = await resolveLiveOffers(offersByProduct.get(listing.produto_id) || []);
    const product = productOf(listing);
    const chosen = chooseReactivationOffer(liveOffers.map((offer) => ({
      ...offer,
      active: offer.ativo !== false && offer.live_ok,
      stock: offer.live_stock,
      cost: offer.live_cost,
      priority: Number(offer.prioridade || 100),
    })), product?.oferta_preferencial_id, product?.fornecedor_preferencial_manual === true);
    const profit = listingProfit(listing, live.price, chosen?.cost ?? null);
    const decision = evaluateReactivationCandidate({
      localStatus: listing.status,
      liveStatus: live.status,
      liveSubStatus: subStatuses(live),
      soldQuantity: Number(live.sold_quantity || 0),
      profit,
      stock: Number(chosen?.stock || 0),
      hasPictures: Array.isArray(live.pictures) && live.pictures.length > 0,
      hasVariations: Array.isArray(live.variations) && live.variations.length > 0,
      blocked: isBlocked(blocklist, listing),
    });
    const audit = baseAudit(listing, live, profit);
    if (!decision.eligible || !chosen) {
      report.skipped.push({ ...audit, protocol: 'reactivation', reason: decision.reason });
      continue;
    }
    report.planned_reactivation.push({
      ...audit,
      supplier_offer_id: chosen.id,
      supplier_id: chosen.dslite_fornecedor_id,
      supplier_product_id: chosen.dslite_produto_id,
      supplier_name: chosen.fornecedor_nome,
      confirmed_stock: chosen.stock,
      confirmed_cost_brl: round2(chosen.cost),
      action: 'set_quantity_and_activate',
    });
  }

  const processedUserProducts = new Set();
  for (const listing of seoLocal) {
    const itemId = sku(listing.ml_item_id);
    const liveResult = liveMap.get(itemId);
    const live = liveResult?.item;
    if (!live) {
      report.errors.push({ sku: sku(listing.sku), ml_item_id: itemId, stage: 'live_read', error: liveResult?.error || 'Anúncio ausente' });
      continue;
    }
    const profit = listingProfit(listing, live.price);
    const audit = baseAudit(listing, live, profit);
    if (String(live.seller_id) !== sellerId || sellerSku(live) !== sku(listing.sku)) {
      report.skipped.push({ ...audit, protocol: 'seo', reason: 'live_identity_mismatch' });
      continue;
    }
    const decision = evaluateSeoCandidate({
      localStatus: listing.status,
      liveStatus: live.status,
      soldQuantity: Number(live.sold_quantity || 0),
      visits: Number(listing.visitas || 0),
      profit,
      catalogListing: live.catalog_listing === true,
      blocked: isBlocked(blocklist, listing),
    });
    if (!decision.eligible) {
      report.skipped.push({ ...audit, protocol: 'seo', reason: decision.reason });
      continue;
    }
    const userProduct = isUserProduct(live);
    const userProductId = text(live.user_product_id);
    if (userProduct && userProductId && processedUserProducts.has(userProductId)) {
      report.skipped.push({ ...audit, protocol: 'seo', reason: 'user_product_already_planned', user_product_id: userProductId });
      continue;
    }
    if (userProduct) {
      try {
        if (await userProductHasAnySales(sellerId, userProductId)) {
          report.skipped.push({ ...audit, protocol: 'seo', reason: 'user_product_has_sales', user_product_id: userProductId });
          continue;
        }
      } catch (error) {
        report.errors.push({ ...audit, stage: 'user_product_sales_check', error: error?.message || String(error) });
        continue;
      }
      if (userProductId) processedUserProducts.add(userProductId);
    }

    const maxLength = await categoryMaxTitleLength(live.category_id);
    const product = productOf(listing);
    const brand = attributeValue(live, 'BRAND') || text(product?.marca);
    const model = attributeValue(live, 'MODEL');
    const currentEditableTitle = text(userProduct ? live.family_name : live.title);
    const allowOriginal = /\boriginal\b/iu.test(model || '');
    const proposed = buildSeoTitle({
      productName: text(product?.nome) || currentEditableTitle,
      currentTitle: currentEditableTitle,
      brand,
      model,
      maxLength,
      allowOriginal,
    });
    const validation = validateSeoTitle(proposed, { maxLength, allowOriginal });
    if (!validation.ok) {
      report.skipped.push({ ...audit, protocol: 'seo', reason: validation.reason, proposed_title: proposed });
      continue;
    }
    if (normalizeSeoTitleForComparison(proposed) === normalizeSeoTitleForComparison(currentEditableTitle)) {
      report.skipped.push({ ...audit, protocol: 'seo', reason: 'title_unchanged', proposed_title: proposed });
      continue;
    }
    report.planned_seo.push({
      ...audit,
      field: userProduct ? 'family_name' : 'title',
      user_product_id: userProductId || null,
      category_id: text(live.category_id),
      max_title_length: maxLength,
      allow_original: allowOriginal,
      old_title: currentEditableTitle,
      new_title: proposed,
      evidence: { product_name: text(product?.nome), brand: brand || null, model: model || null },
    });
  }

  report.summary = {
    planned_reactivation: report.planned_reactivation.length,
    planned_seo: report.planned_seo.length,
    skipped: report.skipped.length,
    errors: report.errors.length,
  };
  return report;
}

async function readCurrentListing(itemId) {
  const { data, error } = await supabase.from('anuncios_ml').select(`
    ml_item_id,produto_id,sku,titulo,status,preco_ml,vendidos,visitas,catalogo,
    produtos(id,sku,nome,marca,custo,ml_fee,ml_shipping,estoque,ativo,oferta_preferencial_id,fornecedor_preferencial_manual)
  `).eq('ml_item_id', sku(itemId)).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function fetchSingleLive(itemId) {
  const result = await mlRequest(`/items/${encodeURIComponent(itemId)}?include_attributes=all&include_internal_attributes=true`);
  if (!result.ok || !result.data) throw new Error(result.error || `ML HTTP ${result.status}`);
  return result.data;
}

async function persistReactivated(plan, listing, live, offer, stock) {
  const now = new Date().toISOString();
  const [{ error: offerError }, { error: listingError }, { error: productError }] = await Promise.all([
    supabase.from('produto_fornecedor_ofertas').update({
      custo: offer.cost,
      estoque: stock,
      last_sync_at: now,
      updated_at: now,
    }).eq('id', offer.id),
    supabase.from('anuncios_ml').update({
      status: 'ativo',
      titulo: text(live.title),
      preco_ml: Number(live.price || listing.preco_ml || 0),
      updated_at: now,
    }).eq('ml_item_id', plan.ml_item_id),
    supabase.from('produtos').update({
      oferta_preferencial_id: offer.id,
      fornecedor: offer.fornecedor_nome,
      dslite_fornecedor_id: offer.dslite_fornecedor_id,
      dslite_produto_id: offer.dslite_produto_id,
      dslite_ultima_sync: now,
      custo: offer.cost,
      estoque: stock,
      ml_status: 'ativo',
      updated_at: now,
    }).eq('id', listing.produto_id),
  ]);
  if (offerError || listingError || productError) {
    throw new Error(offerError?.message || listingError?.message || productError?.message);
  }
}

async function applyReactivation(plan, blocklist) {
  const listing = await readCurrentListing(plan.ml_item_id);
  if (!listing) return { ok: false, skipped: true, reason: 'revalidation:local_listing_missing' };
  const live = await fetchSingleLive(plan.ml_item_id);
  if (sellerSku(live) !== plan.sku) return { ok: false, skipped: true, reason: 'revalidation:sku_mismatch' };
  const { data: offer, error } = await supabase.from('produto_fornecedor_ofertas').select('*')
    .eq('id', plan.supplier_offer_id).maybeSingle();
  if (error || !offer) return { ok: false, skipped: true, reason: 'revalidation:supplier_offer_missing' };
  const fresh = await dsliteProduct(offer.dslite_fornecedor_id, offer.dslite_produto_id);
  if (!fresh.ok || !fresh.product) throw new Error(fresh.error || 'Falha ao consultar saldo DSLite');
  const stock = Math.max(0, Math.trunc(Number(fresh.product.estoque_total ?? fresh.product.estoque ?? 0)));
  const costs = [fresh.product.preco_promocional, fresh.product.preco_crossdocking, fresh.product.preco_normal]
    .map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const cost = costs[0] || Number(offer.custo || 0);
  const profit = listingProfit(listing, live.price, cost);
  const decision = evaluateReactivationCandidate({
    localStatus: listing.status,
    liveStatus: live.status,
    liveSubStatus: subStatuses(live),
    soldQuantity: Number(live.sold_quantity || 0),
    profit,
    stock,
    hasPictures: Array.isArray(live.pictures) && live.pictures.length > 0,
    hasVariations: Array.isArray(live.variations) && live.variations.length > 0,
    blocked: isBlocked(blocklist, listing),
  });
  if (!decision.eligible) return { ok: false, skipped: true, reason: `revalidation:${decision.reason}` };

  const quantity = await mlRequest(`/items/${encodeURIComponent(plan.ml_item_id)}`, {
    method: 'PUT', body: { available_quantity: stock },
  });
  if (!quantity.ok) throw new Error(`Estoque ML recusado: ${quantity.error}`);
  let after = await fetchSingleLive(plan.ml_item_id);
  if (lower(after.status) !== 'active') {
    const activation = await mlRequest(`/items/${encodeURIComponent(plan.ml_item_id)}`, {
      method: 'PUT', body: { status: 'active' },
    });
    if (!activation.ok) throw new Error(`Ativação ML recusada: ${activation.error}`);
    await sleep(600);
    after = await fetchSingleLive(plan.ml_item_id);
  }
  if (lower(after.status) !== 'active' || Number(after.available_quantity || 0) <= 0 || sellerSku(after) !== plan.sku) {
    throw new Error('Verificação final de reativação falhou');
  }
  await persistReactivated(plan, listing, after, {
    ...offer, cost, fornecedor_nome: offer.fornecedor_nome,
  }, stock);
  return {
    ok: true,
    row: {
      sku: plan.sku,
      ml_item_id: plan.ml_item_id,
      supplier_name: offer.fornecedor_nome,
      supplier_id: offer.dslite_fornecedor_id,
      confirmed_stock: Number(after.available_quantity),
      preserved_profit_brl: profit,
      verified_status: after.status,
      applied_at: new Date().toISOString(),
    },
  };
}

async function applySeo(plan, blocklist, sellerId) {
  const listing = await readCurrentListing(plan.ml_item_id);
  if (!listing) return { ok: false, skipped: true, reason: 'revalidation:local_listing_missing' };
  let live = await fetchSingleLive(plan.ml_item_id);
  if (sellerSku(live) !== plan.sku) return { ok: false, skipped: true, reason: 'revalidation:sku_mismatch' };
  const visits = await liveVisits(plan.ml_item_id, live.start_time);
  const profit = listingProfit(listing, live.price);
  const decision = evaluateSeoCandidate({
    localStatus: listing.status,
    liveStatus: live.status,
    soldQuantity: Number(live.sold_quantity || 0),
    visits,
    profit,
    catalogListing: live.catalog_listing === true,
    blocked: isBlocked(blocklist, listing),
  });
  if (!decision.eligible) return { ok: false, skipped: true, reason: `revalidation:${decision.reason}` };
  const userProduct = isUserProduct(live);
  const expectedField = userProduct ? 'family_name' : 'title';
  if (expectedField !== plan.field) return { ok: false, skipped: true, reason: 'revalidation:title_model_changed' };
  if (userProduct && await userProductHasAnySales(sellerId, live.user_product_id)) {
    return { ok: false, skipped: true, reason: 'revalidation:user_product_has_sales' };
  }
  const maxLength = await categoryMaxTitleLength(live.category_id);
  const validation = validateSeoTitle(plan.new_title, { maxLength, allowOriginal: plan.allow_original === true });
  if (!validation.ok) return { ok: false, skipped: true, reason: `revalidation:${validation.reason}` };
  const current = text(userProduct ? live.family_name : live.title);
  const currentComparable = normalizeSeoTitleForComparison(current);
  const newComparable = normalizeSeoTitleForComparison(plan.new_title);
  if (currentComparable !== newComparable
    && currentComparable !== normalizeSeoTitleForComparison(plan.old_title)) {
    return { ok: false, skipped: true, reason: 'revalidation:title_changed_since_dry_run' };
  }
  const alreadyApplied = currentComparable === newComparable;
  if (!alreadyApplied) {
    const update = await mlRequest(
      userProduct
        ? `/items/${encodeURIComponent(plan.ml_item_id)}/family_name`
        : `/items/${encodeURIComponent(plan.ml_item_id)}`,
      { method: 'PUT', body: userProduct ? { family_name: plan.new_title } : { title: plan.new_title } },
    );
    if (!update.ok) throw new Error(`Título ML recusado: ${update.error}`);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(attempt === 0 ? 600 : 1000);
      live = await fetchSingleLive(plan.ml_item_id);
      if (normalizeSeoTitleForComparison(text(userProduct ? live.family_name : live.title)) === newComparable) break;
    }
  }
  const verified = text(userProduct ? live.family_name : live.title);
  if (normalizeSeoTitleForComparison(verified) !== newComparable || Number(live.sold_quantity || 0) !== 0) {
    throw new Error('Verificação final do título falhou');
  }
  const { error } = await supabase.from('anuncios_ml').update({
    titulo: text(live.title) || plan.new_title,
    updated_at: new Date().toISOString(),
  }).eq('ml_item_id', plan.ml_item_id);
  if (error) throw new Error(`Título atualizado no ML, mas ERP falhou: ${error.message}`);
  return {
    ok: true,
    row: {
      sku: plan.sku,
      ml_item_id: plan.ml_item_id,
      field: plan.field,
      user_product_id: plan.user_product_id,
      old_title: plan.old_title,
      new_title: plan.new_title,
      verified_title: verified,
      already_applied: alreadyApplied,
      applied_at: new Date().toISOString(),
    },
  };
}

async function runApply(dryReport) {
  if (!['dry_run', 'apply'].includes(dryReport.mode) || dryReport.schema_version !== 1) {
    throw new Error('Relatório dry-run compatível é obrigatório antes do --apply');
  }
  const blocklist = await loadBlocklist();
  const me = await mlRequest('/users/me');
  if (!me.ok || !me.data?.id) throw new Error(`Falha ao validar conta ML: ${me.error || me.status}`);
  const resuming = dryReport.mode === 'apply';
  const report = {
    ...dryReport,
    generated_at: new Date().toISOString(),
    mode: 'apply',
    dry_run_generated_at: dryReport.dry_run_generated_at || dryReport.generated_at,
    reactivated: resuming ? (dryReport.reactivated || []) : [],
    optimized: resuming ? (dryReport.optimized || []) : [],
    apply_skipped: [], apply_errors: [],
    attempt_history: [
      ...(dryReport.attempt_history || []),
      ...(resuming ? [{
        generated_at: dryReport.generated_at,
        apply_skipped: dryReport.apply_skipped || [],
        apply_errors: dryReport.apply_errors || [],
      }] : []),
    ],
  };
  const completed = new Set([
    ...report.reactivated.map((row) => `reactivation:${row.ml_item_id}`),
    ...report.optimized.map((row) => `seo:${row.ml_item_id}`),
  ]);
  const operations = [
    ...dryReport.planned_reactivation.map((plan) => ({ protocol: 'reactivation', plan })),
    ...dryReport.planned_seo.map((plan) => ({ protocol: 'seo', plan })),
  ].filter((operation) => !completed.has(`${operation.protocol}:${operation.plan.ml_item_id}`));
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = operations.slice(offset, offset + BATCH_SIZE);
    let batchErrors = 0;
    for (const operation of batch) {
      if (batchErrors >= MAX_BATCH_ERRORS) {
        report.apply_skipped.push({
          sku: operation.plan.sku,
          ml_item_id: operation.plan.ml_item_id,
          protocol: operation.protocol,
          reason: 'batch_error_limit_reached',
        });
        continue;
      }
      try {
        const result = operation.protocol === 'reactivation'
          ? await applyReactivation(operation.plan, blocklist)
          : await applySeo(operation.plan, blocklist, String(me.data.id));
        if (result.ok) {
          if (operation.protocol === 'reactivation') report.reactivated.push(result.row);
          else report.optimized.push(result.row);
          console.log(`${operation.plan.ml_item_id} ${operation.protocol} applied`);
        } else {
          report.apply_skipped.push({
            sku: operation.plan.sku,
            ml_item_id: operation.plan.ml_item_id,
            protocol: operation.protocol,
            reason: result.reason,
          });
          console.log(`${operation.plan.ml_item_id} ${operation.protocol} skipped ${result.reason}`);
        }
      } catch (error) {
        batchErrors += 1;
        report.apply_errors.push({
          sku: operation.plan.sku,
          ml_item_id: operation.plan.ml_item_id,
          protocol: operation.protocol,
          error: error?.message || String(error),
        });
        console.error(`${operation.plan.ml_item_id} ${operation.protocol} error ${error?.message || error}`);
      }
      await sleep(120);
    }
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }
  report.summary = {
    ...report.summary,
    reactivated: report.reactivated.length,
    optimized: report.optimized.length,
    apply_skipped: report.apply_skipped.length,
    apply_errors: report.apply_errors.length,
  };
  return report;
}

async function main() {
  const pricingTax = await loadPricingTaxRate(supabase);
  pricingTaxRate = pricingTax.taxRate;
  let report;
  if (APPLY) {
    if (!fs.existsSync(REPORT_PATH)) throw new Error(`Dry-run ausente: ${REPORT_PATH}`);
    const dryReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    report = await runApply(dryReport);
  } else {
    report = await buildDryRun();
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ mode: report.mode, report: REPORT_PATH, ...report.summary }));
  if ((report.errors?.length || 0) > 0 || (report.apply_errors?.length || 0) > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
