/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { buildFamilyNameUpdate, normalizeFamilyName } = require('./lib/ml-family-name-batch');
const { ROWS, TITLE_PATTERN } = require('./lib/ml-seo-resgate-v1');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const REPORT_PATH = path.resolve('reports/ml-seo-resgate-v1.json');
const MAX_CONSECUTIVE_ERRORS = 5;
const SOURCE = 'ml-seo-resgate-v1';
const configHash = crypto.createHash('sha256').update(JSON.stringify(ROWS)).digest('hex');

const supabaseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) throw new Error('Configuração Supabase indisponível');
const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => String(value || '').trim();
const upper = (value) => text(value).toUpperCase();
const lower = (value) => text(value).toLowerCase();

async function getIntegration(type) {
  const { data, error } = await supabase.from('integracoes')
    .select('access_token,refresh_token,token_expires_at,client_id,client_secret')
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
  if (!response.ok || !payload.access_token) throw new Error(`Refresh ML falhou: HTTP ${response.status}`);
  await assertAllowedMercadoLivreToken(payload.access_token, `${SOURCE}:refresh`);
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
    if (attempt < 3) {
      await sleep(800 * attempt);
      return mlRequest(pathname, options, attempt + 1);
    }
    return { ok: false, status: 0, data: null, error: error.message };
  }
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (response.status === 401 && attempt === 1) {
    return mlRequest(pathname, { ...options, forceRefresh: true }, 2);
  }
  if ([408, 409, 424, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(900 * attempt);
    return mlRequest(pathname, options, attempt + 1);
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? null : text(data?.message || data?.error || raw),
  };
}

function sellerSku(item) {
  const attribute = (item?.attributes || []).find((row) => upper(row?.id) === 'SELLER_SKU');
  return upper(item?.seller_sku || item?.seller_custom_field || attribute?.value_name || attribute?.value_id);
}

async function fetchLiveItems(ids) {
  const result = new Map();
  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const response = await mlRequest(
      `/items?ids=${batch.map(encodeURIComponent).join(',')}&attributes=id,title,family_name,user_product_id,seller_id,seller_sku,seller_custom_field,attributes,status,sub_status,sold_quantity,available_quantity,catalog_listing,category_id`,
    );
    if (!response.ok || !Array.isArray(response.data)) throw new Error(response.error || 'Consulta de anúncios falhou');
    for (const row of response.data) result.set(upper(row?.body?.id), row.code === 200 ? row.body : null);
  }
  return result;
}

async function familyHasSales(sellerId, userProductId) {
  const response = await mlRequest(
    `/users/${encodeURIComponent(sellerId)}/items/search?user_product_id=${encodeURIComponent(userProductId)}`,
  );
  if (!response.ok) throw new Error(response.error || 'Consulta da família falhou');
  const ids = (response.data?.results || []).map(upper).filter(Boolean);
  if (!ids.length) return false;
  const live = await fetchLiveItems(ids);
  return ids.some((id) => Number(live.get(id)?.sold_quantity || 0) > 0);
}

const categoryMaxCache = new Map();
async function categoryMax(categoryId) {
  if (categoryMaxCache.has(categoryId)) return categoryMaxCache.get(categoryId);
  const response = await mlRequest(`/categories/${encodeURIComponent(categoryId)}`);
  if (!response.ok) throw new Error(response.error || `Categoria ${categoryId} indisponível`);
  const max = Number(response.data?.settings?.max_title_length || 60);
  categoryMaxCache.set(categoryId, max);
  return max;
}

async function loadLocalListings() {
  const { data, error } = await supabase.from('anuncios_ml')
    .select('ml_item_id,produto_id,sku,titulo,status,vendidos,visitas,catalogo')
    .in('ml_item_id', ROWS.map((row) => row.mlItemId));
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row) => [upper(row.ml_item_id), row]));
}

function auditRow(row, local, live) {
  return {
    sku: row.sku,
    ml_item_id: row.mlItemId,
    user_product_id: live?.user_product_id || null,
    proposed_title: row.proposedTitle,
    sanitized_family_name: row.familyName,
    old_family_name: live?.family_name || null,
    live_title: live?.title || null,
    local_status: local?.status || null,
    live_status: live?.status || null,
    live_sub_status: live?.sub_status || [],
    local_sold_quantity: Number(local?.vendidos ?? 0),
    live_sold_quantity: Number(live?.sold_quantity ?? 0),
    visits: Number(local?.visitas ?? 0),
    available_quantity: Number(live?.available_quantity ?? 0),
    catalog_listing: live?.catalog_listing === true,
    max_title_length: null,
  };
}

function summarize(report) {
  const blockedByReason = report.blocked.reduce((result, row) => {
    result[row.reason] = (result[row.reason] || 0) + 1;
    return result;
  }, {});
  return {
    input: ROWS.length,
    planned: report.planned.length,
    no_op: report.no_op.length,
    blocked: report.blocked.length,
    blocked_by_reason: blockedByReason,
    errors: report.errors.length,
    updated: report.updated.length,
    apply_errors: report.apply_errors?.length || 0,
  };
}

async function buildDryRun() {
  const localById = await loadLocalListings();
  const liveById = await fetchLiveItems(ROWS.map((row) => row.mlItemId));
  const me = await mlRequest('/users/me');
  if (!me.ok || !me.data?.id) throw new Error(`Conta ML indisponível: ${me.error || me.status}`);
  const sellerId = String(me.data.id);
  const report = {
    schema_version: 1,
    operation: 'OPERAÇÃO_RESGATE_V1',
    mode: 'dry_run',
    generated_at: new Date().toISOString(),
    config_hash: configHash,
    criteria: {
      local_status: 'ativo',
      live_status: 'active',
      sold_quantity: 0,
      visits_min: 1,
      available_quantity_min: 1,
      catalog_listing: false,
      user_product_without_sales: true,
      ascii: true,
      max_length_exclusive: 60,
      update_resource: 'PUT /items/{ITEM_ID}/family_name',
      unsupported_claims_removed: ['NF', 'Nova', 'Original', 'Premium', 'Qualidade'],
    },
    planned: [],
    no_op: [],
    blocked: [],
    errors: [],
    updated: [],
    apply_errors: [],
  };
  const processedUserProducts = new Set();

  for (const row of ROWS) {
    const local = localById.get(row.mlItemId);
    const live = liveById.get(row.mlItemId);
    const audit = auditRow(row, local, live);
    try {
      let reason = null;
      if (!local) reason = 'local_listing_missing';
      else if (!live) reason = 'live_listing_missing';
      else if (String(live.seller_id) !== sellerId || upper(local.sku) !== row.sku || sellerSku(live) !== row.sku) reason = 'sku_mismatch';
      else if (live.catalog_listing === true) reason = 'catalog_managed';
      else if (!text(live.user_product_id) || !text(live.family_name)) reason = 'not_user_product';
      else if (lower(local.status) !== 'ativo' || lower(live.status) !== 'active') reason = 'not_active';
      else if (Number(local.vendidos || 0) > 0 || Number(live.sold_quantity || 0) > 0) reason = 'listing_has_sales';
      else if (!(Number(local.visitas || 0) > 0)) reason = 'without_visits';
      else if (!(Number(live.available_quantity || 0) > 0)) reason = 'without_stock';
      if (reason) {
        report.blocked.push({ ...audit, reason });
        continue;
      }
      if (processedUserProducts.has(live.user_product_id)) {
        report.blocked.push({ ...audit, reason: 'user_product_already_planned' });
        continue;
      }
      if (await familyHasSales(sellerId, live.user_product_id)) {
        report.blocked.push({ ...audit, reason: 'user_product_has_sales' });
        continue;
      }
      const maxLength = await categoryMax(live.category_id);
      const completeAudit = { ...audit, max_title_length: maxLength };
      if (!TITLE_PATTERN.test(row.familyName) || row.familyName.length >= 60 || row.familyName.length > maxLength) {
        report.blocked.push({ ...completeAudit, reason: 'invalid_family_name' });
        continue;
      }
      if (normalizeFamilyName(live.family_name) === normalizeFamilyName(row.familyName)) {
        report.no_op.push({ ...completeAudit, reason: 'title_unchanged' });
        continue;
      }
      processedUserProducts.add(live.user_product_id);
      report.planned.push(completeAudit);
    } catch (error) {
      report.errors.push({ ...audit, stage: 'preflight', error: error.message });
    }
  }
  report.summary = summarize(report);
  return report;
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function readCurrentListing(itemId) {
  const { data, error } = await supabase.from('anuncios_ml')
    .select('ml_item_id,sku,titulo,status,vendidos,visitas,catalogo')
    .eq('ml_item_id', itemId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function applyPlan(plan, sellerId) {
  const local = await readCurrentListing(plan.ml_item_id);
  const live = (await fetchLiveItems([plan.ml_item_id])).get(plan.ml_item_id);
  if (!local || !live) throw new Error('revalidation:listing_missing');
  if (String(live.seller_id) !== sellerId || upper(local.sku) !== plan.sku || sellerSku(live) !== plan.sku) {
    throw new Error('revalidation:sku_mismatch');
  }
  if (live.catalog_listing === true) throw new Error('revalidation:catalog_managed');
  if (!text(live.user_product_id) || !text(live.family_name)) throw new Error('revalidation:not_user_product');
  if (lower(local.status) !== 'ativo' || lower(live.status) !== 'active') throw new Error('revalidation:not_active');
  if (Number(local.vendidos || 0) > 0 || Number(live.sold_quantity || 0) > 0) throw new Error('revalidation:listing_has_sales');
  if (!(Number(local.visitas || 0) > 0)) throw new Error('revalidation:without_visits');
  if (!(Number(live.available_quantity || 0) > 0)) throw new Error('revalidation:without_stock');
  if (await familyHasSales(sellerId, live.user_product_id)) throw new Error('revalidation:user_product_has_sales');
  const maxLength = await categoryMax(live.category_id);
  if (!TITLE_PATTERN.test(plan.sanitized_family_name) || plan.sanitized_family_name.length >= 60
    || plan.sanitized_family_name.length > maxLength) throw new Error('revalidation:invalid_family_name');
  const currentComparable = normalizeFamilyName(live.family_name);
  const oldComparable = normalizeFamilyName(plan.old_family_name);
  const newComparable = normalizeFamilyName(plan.sanitized_family_name);
  if (currentComparable !== oldComparable && currentComparable !== newComparable) {
    throw new Error('revalidation:title_changed_since_dry_run');
  }
  const alreadyApplied = currentComparable === newComparable;
  let verified = live;
  if (!alreadyApplied) {
    const request = buildFamilyNameUpdate(plan.ml_item_id, plan.sanitized_family_name);
    const update = await mlRequest(request.pathname, { method: 'PUT', body: request.body });
    if (!update.ok) throw new Error(`ML HTTP ${update.status}: ${update.error}`);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await sleep(attempt === 0 ? 600 : 1000);
      verified = (await fetchLiveItems([plan.ml_item_id])).get(plan.ml_item_id);
      if (normalizeFamilyName(verified?.family_name) === newComparable && text(verified?.title)) break;
    }
  }
  if (!verified || normalizeFamilyName(verified.family_name) !== newComparable || !text(verified.title)
    || lower(verified.status) !== 'active' || Number(verified.sold_quantity || 0) !== 0) {
    throw new Error('final_verification_failed');
  }
  const { data, error } = await supabase.from('anuncios_ml').update({
    titulo: verified.title,
    updated_at: new Date().toISOString(),
  }).eq('ml_item_id', plan.ml_item_id).select('ml_item_id,titulo').maybeSingle();
  if (error || !data || data.titulo !== verified.title) {
    throw new Error(`ML atualizado, ERP falhou: ${error?.message || 'verification_failed'}`);
  }
  return {
    ...plan,
    verified_family_name: verified.family_name,
    verified_title: verified.title,
    verified_local_title: data.titulo,
    already_applied_at_apply: alreadyApplied,
    applied_at: new Date().toISOString(),
  };
}

async function applyReport() {
  if (!fs.existsSync(REPORT_PATH)) throw new Error('Execute dry-run antes do --apply');
  const previous = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (!['dry_run', 'apply'].includes(previous.mode) || previous.schema_version !== 1
    || previous.config_hash !== configHash) throw new Error('Dry-run ausente ou desatualizado');
  const me = await mlRequest('/users/me');
  if (!me.ok || !me.data?.id) throw new Error(`Conta ML indisponível: ${me.error || me.status}`);
  const report = previous.mode === 'apply' ? previous : {
    ...previous,
    mode: 'apply',
    dry_run_generated_at: previous.generated_at,
    generated_at: new Date().toISOString(),
    updated: [],
    apply_errors: [],
  };
  const completed = new Set([
    ...report.updated.map((row) => row.ml_item_id),
    ...report.apply_errors.map((row) => row.ml_item_id),
  ]);
  let consecutiveErrors = 0;
  for (const plan of report.planned.filter((row) => !completed.has(row.ml_item_id))) {
    try {
      const updated = await applyPlan(plan, String(me.data.id));
      report.updated.push(updated);
      consecutiveErrors = 0;
      console.log(`[ok] ${plan.sku} ${plan.ml_item_id}`);
    } catch (error) {
      report.apply_errors.push({ sku: plan.sku, ml_item_id: plan.ml_item_id, error: error.message });
      consecutiveErrors += 1;
      console.log(`[fail] ${plan.sku} ${plan.ml_item_id} ${error.message}`);
    }
    report.generated_at = new Date().toISOString();
    report.summary = summarize(report);
    writeReport(report);
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
    await sleep(500);
  }
  report.generated_at = new Date().toISOString();
  report.summary = summarize(report);
  writeReport(report);
  return report;
}

(async () => {
  const report = APPLY ? await applyReport() : await buildDryRun();
  writeReport(report);
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.errors.length > 0 || report.apply_errors.length > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
