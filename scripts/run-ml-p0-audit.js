#!/usr/bin/env node
/* AUDIT ONLY: este processo nunca cria, altera ou vincula anúncios. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  buildContent,
  calculatePrice,
  evidenceSnippet,
  identityTokens,
  isSensitive,
  isValidGtin,
  normalizeGtin,
  plain,
  reconcileOfficial,
  scoreAudit,
  stripHtml,
  text,
} = require('./lib/ml-p0-audit');

dotenv.config({ path: '.env.local' });

const JOB_ID = process.env.ML_P0_JOB_ID || process.argv.find((arg) => arg.startsWith('--job='))?.split('=')[1] || '';
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.ML_P0_CONCURRENCY || 3)));
const RUN_LIMIT = Math.max(0, Number(process.env.ML_P0_LIMIT || 0));
const REPORT_ROOT = path.join(process.cwd(), 'reports', 'ml-p0-audit');
const EXPECTED = { total: 501, bySupplier: { '2': 103, '108': 123, '133': 275 } };
const SUPPLIER_NAMES = { '2': 'Hayamax', '108': 'BKR1', '133': 'Evolusom' };
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';

if (!JOB_ID) throw new Error('Informe --job=<uuid> ou ML_P0_JOB_ID.');
if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY indisponível.');

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const categoryAttributesCache = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

async function fetchJson(url, options = {}, label = 'request', attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeout || 30000));
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const bodyText = await response.text();
      let body = null;
      try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        const error = new Error(`${label}_http_${response.status}`);
        error.status = response.status;
        error.body = body;
        if (retryable && attempt < attempts) {
          await sleep(500 * attempt);
          continue;
        }
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts && (error.name === 'AbortError' || !error.status || error.status >= 500 || error.status === 429)) {
        await sleep(500 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function loadAll(table, select, filters = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(select).range(from, from + 999);
    query = filters(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function loadContext() {
  const [jobResult, snapshots, integrations] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', JOB_ID).single(),
    loadAll('ml_p0_population_snapshots', '*', (query) => query.eq('job_id', JOB_ID).order('sku')),
    supabase.from('integracoes').select('tipo,url,access_token,conectado,token_expires_at').in('tipo', ['dslite', 'mercadolivre']),
  ]);
  if (jobResult.error) throw new Error(jobResult.error.message);
  if (integrations.error) throw new Error(integrations.error.message);
  const distribution = snapshots.reduce((acc, row) => ({ ...acc, [row.fornecedor_id]: (acc[row.fornecedor_id] || 0) + 1 }), {});
  const mismatch = snapshots.length !== EXPECTED.total || Object.entries(EXPECTED.bySupplier).some(([id, total]) => distribution[id] !== total);
  if (mismatch) throw new Error(`P0_BASELINE_MISMATCH total=${snapshots.length} distribution=${JSON.stringify(distribution)}`);
  const loggedCapture = (jobResult.data.log || []).find((event) => event.event === 'p0_population_captured');
  if (!loggedCapture?.sha256) throw new Error('baseline_sha256_missing');
  const byType = Object.fromEntries((integrations.data || []).map((row) => [row.tipo, row]));
  if (!byType.dslite?.conectado || !byType.dslite?.url || !byType.dslite?.access_token) throw new Error('dslite_config_missing');
  if (!byType.mercadolivre?.conectado || !byType.mercadolivre?.access_token) throw new Error('ml_config_missing');
  const account = await assertAllowedMercadoLivreToken(byType.mercadolivre.access_token, 'ml-p0-audit');
  return { job: jobResult.data, snapshots, distribution, hash: loggedCapture.sha256, integrations: byType, account };
}

async function seedAudits(snapshots) {
  const existing = await loadAll('ml_p0_publication_audits', 'produto_id', (query) => query.eq('job_id', JOB_ID));
  const existingIds = new Set(existing.map((row) => row.produto_id));
  const missing = snapshots.filter((row) => !existingIds.has(row.produto_id)).map((row) => ({
    job_id: JOB_ID,
    population_snapshot_id: row.id,
    produto_id: row.produto_id,
    sku: row.sku,
    fornecedor_id: row.fornecedor_id,
    fornecedor_nome: SUPPLIER_NAMES[row.fornecedor_id] || row.fornecedor_nome,
    publication_action: 'none',
    level0_snapshot: row.snapshot,
    event_log: [{ event: 'audit_seeded', timestamp: now() }],
  }));
  for (let index = 0; index < missing.length; index += 100) {
    const { error } = await supabase.from('ml_p0_publication_audits').insert(missing.slice(index, index + 100));
    if (error) throw new Error(`audit_seed: ${error.message}`);
  }
}

function snapshotProduct(row) { return row.snapshot?.produto || {}; }
function snapshotOffer(row) { return row.snapshot?.oferta_preferencial || {}; }

async function loadLiveRows(snapshots) {
  const productIds = snapshots.map((row) => row.produto_id);
  const offerIds = snapshots.map((row) => row.oferta_preferencial_id);
  const products = [];
  const offers = [];
  for (let i = 0; i < productIds.length; i += 100) {
    const [p, o] = await Promise.all([
      supabase.from('produtos').select('*').in('id', productIds.slice(i, i + 100)),
      supabase.from('produto_fornecedor_ofertas').select('*').in('id', offerIds.slice(i, i + 100)),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (o.error) throw new Error(o.error.message);
    products.push(...(p.data || []));
    offers.push(...(o.data || []));
  }
  return {
    products: new Map(products.map((row) => [row.id, row])),
    offers: new Map(offers.map((row) => [row.id, row])),
  };
}

function eligibilityDrift(snapshot, liveProduct, liveOffer) {
  const reasons = [];
  if (!liveProduct) reasons.push('produto_removido');
  if (!liveOffer) reasons.push('oferta_removida');
  if (liveProduct) {
    if (!liveProduct.ativo) reasons.push('produto_inativo');
    if (liveProduct.ml_status !== 'sem_anuncio') reasons.push(`ml_status_${liveProduct.ml_status}`);
    if (!(Number(liveProduct.estoque) > 0)) reasons.push('estoque_zerado');
    if (text(liveProduct.ml_shipping_warning)) reasons.push('ml_shipping_warning');
    if (text(liveProduct.ml_item_id)) reasons.push('ml_item_id_preenchido');
    if (liveProduct.oferta_preferencial_id !== snapshot.oferta_preferencial_id) reasons.push('oferta_preferencial_alterada');
  }
  if (liveOffer) {
    if (!liveOffer.ativo) reasons.push('oferta_inativa');
    if (!(Number(liveOffer.estoque) > 0)) reasons.push('oferta_sem_estoque');
    if (!(Number(liveOffer.custo) > 0)) reasons.push('oferta_sem_custo');
  }
  return { has_drift: reasons.length > 0, reasons, checked_at: now() };
}

async function fetchDslite(config, supplierId, productId) {
  const url = `${String(config.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${encodeURIComponent(supplierId)}/${encodeURIComponent(productId)}`;
  const raw = await fetchJson(url, { headers: { Token: config.access_token } }, 'dslite_catalog');
  const product = Array.isArray(raw?.produtos) ? raw.produtos.find((row) => String(row.produtoid) === String(productId)) || raw.produtos[0] : null;
  if (!product) throw new Error('dslite_product_not_found');
  return { url, raw, product };
}

function buildResearchQuery(product, dslite) {
  const parts = [normalizeGtin(dslite.ean11 || product.gtin), dslite.marca || product.marca, dslite.modelo, dslite.part_number, dslite.titulo || product.nome]
    .map(text).filter(Boolean);
  return `${parts.join(' ')} fabricante ficha técnica manual oficial -site:mercadolivre.com.br -site:amazon.com.br -site:shopee.com.br`.slice(0, 500);
}

async function researchOfficial(product, dslite) {
  const queriedAt = now();
  const payload = await fetchJson('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: buildResearchQuery(product, dslite),
      limit: 5,
      sources: ['web'],
      country: 'BR',
      timeout: 30000,
      scrapeOptions: { formats: [{ type: 'markdown' }], onlyMainContent: true, timeout: 15000 },
    }),
    timeout: 45000,
  }, 'firecrawl_search', 2);
  const rows = Array.isArray(payload?.data?.web) ? payload.data.web : [];
  return rows.map((row) => ({
    url: text(row.url || row.metadata?.sourceURL),
    domain: (() => { try { return new URL(row.url || row.metadata?.sourceURL).hostname; } catch { return ''; } })(),
    source_type: 'manufacturer_product_or_documentation_candidate',
    consulted_at: queriedAt,
    title: text(row.title || row.metadata?.title).slice(0, 300),
    description: text(row.description || row.metadata?.description).slice(0, 1000),
    content: text(row.markdown || row.content).slice(0, 12000),
  })).filter((row) => row.url);
}

function imageUrls(offer, dslite) {
  const result = [];
  const add = (url, source) => { if (text(url) && !result.some((row) => row.url === text(url))) result.push({ url: text(url), source }); };
  for (const item of Array.isArray(dslite.midias) ? dslite.midias : []) if (item.tipo === 'imagem') add(item.valor, 'dslite_live');
  add(dslite.link_imagem, 'dslite_live');
  const offerImages = Array.isArray(offer.imagens) ? offer.imagens : [];
  for (const item of offerImages) add(typeof item === 'string' ? item : item?.url || item?.src || item?.link, 'preferred_offer_snapshot');
  return result.slice(0, 8);
}

async function inspectImage(candidate) {
  const response = await fetch(candidate.url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!response.ok) return { ...candidate, approved: false, reason: `http_${response.status}` };
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return { ...candidate, approved: false, reason: `content_type_${type}` };
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > 12 * 1024 * 1024) return { ...candidate, approved: false, reason: 'image_too_large' };
  const metadata = await sharp(Buffer.from(arrayBuffer)).metadata();
  const approved = Number(metadata.width) >= 250 && Number(metadata.height) >= 250 && Math.max(metadata.width, metadata.height) >= 500;
  return {
    ...candidate,
    approved,
    reason: approved ? null : 'ml_minimum_dimensions_not_met',
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || null,
    bytes: arrayBuffer.byteLength,
    final_url: response.url,
  };
}

async function auditImages(candidates) {
  const checked = [];
  for (const candidate of candidates.slice(0, 3)) {
    try { checked.push(await inspectImage(candidate)); }
    catch (error) { checked.push({ ...candidate, approved: false, reason: error.name === 'TimeoutError' ? 'timeout' : text(error.message) }); }
    if (checked.some((row) => row.approved)) break;
  }
  return { approved: checked.some((row) => row.approved), checked, checked_at: now() };
}

async function mlGet(pathname, token, label) {
  return fetchJson(`https://api.mercadolibre.com${pathname}`, { headers: { Authorization: `Bearer ${token}` } }, label);
}

async function auditDuplicates(product, token, userId) {
  const local = await supabase.from('anuncios_ml').select('ml_item_id,sku,titulo,status').eq('sku', product.sku);
  if (local.error) throw new Error(`duplicate_local: ${local.error.message}`);
  const remoteIds = new Set();
  for (const parameter of ['sku', 'seller_sku']) {
    const result = await mlGet(`/users/${userId}/items/search?${parameter}=${encodeURIComponent(product.sku)}`, token, 'ml_duplicate_search');
    for (const id of result?.results || []) remoteIds.add(String(id));
  }
  const remote = [];
  for (const id of [...remoteIds].slice(0, 10)) {
    const item = await mlGet(`/items/${id}?include_attributes=all`, token, 'ml_duplicate_item');
    const skuValues = [item.seller_custom_field, ...(item.attributes || []).filter((a) => a.id === 'SELLER_SKU').map((a) => a.value_name)].map(text);
    remote.push({ id, title: item.title, status: item.status, sku_values: skuValues, exact_sku: skuValues.includes(product.sku), permalink: item.permalink });
  }
  return {
    checked_at: now(),
    local: local.data || [],
    remote,
    found: (local.data || []).length > 0 || remote.length > 0,
    exact_remote: remote.find((item) => item.exact_sku) || null,
  };
}

async function resolveCategory(product, dslite, token) {
  const gtin = normalizeGtin(dslite.ean11 || product.gtin);
  if (gtin) {
    const search = await mlGet(`/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(gtin)}`, token, 'ml_product_search');
    const exact = (search?.results || []).find((result) => (result.attributes || []).some((a) => a.id === 'GTIN' && normalizeGtin(a.value_name) === gtin));
    if (exact) {
      const detail = await mlGet(`/products/${exact.id}`, token, 'ml_product_detail');
      const categoryId = detail?.buy_box_winner?.item_id ? null : (detail?.category_id || exact?.settings?.listing_category_id || null);
      const inferredCategory = categoryId || String(exact.domain_id || '').replace(/^MLB-/, '');
      return { validated: Boolean(categoryId), method: 'exact_gtin_catalog', gtin, product_id: exact.id, domain_id: exact.domain_id, category_id: categoryId, catalog: detail };
    }
  }
  const query = encodeURIComponent(text(dslite.titulo || product.nome));
  const predictor = await mlGet(`/sites/MLB/domain_discovery/search?limit=3&q=${query}`, token, 'ml_category_predictor');
  const first = Array.isArray(predictor) ? predictor[0] : null;
  return { validated: Boolean(first?.category_id), method: 'title_predictor', gtin: gtin || null, category_id: first?.category_id || null, domain_id: first?.domain_id || null, suggestions: predictor || [] };
}

function attributesFromEvidence(product, dslite, categoryResult) {
  const values = new Map();
  const set = (id, value, source) => { if (text(value)) values.set(id, { id, value_name: text(value), source }); };
  set('BRAND', dslite.marca || product.marca, 'dslite_level_1');
  set('MODEL', dslite.modelo, 'dslite_level_1');
  set('MPN', dslite.part_number || dslite.id_produto_fabricante, 'dslite_level_1');
  set('GTIN', normalizeGtin(dslite.ean11 || product.gtin), 'dslite_level_1');
  if (categoryResult.method === 'exact_gtin_catalog') {
    for (const attribute of categoryResult.catalog?.attributes || []) {
      if (['BRAND', 'MODEL', 'MPN', 'GTIN'].includes(attribute.id) && text(attribute.value_name)) {
        const current = values.get(attribute.id);
        if (current && plain(current.value_name) === plain(attribute.value_name)) current.ml_catalog_confirmed = true;
      }
    }
  }
  return [...values.values()];
}

async function categorySchema(categoryId, token, preparedAttributes) {
  if (!categoryId) return { required_complete: false, missing: ['category_id'], prepared: preparedAttributes, required: [] };
  if (!categoryAttributesCache.has(categoryId)) {
    categoryAttributesCache.set(categoryId, await mlGet(`/categories/${categoryId}/attributes`, token, 'ml_category_attributes'));
  }
  const schema = categoryAttributesCache.get(categoryId) || [];
  const required = schema.filter((attribute) => attribute.tags?.required || attribute.tags?.conditional_required || attribute.tags?.catalog_required || attribute.tags?.catalog_child_required);
  const supplied = new Set(preparedAttributes.map((attribute) => attribute.id));
  const missing = required.filter((attribute) => !supplied.has(attribute.id)).map((attribute) => ({ id: attribute.id, name: attribute.name, tags: attribute.tags }));
  return {
    category_id: categoryId,
    required_complete: missing.length === 0,
    required: required.map((attribute) => ({ id: attribute.id, name: attribute.name, tags: attribute.tags })),
    missing,
    prepared: preparedAttributes,
    consulted_at: now(),
  };
}

function recursiveNumbers(value, keyName) {
  const found = [];
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    if (key === keyName && Number.isFinite(Number(child))) found.push(Number(child));
    else if (child && typeof child === 'object') found.push(...recursiveNumbers(child, keyName));
  }
  return found;
}

function dimensionsForShipping(product, dslite) {
  const height = Number(dslite.altura_embalagem || product.altura || 0);
  const width = Number(dslite.largura_embalagem || product.largura || 0);
  const length = Number(dslite.profundidade_embalagem || product.profundidade || 0);
  const kg = Number(dslite.peso_embalagem || product.peso_bruto || product.peso_liq || 0);
  if (![height, width, length, kg].every((value) => value > 0)) return null;
  return `${Math.ceil(height)}x${Math.ceil(width)}x${Math.ceil(length)},${Math.ceil(kg * 1000)}`;
}

async function simulatePricing(product, offer, dslite, categoryId, token, userId) {
  const dimensions = dimensionsForShipping(product, dslite);
  if (!dimensions) return { approved: false, reason: 'shipping_dimensions_missing', engine: 'src/services/pricing.ts' };
  const candidates = [];
  for (const listingType of ['gold_special', 'gold_pro']) {
    let rate = Number(product.ml_fee || 0.15);
    let shippingCost = 0;
    let calculation = calculatePrice({ cost: offer.custo, saleFeeRate: rate, shippingCost });
    let feeResponse = null;
    let shippingResponse = null;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const feeQuery = new URLSearchParams({ price: calculation.finalPrice.toFixed(2), listing_type_id: listingType, currency_id: 'BRL', logistic_type: 'drop_off', shipping_mode: 'me2' });
      if (categoryId) feeQuery.set('category_id', categoryId);
      feeResponse = await mlGet(`/sites/MLB/listing_prices?${feeQuery}`, token, 'ml_listing_prices');
      const feeRow = Array.isArray(feeResponse) ? feeResponse.find((row) => row.listing_type_id === listingType) || feeResponse[0] : feeResponse;
      rate = Number(feeRow?.sale_fee_amount || 0) / calculation.finalPrice;
      const shippingQuery = new URLSearchParams({ dimensions, verbose: 'true', item_price: calculation.finalPrice.toFixed(2), listing_type_id: listingType, mode: 'me2', condition: 'new', logistic_type: 'drop_off', free_shipping: 'true' });
      shippingResponse = await mlGet(`/users/${userId}/shipping_options/free?${shippingQuery}`, token, 'ml_shipping_quote');
      const costs = recursiveNumbers(shippingResponse, 'list_cost').filter((value) => value > 0);
      shippingCost = costs.length ? Math.max(...costs) : 0;
      calculation = calculatePrice({ cost: offer.custo, saleFeeRate: rate, shippingCost });
    }
    candidates.push({ listing_type_id: listingType, dimensions, sale_fee_rate: rate, shipping_cost: shippingCost, ...calculation, fee_response: feeResponse, shipping_response: shippingResponse });
  }
  const storedRate = Number(product.ml_fee || 0);
  const selected = candidates.sort((a, b) => Math.abs(a.sale_fee_rate - storedRate) - Math.abs(b.sale_fee_rate - storedRate) || a.finalPrice - b.finalPrice)[0];
  return {
    approved: selected.grossMargin + 0.001 >= selected.minimumProfit && selected.grossMarginPercent + 0.001 >= selected.targetMarginPercent,
    engine: 'src/services/pricing.ts',
    engine_parameters: { tax_rate: 0.05, cost_tiers: 'existing_pricing_service', stored_ml_fee: storedRate },
    cost: Number(offer.custo),
    stock: Number(offer.estoque),
    selected,
    candidates,
    simulated_at: now(),
  };
}

function criticalFields(product, dslite) {
  return [
    ['Marca', dslite.marca || product.marca], ['Modelo', dslite.modelo], ['Referência', dslite.part_number || dslite.id_produto_fabricante],
    ['Peso da embalagem', dslite.peso_embalagem ? `${dslite.peso_embalagem}` : ''], ['Largura da embalagem', dslite.largura_embalagem ? `${dslite.largura_embalagem}` : ''],
    ['Altura da embalagem', dslite.altura_embalagem ? `${dslite.altura_embalagem}` : ''], ['Profundidade da embalagem', dslite.profundidade_embalagem ? `${dslite.profundidade_embalagem}` : ''],
    ['NCM', dslite.ncm || product.ncm], ['Quantidade por embalagem', dslite.embalagem_quantidade],
  ].filter(([, value]) => text(value)).map(([label, value]) => ({ label, value: text(value) }));
}

function buildLedger(product, offer, dsliteResult, reconciliation, fields) {
  const ledger = [];
  const add = (field, value, sourceLevel, sourceUrl, evidence, selected = true) => {
    if (!text(value)) return;
    ledger.push({ field, value: text(value), source_level: sourceLevel, source_url: sourceUrl, evidence: text(evidence).slice(0, 600), selected, recorded_at: now() });
  };
  add('sku_vortek', product.sku, 0, 'supabase://produtos', product.sku);
  add('preferred_offer_id', offer.id, 0, 'supabase://produto_fornecedor_ofertas', offer.id);
  add('gtin', normalizeGtin(dsliteResult.product.ean11 || product.gtin), 1, dsliteResult.url, dsliteResult.product.ean11);
  add('brand', dsliteResult.product.marca || product.marca, 1, dsliteResult.url, dsliteResult.product.marca);
  add('model', dsliteResult.product.modelo, 1, dsliteResult.url, dsliteResult.product.modelo);
  for (const field of fields) add(field.label, field.value, 1, dsliteResult.url, field.value);
  if (reconciliation.source) {
    if (reconciliation.gtin_evidence) add('gtin_confirmation', normalizeGtin(dsliteResult.product.ean11 || product.gtin), 2, reconciliation.source.url, reconciliation.gtin_evidence);
    for (const identifier of reconciliation.exact_identifiers) add('identity_identifier_confirmation', identifier, 2, reconciliation.source.url, reconciliation.identifier_evidence);
  }
  return ledger;
}

function classification({ drift, reconciliation, imageAudit, duplicateAudit, schemaAudit, pricing, sensitive, technicalDivergence, score }) {
  if (drift.has_drift) return ['P0_MANUAL_TECH', 'eligibility_drift'];
  if (reconciliation.status === 'checagem_manual_gtin') return ['P0_MANUAL_GTIN', 'gtin_dslite_fabricante_divergente'];
  if (['checagem_manual_identidade', 'fonte_oficial_nao_confirmada'].includes(reconciliation.status)) return ['P0_MANUAL_IDENTITY', 'identidade_oficial_inconclusiva'];
  if (!imageAudit.approved) return ['P0_MANUAL_IMAGE', 'imagem_ausente_invalida_ou_inconclusiva'];
  if (duplicateAudit.found && !duplicateAudit.exact_remote) return ['P0_MANUAL_IDENTITY', 'possivel_duplicidade_sem_sku_remoto_exato'];
  if (technicalDivergence || (sensitive && reconciliation.status !== 'fabricante_confirmado')) return ['P0_MANUAL_TECH', 'validacao_tecnica_reforcada_incompleta'];
  if (!schemaAudit.required_complete) return ['P0_MANUAL_TECH', 'atributos_obrigatorios_incompletos'];
  if (!pricing.approved) return ['P0_MANUAL_TECH', pricing.reason || 'precificacao_nao_aprovada'];
  if (score < 85) return ['P0_MANUAL_TECH', 'score_abaixo_de_85'];
  return ['P0_READY', null];
}

async function persistAudit(snapshot, payload) {
  const { error } = await supabase.from('ml_p0_publication_audits').update(payload).eq('job_id', JOB_ID).eq('produto_id', snapshot.produto_id);
  if (error) throw new Error(`persist_audit: ${error.message}`);
}

async function processOne(snapshot, context, liveRows) {
  const startedAt = now();
  const product = liveRows.products.get(snapshot.produto_id) || snapshotProduct(snapshot);
  const offer = liveRows.offers.get(snapshot.oferta_preferencial_id) || snapshotOffer(snapshot);
  const drift = eligibilityDrift(snapshot, liveRows.products.get(snapshot.produto_id), liveRows.offers.get(snapshot.oferta_preferencial_id));
  try {
    const dsliteResult = await fetchDslite(context.integrations.dslite, snapshot.fornecedor_id, offer.dslite_produto_id);
    const dslite = dsliteResult.product;
    const gtin = normalizeGtin(dslite.ean11 || offer.gtin || product.gtin);
    const identifiers = identityTokens(dslite.modelo, dslite.part_number, dslite.id_produto_fabricante, offer.sku_fornecedor, dslite.titulo);
    const sources = await researchOfficial(product, dslite);
    const reconciliation = reconcileOfficial({ brand: dslite.marca || product.marca, gtin, identifiers, sources });
    const fields = criticalFields(product, dslite);
    const ledger = buildLedger(product, offer, dsliteResult, reconciliation, fields);
    const imageAudit = await auditImages(imageUrls(offer, dslite));
    const token = context.integrations.mercadolivre.access_token;
    const duplicateAudit = await auditDuplicates(product, token, context.account.userId);
    const categoryResult = await resolveCategory(product, dslite, token);
    const preparedAttributes = attributesFromEvidence(product, dslite, categoryResult);
    const schemaAudit = await categorySchema(categoryResult.category_id, token, preparedAttributes);
    const pricing = await simulatePricing(product, offer, dslite, categoryResult.category_id, token, context.account.userId);
    const sensitive = isSensitive(product);
    const manufacturerContent = text(`${reconciliation.source?.title || ''} ${reconciliation.source?.description || ''} ${reconciliation.source?.content || ''}`);
    const fieldComparisons = fields.map((field) => ({
      field: field.label,
      dslite_value: field.value,
      manufacturer_evidence: reconciliation.source ? evidenceSnippet(manufacturerContent, field.value) : '',
      status: reconciliation.source && plain(manufacturerContent).includes(plain(field.value)) ? 'confirmed_same_value' : 'not_published_or_not_located',
      selected_value: field.value,
      selected_source: 'dslite_level_1',
    }));
    const technicalDivergence = false;
    const score = scoreAudit({
      officialStatus: reconciliation.status,
      level1Identity: Boolean(dslite.produtoid && (gtin || identifiers.length)),
      imageApproved: imageAudit.approved,
      categoryValidated: categoryResult.validated,
      requiredAttributesComplete: schemaAudit.required_complete,
      pricingApproved: pricing.approved,
      duplicateChecked: true,
      technicalDivergence,
      sensitive,
      anyDivergence: reconciliation.status === 'checagem_manual_gtin',
    });
    const [auditStatus, blockReason] = classification({ drift, reconciliation, imageAudit, duplicateAudit, schemaAudit, pricing, sensitive, technicalDivergence, score });
    const content = auditStatus === 'P0_READY' ? buildContent({ product, dslite, gtin, identifiers, confirmedFields: fields, maxTitleLength: 60 }) : {};
    const officialSources = sources.map((source) => ({
      ...source,
      accepted_as_official: reconciliation.source?.url === source.url,
      fields_supported: reconciliation.source?.url === source.url ? [gtin && 'gtin', reconciliation.exact_identifiers.length && 'identity'].filter(Boolean) : [],
      evidence_excerpt: reconciliation.source?.url === source.url ? text(reconciliation.gtin_evidence || reconciliation.identifier_evidence).slice(0, 800) : '',
    }));
    await persistAudit(snapshot, {
      confidence_score: score,
      audit_status: auditStatus,
      validation_status: reconciliation.status,
      publication_action: duplicateAudit.exact_remote ? 'link_existing' : auditStatus === 'P0_READY' ? 'create_new' : 'none',
      block_reason: blockReason,
      ml_item_id: duplicateAudit.exact_remote?.id || null,
      level0_snapshot: snapshot.snapshot,
      dslite_raw: { source_url: dsliteResult.url, consulted_at: now(), supplier: { id: dsliteResult.raw.fornecedorid, name: dsliteResult.raw.apelido || dsliteResult.raw.nome }, product: dslite },
      official_sources: officialSources,
      evidence_ledger: ledger,
      image_audit: imageAudit,
      ml_schema_audit: { category: categoryResult, schema: schemaAudit },
      content_snapshot: { ...content, technical_fields: fields, field_comparisons: fieldComparisons, final: auditStatus === 'P0_READY' },
      pricing_snapshot: pricing,
      duplicate_audit: duplicateAudit,
      eligibility_drift: drift,
      event_log: [{ event: 'audit_started', timestamp: startedAt }, { event: 'audit_completed', timestamp: now(), status: auditStatus }],
      started_at: startedAt,
      completed_at: now(),
    });
    return { sku: product.sku, status: auditStatus, score };
  } catch (error) {
    await persistAudit(snapshot, {
      confidence_score: 0,
      audit_status: 'P0_API_ERROR',
      validation_status: 'api_error',
      publication_action: 'none',
      block_reason: text(error.message),
      eligibility_drift: drift,
      event_log: [{ event: 'audit_started', timestamp: startedAt }, { event: 'audit_failed', timestamp: now(), error: text(error.message), status: error.status || null }],
      started_at: startedAt,
      completed_at: now(),
    });
    return { sku: product.sku, status: 'P0_API_ERROR', score: 0, error: text(error.message) };
  }
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      const processed = results.filter(Boolean).length;
      if (processed % 10 === 0 || processed === items.length) console.log(JSON.stringify({ event: 'p0_progress', processed, total: items.length, timestamp: now() }));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, consume));
  return results;
}

function histogram(rows) {
  const ranges = { '95-100': 0, '90-94': 0, '85-89': 0, '70-84': 0, '0-69': 0 };
  for (const row of rows) {
    const score = Number(row.confidence_score || 0);
    if (score >= 95) ranges['95-100'] += 1;
    else if (score >= 90) ranges['90-94'] += 1;
    else if (score >= 85) ranges['85-89'] += 1;
    else if (score >= 70) ranges['70-84'] += 1;
    else ranges['0-69'] += 1;
  }
  return ranges;
}

function canary(rows, supplierId) {
  const ready = rows.filter((row) => row.fornecedor_id === supplierId && row.audit_status === 'P0_READY')
    .sort((a, b) => Number(b.confidence_score) - Number(a.confidence_score) || Number(b.level0_snapshot?.produto?.estoque || 0) - Number(a.level0_snapshot?.produto?.estoque || 0));
  const candidate = ready[0] || rows.filter((row) => row.fornecedor_id === supplierId).sort((a, b) => Number(b.confidence_score) - Number(a.confidence_score))[0] || null;
  return { go: Boolean(candidate && candidate.audit_status === 'P0_READY' && Number(candidate.confidence_score) >= 95), candidate };
}

async function generateReport(context) {
  const audits = await loadAll('ml_p0_publication_audits', '*', (query) => query.eq('job_id', JOB_ID).order('sku'));
  const completedAudits = audits.filter((row) => row.audit_status);
  const status = completedAudits.reduce((acc, row) => ({ ...acc, [row.audit_status]: (acc[row.audit_status] || 0) + 1 }), {});
  const ready = audits.filter((row) => row.audit_status === 'P0_READY');
  const baselineHasGtin = (snapshot) => Boolean(normalizeGtin(snapshot.snapshot?.produto?.gtin || snapshot.snapshot?.oferta_preferencial?.gtin));
  const baselineHasImages = (snapshot) => {
    const productImages = snapshot.snapshot?.produto?.imagens;
    const offerImages = snapshot.snapshot?.oferta_preferencial?.imagens;
    return (Array.isArray(productImages) && productImages.some(text)) || (Array.isArray(offerImages) && offerImages.length > 0);
  };
  const baselineHasDescription = (snapshot) => Boolean(text(snapshot.snapshot?.produto?.descricao || snapshot.snapshot?.oferta_preferencial?.descricao));
  const resultBySupplier = Object.fromEntries(Object.entries(SUPPLIER_NAMES).map(([id, name]) => [name,
    completedAudits.filter((row) => row.fornecedor_id === id).reduce((acc, row) => ({ ...acc, [row.audit_status]: (acc[row.audit_status] || 0) + 1 }), {}),
  ]));
  const apiErrorsByReason = completedAudits.filter((row) => row.audit_status === 'P0_API_ERROR')
    .reduce((acc, row) => ({ ...acc, [row.block_reason]: (acc[row.block_reason] || 0) + 1 }), {});
  const report = {
    generated_at: now(),
    mode: 'AUDIT_ONLY',
    job_id: JOB_ID,
    population: { total: context.snapshots.length, sha256: context.hash, by_supplier: context.distribution, drifts: audits.filter((row) => row.eligibility_drift?.has_drift).length },
    result: { ...status, P0_READY: status.P0_READY || 0, P0_MANUAL_GTIN: status.P0_MANUAL_GTIN || 0, P0_MANUAL_IDENTITY: status.P0_MANUAL_IDENTITY || 0, P0_MANUAL_IMAGE: status.P0_MANUAL_IMAGE || 0, P0_MANUAL_TECH: status.P0_MANUAL_TECH || 0, P0_API_ERROR: status.P0_API_ERROR || 0, P0_PUBLISHED: status.P0_PUBLISHED || 0 },
    result_by_supplier: resultBySupplier,
    quality: {
      score_distribution: histogram(audits),
      gtin_confirmed: audits.filter((row) => row.validation_status === 'fabricante_confirmado').length,
      with_gtin: context.snapshots.filter(baselineHasGtin).length,
      without_gtin: context.snapshots.filter((snapshot) => !baselineHasGtin(snapshot)).length,
      baseline_without_image: context.snapshots.filter((snapshot) => !baselineHasImages(snapshot)).length,
      baseline_without_description: context.snapshots.filter((snapshot) => !baselineHasDescription(snapshot)).length,
      images_approved: audits.filter((row) => row.image_audit?.approved).length,
      image_problems: audits.filter((row) => row.audit_status === 'P0_MANUAL_IMAGE').length,
      dslite_manufacturer_divergences: audits.filter((row) => row.validation_status === 'checagem_manual_gtin' || (row.content_snapshot?.field_comparisons || []).some((field) => field.status === 'divergent')).length,
      official_sources_found: audits.filter((row) => (row.official_sources || []).some((source) => source.accepted_as_official)).length,
      official_sources_not_found: audits.filter((row) => !(row.official_sources || []).some((source) => source.accepted_as_official)).length,
      remote_listings_found: audits.filter((row) => row.duplicate_audit?.remote?.length).length,
      api_errors_by_reason: apiErrorsByReason,
    },
    potential_revenue: {
      ready_skus: ready.length,
      aggregate_stock: ready.reduce((sum, row) => sum + Number(row.pricing_snapshot?.stock || 0), 0),
      exposure_value: ready.reduce((sum, row) => sum + Number(row.pricing_snapshot?.stock || 0) * Number(row.pricing_snapshot?.selected?.finalPrice || 0), 0),
    },
    manual_queue: Object.fromEntries(['P0_MANUAL_GTIN', 'P0_MANUAL_IDENTITY', 'P0_MANUAL_IMAGE', 'P0_MANUAL_TECH', 'P0_API_ERROR'].map((key) => [key, audits.filter((row) => row.audit_status === key).map((row) => ({ sku: row.sku, supplier: row.fornecedor_nome, reason: row.block_reason, score: row.confidence_score }))])),
    canary: Object.fromEntries(Object.keys(SUPPLIER_NAMES).map((id) => {
      const selection = canary(completedAudits, id);
      const row = selection.candidate;
      return [SUPPLIER_NAMES[id], row ? {
        go: selection.go,
        sku: row.sku,
        product: row.level0_snapshot?.produto?.nome,
        supplier: row.fornecedor_nome,
        stock: row.pricing_snapshot?.stock || row.level0_snapshot?.produto?.estoque,
        gtin: normalizeGtin(row.dslite_raw?.product?.ean11 || row.level0_snapshot?.produto?.gtin) || null,
        official_source: (row.official_sources || []).find((source) => source.accepted_as_official)?.url || null,
        score: row.confidence_score,
        title: row.content_snapshot?.title || null,
        price: row.pricing_snapshot?.selected?.finalPrice || null,
        listing_type: row.pricing_snapshot?.selected?.listing_type_id || null,
        gross_margin: row.pricing_snapshot?.selected?.grossMargin || null,
        gross_margin_percent: row.pricing_snapshot?.selected?.grossMarginPercent || null,
        status: row.audit_status,
        justification: selection.go ? 'Máxima confiança e todos os gates aprovados.' : 'NO-GO: melhor candidato disponível não atingiu score >=95 em P0_READY.',
      } : { go: false, justification: 'NO-GO: nenhum candidato processado.' }];
    })),
    audits,
  };
  fs.mkdirSync(REPORT_ROOT, { recursive: true });
  const jsonPath = path.join(REPORT_ROOT, `${JOB_ID}.json`);
  const summaryPath = path.join(REPORT_ROOT, `${JOB_ID}-summary.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(summaryPath, `${JSON.stringify({ ...report, audits: undefined }, null, 2)}\n`);
  return { report, jsonPath, summaryPath };
}

async function main() {
  const context = await loadContext();
  console.log(JSON.stringify({ event: 'baseline_validated', job_id: JOB_ID, total: context.snapshots.length, distribution: context.distribution, sha256: context.hash }));
  await seedAudits(context.snapshots);
  const liveRows = await loadLiveRows(context.snapshots);
  const audits = await loadAll('ml_p0_publication_audits', 'produto_id,audit_status', (query) => query.eq('job_id', JOB_ID));
  const completed = new Set(audits.filter((row) => row.audit_status).map((row) => row.produto_id));
  const allPending = context.snapshots.filter((row) => !completed.has(row.produto_id));
  const pending = RUN_LIMIT > 0 ? allPending.slice(0, RUN_LIMIT) : allPending;
  await runPool(pending, (snapshot) => processOne(snapshot, context, liveRows), CONCURRENCY);
  const { report, jsonPath, summaryPath } = await generateReport(context);
  const completedCount = (await loadAll('ml_p0_publication_audits', 'audit_status', (query) => query.eq('job_id', JOB_ID).not('audit_status', 'is', null))).length;
  const jobStatus = completedCount === EXPECTED.total ? 'concluido' : 'erro';
  const { error } = await supabase.from('jobs').update({
    status: jobStatus,
    progresso: Math.floor(completedCount / EXPECTED.total * 100),
    processados: completedCount,
    finished_at: now(),
    log: [...(context.job.log || []), { event: 'p0_audit_completed', timestamp: now(), report: summaryPath, result: report.result }],
  }).eq('id', JOB_ID);
  if (error) throw new Error(`job_finalize: ${error.message}`);
  console.log(JSON.stringify({ event: 'p0_audit_finished', job_id: JOB_ID, result: report.result, report: jsonPath, summary: summaryPath }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'p0_audit_fatal', job_id: JOB_ID, error: text(error.message), stack: error.stack }));
  process.exit(1);
});
