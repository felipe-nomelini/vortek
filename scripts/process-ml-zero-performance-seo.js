/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  buildPlainTextDescription,
  buildStructuredOutputSchema,
  descriptionNeedsOptimization,
  factualAttributes,
  normalize,
  sanitizeTitle,
  sanitizeGeneratedDescription,
  validateEvidenceTitle,
} = require('./lib/ml-zero-performance-seo');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const REFRESH_DESCRIPTIONS = process.argv.includes('--refresh-descriptions');
const ROOT = path.resolve('reports/ml-seo-zero-performance-2026-08-13');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const REPORT_PATH = path.join(ROOT, 'report.json');
const MAX_CONSECUTIVE_ERRORS = 5;
const OPENROUTER_BASE_URL = String(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const ROWS = manifest.rows || [];
const configHash = crypto.createHash('sha256').update(JSON.stringify(ROWS)).digest('hex');
if (ROWS.length !== manifest.input_count || new Set(ROWS.map((row) => row.ml_item_id)).size !== ROWS.length) {
  throw new Error('Manifesto inválido ou com MLB duplicado');
}
if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY indisponível');

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

async function getIntegration() {
  const { data, error } = await supabase.from('integracoes')
    .select('access_token,refresh_token,token_expires_at,client_id,client_secret')
    .eq('tipo', 'mercadolivre').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error(`Integração ML indisponível: ${error?.message || 'sem registro'}`);
  return data;
}

let mlToken = null;
async function getMlToken(forceRefresh = false) {
  if (mlToken && !forceRefresh) return mlToken;
  const integration = await getIntegration();
  if (!forceRefresh && integration.access_token
    && new Date(integration.token_expires_at || 0).getTime() > Date.now() + 60_000) {
    await assertAllowedMercadoLivreToken(integration.access_token, 'zero-performance-seo:cached');
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
  await assertAllowedMercadoLivreToken(payload.access_token, 'zero-performance-seo:refresh');
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
      signal: AbortSignal.timeout(options.timeoutMs || 25_000),
    });
  } catch (error) {
    if (attempt < 3) { await sleep(750 * attempt); return mlRequest(pathname, options, attempt + 1); }
    return { ok: false, status: 0, data: null, error: error.message };
  }
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (response.status === 401 && attempt === 1) return mlRequest(pathname, { ...options, forceRefresh: true }, 2);
  if ([408, 409, 424, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
    await sleep(1000 * attempt); return mlRequest(pathname, options, attempt + 1);
  }
  return { ok: response.ok, status: response.status, data, error: response.ok ? null : text(data?.message || data?.error || raw) };
}

function sellerSku(item) {
  const attr = (item?.attributes || []).find((row) => upper(row?.id) === 'SELLER_SKU');
  return upper(item?.seller_sku || item?.seller_custom_field || attr?.value_name || attr?.value_id);
}

function isUserProduct(item) {
  return Boolean(text(item?.family_name) || (item?.tags || []).map(lower).includes('user_product_listing'));
}

async function fetchLiveItems(ids) {
  const result = new Map();
  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const response = await mlRequest(`/items/bulk?ids=${batch.map(encodeURIComponent).join(',')}&attributes=body.title,body.family_name,body.user_product_id,body.seller_id,body.seller_sku,body.seller_custom_field,body.attributes,body.status,body.sub_status,body.sold_quantity,body.available_quantity,body.catalog_listing,body.catalog_product_id,body.category_id,body.domain_id,body.tags,body.start_time,body.price,body.currency_id,body.buying_mode,body.condition,body.listing_type_id,body.sale_terms,body.pictures`);
    if (!response.ok || !Array.isArray(response.data)) throw new Error(response.error || 'Consulta de anúncios falhou');
    for (const row of response.data) {
      const id = upper(row?.id);
      if (id) result.set(id, row.status_code === 200 && row.body ? { ...row.body, id } : null);
    }
  }
  return result;
}

async function liveVisits(item) {
  const start = new Date(item?.start_time || Date.now() - 365 * 86400000);
  const from = Number.isFinite(start.getTime()) ? start.toISOString().slice(0, 10) : new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const response = await mlRequest(`/items/${encodeURIComponent(item.id)}/visits?date_from=${from}&date_to=${to}`);
  if (!response.ok) throw new Error(`visits_http_${response.status}:${response.error}`);
  const rows = Array.isArray(response.data) ? response.data
    : Array.isArray(response.data?.results) ? response.data.results : [response.data];
  const row = rows.find((entry) => upper(entry?.item_id || entry?.id) === upper(item.id)) || rows[0] || {};
  const count = Number(row.total_visits ?? row.visits ?? row.quantity ?? 0);
  if (!Number.isFinite(count)) throw new Error('visits_invalid_response');
  return Math.max(0, Math.trunc(count));
}

async function familyHasSales(item) {
  if (!item?.user_product_id) return Number(item?.sold_quantity || 0) > 0;
  const response = await mlRequest(`/users/${encodeURIComponent(item.seller_id)}/items/search?user_product_id=${encodeURIComponent(item.user_product_id)}`);
  if (!response.ok) throw new Error(response.error || 'Consulta da família falhou');
  const ids = (response.data?.results || []).map(upper).filter(Boolean);
  if (!ids.length) return false;
  const live = await fetchLiveItems(ids);
  return ids.some((id) => Number(live.get(id)?.sold_quantity || 0) > 0);
}

async function loadLocalListings() {
  const rows = [];
  for (let index = 0; index < ROWS.length; index += 150) {
    const { data, error } = await supabase.from('anuncios_ml').select(`
      ml_item_id,produto_id,sku,titulo,status,vendidos,visitas,catalogo,qualidade,
      produtos(id,sku,nome,marca,gtin,descricao,estoque,fornecedor)
    `).in('ml_item_id', ROWS.slice(index, index + 150).map((row) => row.ml_item_id));
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return new Map(rows.map((row) => [upper(row.ml_item_id), row]));
}

const categoryCache = new Map();
async function categorySchema(categoryId) {
  if (categoryCache.has(categoryId)) return categoryCache.get(categoryId);
  const [category, attributes] = await Promise.all([
    mlRequest(`/categories/${encodeURIComponent(categoryId)}`),
    mlRequest(`/categories/${encodeURIComponent(categoryId)}/attributes`),
  ]);
  if (!category.ok || !attributes.ok || !Array.isArray(attributes.data)) {
    throw new Error(`category_schema_failed:${category.error || attributes.error}`);
  }
  const result = {
    maxTitleLength: Number(category.data?.settings?.max_title_length || 60),
    attributes: attributes.data,
  };
  categoryCache.set(categoryId, result);
  return result;
}

async function conditionalAttributes(item, description) {
  const response = await mlRequest(`/categories/${encodeURIComponent(item.category_id)}/attributes/conditional`, {
    method: 'POST',
    body: {
      title: item.title,
      category_id: item.category_id,
      price: item.price,
      currency_id: item.currency_id,
      available_quantity: item.available_quantity,
      buying_mode: item.buying_mode,
      condition: item.condition,
      listing_type_id: item.listing_type_id,
      description: { plain_text: description },
      sale_terms: item.sale_terms || [],
      pictures: (item.pictures || []).map((picture) => ({ id: picture.id })),
      attributes: item.attributes || [],
    },
  });
  if (!response.ok) return { ok: false, required: [], error: response.error, status: response.status };
  return { ok: true, required: response.data?.required_attributes || [], error: null, status: response.status };
}

function fitTitle(value, maxLength) {
  const words = sanitizeTitle(value).split(' ').filter(Boolean);
  while (words.join(' ').length > Math.min(60, maxLength) && words.length > 1) words.pop();
  return words.join(' ');
}

async function askSeoTitle({ row, item, product, maxLength, evidence }) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.1,
      provider: { require_parameters: true },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'ml_seo_title', strict: true, schema: buildStructuredOutputSchema() },
      },
      messages: [
        { role: 'system', content: 'Você otimiza título factual do Mercado Livre. Responda somente JSON do schema. Nunca invente especificações.' },
        { role: 'user', content: [
          `SKU: ${row.sku}`,
          `Título atual: ${item.title}`,
          `Nome ERP: ${product?.nome || ''}`,
          `Marca ERP: ${product?.marca || ''}`,
          `Máximo: ${Math.min(60, maxLength)} caracteres`,
          'Use Produto Marca Modelo Especificação. Sem símbolos. Sem termos promocionais, Original, Novo, Kit, Garantia, NF ou entrega.',
          'Só use palavras presentes nas evidências. Sinônimos permitidos: AA Pequena, AAA Palito e bateria moeda para CR2016 CR2025 CR2032.',
          `Evidências: ${evidence.slice(0, 5000)}`,
        ].join('\n') },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${text(payload?.error?.message || payload?.error)}`);
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  if (!parsed?.optimized_title) throw new Error('OpenRouter sem título estruturado');
  return { ...parsed, usage: payload.usage || null };
}

function supportedAttributeUpdates(item, product, definitions) {
  const byId = new Map(definitions.map((row) => [upper(row.id), row]));
  return factualAttributes(item, product).flatMap((candidate) => {
    const definition = byId.get(candidate.id);
    if (!definition || definition.tags?.read_only || definition.tags?.fixed) return [];
    if (definition.value_type === 'list') {
      const match = (definition.values || []).find((value) => normalize(value.name) === normalize(candidate.value_name));
      return match ? [{ id: candidate.id, value_id: match.id }] : [];
    }
    return [candidate];
  });
}

async function categorySuggestions(title) {
  const response = await mlRequest(`/sites/MLB/domain_discovery/search?limit=3&q=${encodeURIComponent(title)}`);
  return response.ok && Array.isArray(response.data)
    ? response.data.map((row) => ({ category_id: row.category_id, category_name: row.category_name, domain_id: row.domain_id }))
    : [];
}

function reportSummary(report) {
  const blockedByReason = report.blocked.reduce((result, row) => {
    result[row.reason] = (result[row.reason] || 0) + 1;
    return result;
  }, {});
  return {
    input: ROWS.length,
    planned: report.planned.length,
    blocked: report.blocked.length,
    blocked_by_reason: blockedByReason,
    errors: report.errors.length,
    updated: report.updated.length,
    partial: report.partial.length,
    apply_errors: report.apply_errors.length,
  };
}

function writeReport(report) {
  fs.mkdirSync(ROOT, { recursive: true });
  report.summary = reportSummary(report);
  const temporaryPath = `${REPORT_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporaryPath, REPORT_PATH);
}

function refreshDescriptions() {
  if (!fs.existsSync(REPORT_PATH)) throw new Error('Relatório dry-run ausente');
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (report.mode !== 'dry_run' || report.config_hash !== configHash) throw new Error('Relatório dry-run incompatível');
  for (const plan of report.planned) {
    if (!descriptionNeedsOptimization(plan.old_description)) {
      plan.new_description = plan.old_description;
      plan.description_changed = false;
      plan.description_reason = 'existing_description_preserved';
      continue;
    }
    plan.new_description = sanitizeGeneratedDescription(plan.new_description, plan.sku);
    plan.description_changed = normalize(plan.old_description) !== normalize(plan.new_description);
    plan.description_reason = 'weak_description_rebuilt_from_verified_attributes';
  }
  report.generated_at = new Date().toISOString();
  writeReport(report);
  return report;
}

async function buildDryRun() {
  const local = await loadLocalListings();
  const live = await fetchLiveItems(ROWS.map((row) => row.ml_item_id));
  const me = await mlRequest('/users/me');
  if (!me.ok || !me.data?.id) throw new Error('Conta ML indisponível');
  const previous = RESUME && fs.existsSync(REPORT_PATH)
    ? JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
    : null;
  const report = previous?.mode === 'dry_run' && previous.config_hash === configHash
    ? {
        ...previous,
        generated_at: new Date().toISOString(),
        blocked: previous.blocked.filter((row) => row.reason !== 'title_forbidden_term'),
      }
    : {
    schema_version: 1,
    operation: manifest.operation,
    mode: 'dry_run',
    generated_at: new Date().toISOString(),
    config_hash: configHash,
    model: OPENROUTER_MODEL,
    criteria: { closed_manifest: true, active: true, sold: 0, visits: 0, stock_min: 1, catalog_excluded: true },
        planned: [], blocked: [], errors: [], updated: [], partial: [], apply_errors: [],
      };
  const completedIds = new Set([
    ...report.planned.map((row) => row.ml_item_id),
    ...report.blocked.map((row) => row.ml_item_id),
    ...report.errors.map((row) => row.ml_item_id),
  ]);
  const processedFamilies = new Set(report.planned.map((row) => row.user_product_id).filter(Boolean));

  for (let index = 0; index < ROWS.length; index += 1) {
    const row = ROWS[index];
    if (completedIds.has(row.ml_item_id)) continue;
    const listing = local.get(row.ml_item_id);
    const item = live.get(row.ml_item_id);
    const product = Array.isArray(listing?.produtos) ? listing.produtos[0] : listing?.produtos;
    const audit = {
      sequence: index + 1, sku: row.sku, ml_item_id: row.ml_item_id,
      local_status: listing?.status || null, live_status: item?.status || null,
      local_sold: Number(listing?.vendidos ?? 0), live_sold: Number(item?.sold_quantity ?? 0),
      local_visits: Number(listing?.visitas ?? 0), live_visits: null,
      available_quantity: Number(item?.available_quantity ?? 0), catalog_listing: item?.catalog_listing === true,
      category_id: item?.category_id || null, user_product_id: item?.user_product_id || null,
    };
    try {
      let reason = null;
      if (!listing) reason = 'local_listing_missing';
      else if (!item) reason = 'live_listing_missing';
      else if (String(item.seller_id) !== String(me.data.id) || upper(listing.sku) !== row.sku || sellerSku(item) !== row.sku) reason = 'sku_mismatch';
      else if (item.catalog_listing === true) reason = 'catalog_managed';
      else if (lower(listing.status) !== 'ativo' || lower(item.status) !== 'active') reason = 'not_active';
      else if (Number(listing.vendidos || 0) !== 0 || Number(item.sold_quantity || 0) !== 0) reason = 'has_sales';
      else if (Number(listing.visitas || 0) !== 0) reason = 'has_local_visits';
      else if (!(Number(item.available_quantity || 0) > 0) || !(Number(product?.estoque || 0) > 0)) reason = 'without_stock';
      if (reason) { report.blocked.push({ ...audit, reason }); writeReport(report); continue; }

      audit.live_visits = await liveVisits(item);
      if (audit.live_visits !== 0) { report.blocked.push({ ...audit, reason: 'has_live_visits' }); writeReport(report); continue; }
      if (isUserProduct(item)) {
        if (processedFamilies.has(item.user_product_id)) { report.blocked.push({ ...audit, reason: 'family_already_planned' }); writeReport(report); continue; }
        if (await familyHasSales(item)) { report.blocked.push({ ...audit, reason: 'family_has_sales' }); writeReport(report); continue; }
      }

      const descriptionResult = await mlRequest(`/items/${encodeURIComponent(item.id)}/description`);
      const oldDescription = descriptionResult.ok ? text(descriptionResult.data?.plain_text) : '';
      const schema = await categorySchema(item.category_id);
      const conditional = await conditionalAttributes(item, oldDescription);
      const definitions = new Map(schema.attributes.map((definition) => [upper(definition.id), definition]));
      const evidence = [
        item.title, item.family_name, product?.nome, product?.marca, product?.gtin,
        product?.descricao,
        ...(item.attributes || []).map((attribute) => `${attribute.name || attribute.id} ${attribute.value_name || ''}`),
      ].filter(Boolean).join('\n');
      let ai = null;
      let newTitle = '';
      try {
        ai = await askSeoTitle({ row, item, product, maxLength: schema.maxTitleLength, evidence });
        newTitle = fitTitle(ai.optimized_title, schema.maxTitleLength);
      } catch (error) {
        ai = { error: error.message, fallback: true, primary_keywords: [], rationale: 'fallback determinístico' };
        newTitle = fitTitle(item.family_name || item.title, schema.maxTitleLength);
      }
      let validation = validateEvidenceTitle(newTitle, evidence, schema.maxTitleLength);
      if (!validation.ok) {
        newTitle = fitTitle(item.family_name || item.title, schema.maxTitleLength);
        validation = validateEvidenceTitle(newTitle, evidence, schema.maxTitleLength);
      }
      if (!validation.ok) { report.blocked.push({ ...audit, reason: validation.reason, validation, ai }); writeReport(report); continue; }

      const attributeUpdates = supportedAttributeUpdates(item, product, schema.attributes);
      const descriptionAttributes = [...(item.attributes || []), ...attributeUpdates].map((attribute) => ({
        ...attribute,
        name: attribute.name || definitions.get(upper(attribute.id))?.name || attribute.id,
      }));
      const newDescription = buildPlainTextDescription({
        productName: product?.nome || newTitle,
        sku: row.sku,
        attributes: descriptionAttributes,
      });
      const predictions = await categorySuggestions(newTitle);
      const planned = {
        ...audit,
        title_mode: isUserProduct(item) ? 'family_name' : 'title',
        old_editable_title: isUserProduct(item) ? item.family_name : item.title,
        new_editable_title: newTitle,
        old_description: oldDescription,
        new_description: newDescription,
        description_changed: normalize(oldDescription) !== normalize(newDescription),
        attribute_updates: attributeUpdates,
        conditional_required_attributes: conditional.required,
        conditional_audit_error: conditional.error,
        category_suggestions: predictions,
        category_change: null,
        category_reason: predictions[0]?.category_id === item.category_id ? 'predictor_confirms_current' : 'prediction_not_conclusive_no_auto_change',
        evidence: { product_name: product?.nome || null, brand: product?.marca || null, gtin: product?.gtin || null },
        ai: { primary_keywords: ai.primary_keywords || [], rationale: ai.rationale || null, usage: ai.usage || null, fallback: ai.fallback || false },
        product_id: listing.produto_id,
        local_product_description_empty: !text(product?.descricao),
      };
      const titleChanged = normalize(planned.old_editable_title) !== normalize(planned.new_editable_title);
      if (!titleChanged && !planned.description_changed && !attributeUpdates.length) {
        report.blocked.push({ ...planned, reason: 'no_changes' });
      } else {
        report.planned.push(planned);
        if (item.user_product_id) processedFamilies.add(item.user_product_id);
      }
    } catch (error) {
      report.errors.push({ ...audit, stage: 'preflight', error: error.message });
    }
    writeReport(report);
    console.log(`[${index + 1}/${ROWS.length}] ${row.sku} planned=${report.planned.length} blocked=${report.blocked.length} errors=${report.errors.length}`);
    await sleep(120);
  }
  writeReport(report);
  return report;
}

function attributeMatches(item, expected) {
  const actual = (item?.attributes || []).find((row) => upper(row.id) === upper(expected.id));
  if (!actual) return false;
  if (expected.value_id) return String(actual.value_id || '') === String(expected.value_id);
  return normalize(actual.value_name) === normalize(expected.value_name);
}

async function fetchSingle(itemId) {
  const result = await mlRequest(`/items/${encodeURIComponent(itemId)}?include_attributes=all&include_internal_attributes=true`);
  if (!result.ok || !result.data) throw new Error(`item_read_failed:${result.status}:${result.error}`);
  return result.data;
}

async function currentLocal(itemId) {
  const { data, error } = await supabase.from('anuncios_ml').select('ml_item_id,produto_id,sku,status,vendidos,visitas,produtos(id,descricao,estoque)').eq('ml_item_id', itemId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function applyOne(plan, sellerId) {
  const listing = await currentLocal(plan.ml_item_id);
  let item = await fetchSingle(plan.ml_item_id);
  const product = Array.isArray(listing?.produtos) ? listing.produtos[0] : listing?.produtos;
  if (!listing || !item) throw new Error('revalidation:listing_missing');
  if (String(item.seller_id) !== sellerId || upper(listing.sku) !== plan.sku || sellerSku(item) !== plan.sku) throw new Error('revalidation:sku_mismatch');
  if (item.catalog_listing === true) throw new Error('revalidation:catalog_managed');
  if (lower(listing.status) !== 'ativo' || lower(item.status) !== 'active') throw new Error('revalidation:not_active');
  if (Number(listing.vendidos || 0) !== 0 || Number(item.sold_quantity || 0) !== 0) throw new Error('revalidation:has_sales');
  if (Number(listing.visitas || 0) !== 0 || await liveVisits(item) !== 0) throw new Error('revalidation:has_visits');
  if (!(Number(item.available_quantity || 0) > 0) || !(Number(product?.estoque || 0) > 0)) throw new Error('revalidation:without_stock');
  if (isUserProduct(item) && await familyHasSales(item)) throw new Error('revalidation:family_has_sales');
  if (item.category_id !== plan.category_id) throw new Error('revalidation:category_changed');
  const currentEditable = isUserProduct(item) ? item.family_name : item.title;
  const expectedMode = isUserProduct(item) ? 'family_name' : 'title';
  if (expectedMode !== plan.title_mode) throw new Error('revalidation:title_model_changed');
  if (![normalize(plan.old_editable_title), normalize(plan.new_editable_title)].includes(normalize(currentEditable))) {
    throw new Error('revalidation:title_changed_since_dry_run');
  }

  const steps = {};
  if (normalize(currentEditable) !== normalize(plan.new_editable_title)) {
    const result = await mlRequest(
      expectedMode === 'family_name' ? `/items/${encodeURIComponent(plan.ml_item_id)}/family_name` : `/items/${encodeURIComponent(plan.ml_item_id)}`,
      { method: 'PUT', body: expectedMode === 'family_name' ? { family_name: plan.new_editable_title } : { title: plan.new_editable_title } },
    );
    steps.title = { ok: result.ok, status: result.status, error: result.error };
  } else steps.title = { ok: true, skipped: true };

  if (plan.attribute_updates.length) {
    const result = await mlRequest(`/items/${encodeURIComponent(plan.ml_item_id)}`, { method: 'PUT', body: { attributes: plan.attribute_updates } });
    steps.attributes = { ok: result.ok, status: result.status, error: result.error };
  } else steps.attributes = { ok: true, skipped: true };

  if (plan.description_changed) {
    const result = await mlRequest(`/items/${encodeURIComponent(plan.ml_item_id)}/description?api_version=2`, {
      method: 'PUT', body: { plain_text: plan.new_description },
    });
    steps.description = { ok: result.ok, status: result.status, error: result.error };
  } else steps.description = { ok: true, skipped: true };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(attempt === 0 ? 650 : 1000);
    item = await fetchSingle(plan.ml_item_id);
    const editable = expectedMode === 'family_name' ? item.family_name : item.title;
    if (normalize(editable) === normalize(plan.new_editable_title)
      && plan.attribute_updates.every((attribute) => attributeMatches(item, attribute))) break;
  }
  const description = await mlRequest(`/items/${encodeURIComponent(plan.ml_item_id)}/description`);
  const titleVerified = normalize(expectedMode === 'family_name' ? item.family_name : item.title) === normalize(plan.new_editable_title);
  const attributesVerified = plan.attribute_updates.every((attribute) => attributeMatches(item, attribute));
  const descriptionVerified = !plan.description_changed || normalize(description.data?.plain_text) === normalize(plan.new_description);
  const verified = titleVerified && attributesVerified && descriptionVerified && lower(item.status) === 'active';

  if (titleVerified) {
    const { data, error } = await supabase.from('anuncios_ml').update({ titulo: item.title, updated_at: new Date().toISOString() })
      .eq('ml_item_id', plan.ml_item_id).select('ml_item_id,titulo').maybeSingle();
    steps.database_title = { ok: !error && data?.titulo === item.title, error: error?.message || null };
  }
  if (descriptionVerified && plan.local_product_description_empty) {
    const { data, error } = await supabase.from('produtos').update({ descricao: plan.new_description, updated_at: new Date().toISOString() })
      .eq('id', plan.product_id).select('id,descricao').maybeSingle();
    steps.database_description = { ok: !error && data?.descricao === plan.new_description, error: error?.message || null };
  } else steps.database_description = { ok: true, skipped: true, reason: 'existing_product_description_preserved' };

  return {
    ...plan,
    status: verified ? 'updated' : 'partial',
    verified_title: item.title,
    verified_family_name: item.family_name || null,
    title_verified: titleVerified,
    attributes_verified: attributesVerified,
    description_verified: descriptionVerified,
    steps,
    applied_at: new Date().toISOString(),
  };
}

async function applyReport() {
  if (!fs.existsSync(REPORT_PATH)) throw new Error('Execute dry-run antes do --apply');
  const previous = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (!['dry_run', 'apply'].includes(previous.mode) || previous.schema_version !== 1 || previous.config_hash !== configHash) {
    throw new Error('Dry-run ausente ou desatualizado');
  }
  const me = await mlRequest('/users/me');
  if (!me.ok || !me.data?.id) throw new Error('Conta ML indisponível');
  const report = previous.mode === 'apply' ? previous : {
    ...previous, mode: 'apply', dry_run_generated_at: previous.generated_at,
    generated_at: new Date().toISOString(), updated: [], partial: [], apply_errors: [],
  };
  const completed = new Set([...report.updated, ...report.partial, ...report.apply_errors].map((row) => row.ml_item_id));
  let consecutiveErrors = 0;
  for (const plan of report.planned.filter((row) => !completed.has(row.ml_item_id))) {
    try {
      const result = await applyOne(plan, String(me.data.id));
      report[result.status === 'updated' ? 'updated' : 'partial'].push(result);
      consecutiveErrors = result.status === 'updated' ? 0 : consecutiveErrors + 1;
      console.log(`[${result.status}] ${plan.sku} ${plan.ml_item_id}`);
    } catch (error) {
      report.apply_errors.push({ sku: plan.sku, ml_item_id: plan.ml_item_id, error: error.message });
      consecutiveErrors += 1;
      console.log(`[error] ${plan.sku} ${plan.ml_item_id} ${error.message}`);
    }
    report.generated_at = new Date().toISOString();
    writeReport(report);
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
    await sleep(400);
  }
  writeReport(report);
  return report;
}

(async () => {
  const report = REFRESH_DESCRIPTIONS ? refreshDescriptions() : APPLY ? await applyReport() : await buildDryRun();
  writeReport(report);
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.errors.length || report.apply_errors.length || report.partial.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
