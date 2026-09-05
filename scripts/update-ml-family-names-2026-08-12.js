/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  KNOWN_FIELD_NOT_UPDATABLE,
  QUALITY_60_OVERRIDE,
  ROWS,
  TITLE_PATTERN,
  buildFamilyNameUpdate,
  normalizeFamilyName,
} = require('./lib/ml-family-name-batch');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const REPORT_PATH = path.resolve('reports/ml-shelf-and-seo-2026-08-12/family-name-consolidated-report.json');
const MAX_CONSECUTIVE_ERRORS = 5;

const supabaseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) throw new Error('Configuração Supabase indisponível');
const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => String(value || '').trim();
const upper = (value) => text(value).toUpperCase();
const configHash = crypto.createHash('sha256').update(JSON.stringify(ROWS)).digest('hex');

async function getIntegration(type) {
  const { data, error } = await supabase.from('integracoes')
    .select('url,access_token,refresh_token,token_expires_at,client_id,client_secret')
    .eq('tipo', type).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error(`Integração ${type} indisponível: ${error?.message || 'sem registro'}`);
  return data;
}

let mlToken = null;
async function getMlToken(forceRefresh = false) {
  if (mlToken && !forceRefresh) return mlToken;
  const integration = await getIntegration('mercadolivre');
  if (!forceRefresh && integration.access_token
    && new Date(integration.token_expires_at || 0).getTime() > Date.now() + 60_000) {
    await assertAllowedMercadoLivreToken(integration.access_token, 'family-name-batch:cached');
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
  if (!response.ok || !payload.access_token) throw new Error(`Refresh ML falhou: HTTP ${response.status}`);
  await assertAllowedMercadoLivreToken(payload.access_token, 'family-name-batch:refresh');
  const { error } = await supabase.from('integracoes').update({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || integration.refresh_token,
    token_expires_at: new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString(),
    last_refresh_at: new Date().toISOString(),
  }).eq('tipo', 'mercadolivre');
  if (error) throw new Error(`Token renovado, persistência falhou: ${error.message}`);
  mlToken = payload.access_token;
  return mlToken;
}

async function mlRequest(pathname, options = {}, attempt = 1) {
  const token = await getMlToken(attempt > 1 && options.forceRefresh === true);
  let response;
  try {
    response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method: options.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (attempt < 3) { await sleep(800 * attempt); return mlRequest(pathname, options, attempt + 1); }
    return { ok: false, status: 0, data: null, error: error.message };
  }
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (response.status === 401 && attempt === 1) return mlRequest(pathname, { ...options, forceRefresh: true }, 2);
  if ([408, 409, 424, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(900 * attempt); return mlRequest(pathname, options, attempt + 1);
  }
  return { ok: response.ok, status: response.status, data, error: response.ok ? null : text(data?.message || data?.error || raw) };
}

let dsliteConfig = null;
async function dsliteProduct(supplierId, productId, attempt = 1) {
  if (!dsliteConfig) {
    const integration = await getIntegration('dslite');
    dsliteConfig = { url: text(integration.url).replace(/\/+$/, ''), token: integration.access_token };
  }
  try {
    const response = await fetch(
      `${dsliteConfig.url}/v1/CrossDocking/Catalogo/${encodeURIComponent(supplierId)}/${encodeURIComponent(productId)}`,
      { headers: { Token: dsliteConfig.token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000) },
    );
    const payload = await response.json().catch(() => null);
    const product = payload?.produto || payload?.produtos?.[0];
    if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
      await sleep(1000 * attempt); return dsliteProduct(supplierId, productId, attempt + 1);
    }
    return { ok: response.ok && Boolean(product), stock: Math.max(0, Number(product?.estoque_total ?? product?.estoque ?? 0)), status: response.status };
  } catch (error) {
    if (attempt < 3) { await sleep(800 * attempt); return dsliteProduct(supplierId, productId, attempt + 1); }
    return { ok: false, stock: 0, status: 0, error: error.message };
  }
}

function sellerSku(item) {
  const attr = (item?.attributes || []).find((row) => upper(row?.id) === 'SELLER_SKU');
  return upper(item?.seller_sku || item?.seller_custom_field || attr?.value_name || attr?.value_id);
}

async function fetchLiveItems(ids) {
  const result = new Map();
  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const response = await mlRequest(`/items/bulk?ids=${batch.join(',')}&attributes=body.title,body.family_name,body.user_product_id,body.seller_id,body.seller_sku,body.seller_custom_field,body.attributes,body.status,body.sub_status,body.sold_quantity,body.available_quantity,body.catalog_listing,body.category_id`);
    if (!response.ok || !Array.isArray(response.data)) throw new Error(response.error || 'Consulta de anúncios falhou');
    for (const row of response.data) {
      const id = upper(row?.id);
      if (id) result.set(id, row.status_code === 200 && row.body ? { ...row.body, id } : null);
    }
  }
  return result;
}

async function familyHasSales(sellerId, userProductId) {
  const search = await mlRequest(`/users/${sellerId}/items/search?user_product_id=${encodeURIComponent(userProductId)}`);
  if (!search.ok) throw new Error(search.error || 'Consulta da família falhou');
  const ids = (search.data?.results || []).map(upper).filter(Boolean);
  if (!ids.length) return false;
  const live = await fetchLiveItems(ids);
  return ids.some((id) => Number(live.get(id)?.sold_quantity || 0) > 0);
}

async function loadStockContext(ads) {
  const productIds = ads.map((row) => text(row.produto_id));
  const { data: kits, error: kitError } = await supabase.from('produto_kits')
    .select('produto_id,ativo').in('produto_id', productIds);
  if (kitError) throw new Error(kitError.message);
  const kitIds = (kits || []).map((row) => text(row.produto_id));
  const { data: components, error: componentError } = kitIds.length
    ? await supabase.from('produto_kit_componentes').select('kit_produto_id,componente_produto_id,quantidade').in('kit_produto_id', kitIds)
    : { data: [], error: null };
  if (componentError) throw new Error(componentError.message);
  const sourceIds = [...new Set((components || []).map((row) => text(row.componente_produto_id)))];
  const offerProductIds = [...new Set([...productIds.filter((id) => !kitIds.includes(id)), ...sourceIds])];
  const { data: offers, error: offerError } = offerProductIds.length
    ? await supabase.from('produto_fornecedor_ofertas')
      .select('produto_id,dslite_fornecedor_id,dslite_produto_id,fornecedor_nome,ativo').in('produto_id', offerProductIds)
    : { data: [], error: null };
  if (offerError) throw new Error(offerError.message);
  const offersByProduct = new Map();
  for (const offer of offers || []) {
    if (offer.ativo === false) continue;
    const list = offersByProduct.get(text(offer.produto_id)) || [];
    list.push(offer); offersByProduct.set(text(offer.produto_id), list);
  }
  for (const ad of ads) {
    const product = Array.isArray(ad.produtos) ? ad.produtos[0] : ad.produtos;
    if (kitIds.includes(text(ad.produto_id)) || offersByProduct.has(text(ad.produto_id))) continue;
    if (product?.dslite_fornecedor_id && product?.dslite_produto_id) {
      offersByProduct.set(text(ad.produto_id), [{
        produto_id: ad.produto_id,
        dslite_fornecedor_id: product.dslite_fornecedor_id,
        dslite_produto_id: product.dslite_produto_id,
        fornecedor_nome: product.fornecedor || 'direto',
        ativo: true,
      }]);
    }
  }
  const liveOffer = new Map();
  const uniqueOffers = [...new Map([...offersByProduct.values()].flat().map((offer) => [
    `${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`, offer,
  ])).values()];
  for (const offer of uniqueOffers) {
    const key = `${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`;
    liveOffer.set(key, await dsliteProduct(offer.dslite_fornecedor_id, offer.dslite_produto_id));
    await sleep(80);
  }
  const stockForProduct = (productId) => Math.max(0, ...(offersByProduct.get(text(productId)) || [])
    .map((offer) => liveOffer.get(`${offer.dslite_fornecedor_id}/${offer.dslite_produto_id}`))
    .filter((row) => row?.ok).map((row) => Number(row.stock || 0)));
  const kitById = new Map((kits || []).map((row) => [text(row.produto_id), row]));
  const componentsByKit = new Map();
  for (const component of components || []) {
    const list = componentsByKit.get(text(component.kit_produto_id)) || [];
    list.push(component); componentsByKit.set(text(component.kit_produto_id), list);
  }
  return (productId) => {
    const kit = kitById.get(text(productId));
    if (!kit) return Math.floor(stockForProduct(productId));
    if (kit.ativo === false) return 0;
    const rows = componentsByKit.get(text(productId)) || [];
    if (!rows.length) return 0;
    return Math.max(0, Math.floor(Math.min(...rows.map((row) => (
      stockForProduct(row.componente_produto_id) / Math.max(1, Number(row.quantidade || 0))
    )))));
  };
}

const categoryMaxCache = new Map();
async function categoryMax(categoryId) {
  if (categoryMaxCache.has(categoryId)) return categoryMaxCache.get(categoryId);
  const response = await mlRequest(`/categories/${encodeURIComponent(categoryId)}`);
  if (!response.ok) throw new Error(response.error || `Categoria ${categoryId} indisponível`);
  const max = Number(response.data?.settings?.max_title_length || 60);
  categoryMaxCache.set(categoryId, max); return max;
}

async function buildReport() {
  const { data: ads, error } = await supabase.from('anuncios_ml').select(`
    ml_item_id,produto_id,sku,status,qualidade,
    produtos(id,sku,fornecedor,dslite_fornecedor_id,dslite_produto_id)
  `).in('ml_item_id', ROWS.map((row) => row.mlItemId));
  if (error) throw new Error(error.message);
  const adsById = new Map((ads || []).map((row) => [upper(row.ml_item_id), row]));
  const liveById = await fetchLiveItems(ROWS.map((row) => row.mlItemId));
  const alreadyApplied = [];
  const blocked = [];
  const planned = [];
  const errors = [];
  const candidates = [];

  for (const row of ROWS) {
    try {
      const ad = adsById.get(row.mlItemId);
      const live = liveById.get(row.mlItemId);
      const audit = {
        sku: row.sku,
        ml_item_id: row.mlItemId,
        user_product_id: live?.user_product_id || null,
        quality: Number(ad?.qualidade ?? 0),
        catalog_listing: live?.catalog_listing === true,
        local_status: ad?.status || null,
        live_status: live?.status || null,
        live_sub_status: live?.sub_status || [],
        available_quantity: Number(live?.available_quantity ?? 0),
        confirmed_stock: null,
        old_family_name: live?.family_name || null,
        new_family_name: row.familyName,
        max_title_length: null,
      };

      if (live && normalizeFamilyName(live.family_name) === normalizeFamilyName(row.familyName)) {
        alreadyApplied.push({ ...audit, reason: 'already_applied' });
        continue;
      }
      if (KNOWN_FIELD_NOT_UPDATABLE.has(row.mlItemId)) {
        blocked.push({ ...audit, reason: 'field_not_updatable', previous_error: 'ML HTTP 400: FIELD_NOT_UPDATABLE' });
        continue;
      }
      if (!ad || !live || !live.user_product_id || !text(live.family_name)) {
        const reason = !ad ? 'local_listing_missing' : !live ? 'live_listing_missing' : 'not_user_product';
        blocked.push({ ...audit, reason });
        continue;
      }

      if (await familyHasSales(String(live.seller_id), live.user_product_id)) {
        const secondaryReasons = [];
        if (upper(ad.sku) !== row.sku || sellerSku(live) !== row.sku) secondaryReasons.push('sku_mismatch');
        if (text(ad.status).toLowerCase() !== 'ativo' || text(live.status).toLowerCase() !== 'active') secondaryReasons.push('not_active');
        if (!(Number(live.available_quantity) > 0)) secondaryReasons.push('ml_without_stock');
        blocked.push({ ...audit, reason: 'user_product_has_sales', secondary_reasons: secondaryReasons });
        continue;
      }
      candidates.push({ row, ad, live, audit });
    } catch (error) {
      errors.push({ sku: row.sku, ml_item_id: row.mlItemId, stage: 'preflight', error: error.message });
    }
  }

  const confirmedStock = await loadStockContext(candidates.map(({ ad }) => ad));
  for (const { row, ad, live, audit } of candidates) {
    try {
      const stock = confirmedStock(ad.produto_id);
      const maxLength = await categoryMax(live.category_id);
      let reason = null;
      if (upper(ad.sku) !== row.sku || sellerSku(live) !== row.sku) reason = 'sku_mismatch';
      else if (text(ad.status).toLowerCase() !== 'ativo' || text(live.status).toLowerCase() !== 'active') reason = 'not_active';
      else if (!(Number(ad.qualidade) > 60) && !QUALITY_60_OVERRIDE.has(row.mlItemId)) reason = 'quality_not_approved';
      else if (!(Number(live.available_quantity) > 0)) reason = 'ml_without_stock';
      else if (stock <= 0) reason = 'supplier_without_stock';
      else if (!TITLE_PATTERN.test(row.familyName) || row.familyName.length >= 60 || row.familyName.length > maxLength) reason = 'invalid_family_name';
      const completeAudit = { ...audit, confirmed_stock: stock, max_title_length: maxLength };
      if (reason) blocked.push({ ...completeAudit, reason });
      else planned.push(completeAudit);
    } catch (error) {
      errors.push({ sku: row.sku, ml_item_id: row.mlItemId, stage: 'candidate_preflight', error: error.message });
    }
  }

  const blockedByReason = blocked.reduce((result, row) => {
    result[row.reason] = (result[row.reason] || 0) + 1;
    return result;
  }, {});
  return {
    schema_version: 2,
    mode: 'dry_run',
    generated_at: new Date().toISOString(),
    config_hash: configHash,
    criteria: {
      status: 'active',
      quality_above: 60,
      quality_60_override: [...QUALITY_60_OVERRIDE],
      confirmed_supplier_stock_min: 1,
      family_without_sales: true,
      ascii: true,
      max_length_exclusive: 60,
      update_resource: 'PUT /items/{ITEM_ID}/family_name',
    },
    already_applied: alreadyApplied,
    blocked,
    planned,
    updated: [],
    errors,
    summary: {
      input: ROWS.length,
      already_applied: alreadyApplied.length,
      blocked: blocked.length,
      blocked_by_reason: blockedByReason,
      planned: planned.length,
      errors: errors.length,
      updated: 0,
    },
  };
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function applyReport() {
  if (!fs.existsSync(REPORT_PATH)) throw new Error('Execute dry-run antes do --apply');
  const previous = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (!['dry_run', 'apply'].includes(previous.mode) || previous.config_hash !== configHash) {
    throw new Error('Dry-run ausente ou desatualizado');
  }
  const report = previous.mode === 'apply'
    ? { ...previous, generated_at: new Date().toISOString() }
    : {
        ...previous,
        mode: 'apply',
        dry_run_generated_at: previous.generated_at,
        generated_at: new Date().toISOString(),
        updated: [],
        apply_errors: [],
      };
  const completed = new Set([
    ...(report.updated || []).map((row) => row.ml_item_id),
    ...(report.apply_errors || []).map((row) => row.ml_item_id),
  ]);
  let consecutiveErrors = 0;
  for (const plan of report.planned.filter((row) => !completed.has(row.ml_item_id))) {
    try {
      const { data: ad, error: adError } = await supabase.from('anuncios_ml').select(`
        ml_item_id,produto_id,sku,status,qualidade,
        produtos(id,sku,fornecedor,dslite_fornecedor_id,dslite_produto_id)
      `).eq('ml_item_id', plan.ml_item_id).maybeSingle();
      if (adError || !ad) throw new Error(`local_revalidation_failed: ${adError?.message || 'listing_missing'}`);
      let live = (await fetchLiveItems([plan.ml_item_id])).get(plan.ml_item_id);
      if (!live || upper(ad.sku) !== plan.sku || sellerSku(live) !== plan.sku
        || text(ad.status).toLowerCase() !== 'ativo' || text(live.status).toLowerCase() !== 'active'
        || !(Number(live.available_quantity) > 0)) throw new Error('revalidation_failed');
      if (!(Number(ad.qualidade) > 60) && !QUALITY_60_OVERRIDE.has(plan.ml_item_id)) throw new Error('quality_not_approved');
      if (await familyHasSales(String(live.seller_id), live.user_product_id)) throw new Error('user_product_has_sales');
      const confirmedStock = await loadStockContext([ad]);
      if (confirmedStock(ad.produto_id) <= 0) throw new Error('supplier_without_stock');
      const maxLength = await categoryMax(live.category_id);
      if (!TITLE_PATTERN.test(plan.new_family_name) || plan.new_family_name.length >= 60 || plan.new_family_name.length > maxLength) {
        throw new Error('invalid_family_name');
      }
      const alreadyAppliedNow = normalizeFamilyName(live.family_name) === normalizeFamilyName(plan.new_family_name);
      if (!alreadyAppliedNow) {
        const request = buildFamilyNameUpdate(plan.ml_item_id, plan.new_family_name);
        const update = await mlRequest(request.pathname, {
          method: 'PUT', body: request.body,
        });
        if (!update.ok) throw new Error(`ML HTTP ${update.status}: ${update.error}`);
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await sleep(attempt === 0 ? 600 : 1000);
          live = (await fetchLiveItems([plan.ml_item_id])).get(plan.ml_item_id);
          if (normalizeFamilyName(live?.family_name) === normalizeFamilyName(plan.new_family_name) && text(live?.title)) break;
        }
      }
      if (!live || normalizeFamilyName(live.family_name) !== normalizeFamilyName(plan.new_family_name)
        || !text(live.title) || text(live.status).toLowerCase() !== 'active') {
        throw new Error('final_verification_failed');
      }
      const { data: localUpdate, error } = await supabase.from('anuncios_ml').update({
        titulo: text(live.title) || plan.new_family_name,
        updated_at: new Date().toISOString(),
      }).eq('ml_item_id', plan.ml_item_id).select('ml_item_id,titulo').maybeSingle();
      if (error || !localUpdate || localUpdate.titulo !== live.title) {
        throw new Error(`ML atualizado, ERP falhou: ${error?.message || 'verification_failed'}`);
      }
      report.updated.push({
        ...plan,
        verified_family_name: live.family_name,
        verified_title: live.title,
        verified_local_title: localUpdate.titulo,
        already_applied_at_apply: alreadyAppliedNow,
        applied_at: new Date().toISOString(),
      });
      consecutiveErrors = 0;
      console.log(`[ok] ${plan.sku} ${plan.ml_item_id}`);
    } catch (error) {
      report.apply_errors.push({ sku: plan.sku, ml_item_id: plan.ml_item_id, error: error.message });
      consecutiveErrors += 1;
      console.log(`[fail] ${plan.sku} ${error.message}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
    }
    report.summary.updated = report.updated.length;
    report.summary.apply_errors = report.apply_errors.length;
    writeReport(report);
    await sleep(500);
  }
  report.generated_at = new Date().toISOString();
  report.summary.updated = report.updated.length;
  report.summary.apply_errors = report.apply_errors.length;
  writeReport(report);
  return report;
}

(async () => {
  const report = APPLY ? await applyReport() : await buildReport();
  writeReport(report);
  console.log(JSON.stringify(report.summary, null, 2));
  if ((report.errors?.length || 0) > 0 || (report.apply_errors?.length || 0) > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
