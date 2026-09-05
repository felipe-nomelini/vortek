#!/usr/bin/env node
/* AUDIT ONLY. Proibidos POST /items, PUT /items, vínculos e mutações comerciais. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const {
  buildContent, identityTokens, isManufacturerHost, isSensitive, normalizeGtin,
  plain, reconcileOfficial, text,
} = require('./lib/ml-p0-audit');
const {
  RateGate, TRANSIENT_HTTP, auditRemoteProduct, brandKey, buildRemoteIndex,
  classifyGtin, isKnownOfficialUrl, jitteredBackoff, publicationScore,
  selectNewStatus, sha256, sourceScores, structuralScore, toCsv,
} = require('./lib/ml-p0-sanitize');

dotenv.config({ path: '.env.local' });

const SOURCE_JOB_ID = process.env.ML_P0_SOURCE_JOB_ID || 'bbcffbd8-cf85-4a1e-9a5a-b1ee2f782c00';
const REPORT_DIR = path.join(process.cwd(), 'reports', 'ml-p0-sanitize');
const PHASE1_PATH = path.join(process.cwd(), 'reports', 'ml-p0-audit', `${SOURCE_JOB_ID}.json`);
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY || '';
const SUPPLIER_NAMES = { '2': 'Hayamax', '108': 'BKR1', '133': 'Evolusom' };
const MANUAL_CANDIDATES = ['VTK017799', 'VTK005426', 'VTK001286', 'VTK000486'];
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!fs.existsSync(PHASE1_PATH)) throw new Error(`Relatório Fase 1 ausente: ${PHASE1_PATH}`);
if (!FIRECRAWL_KEY) throw new Error('FIRECRAWL_API_KEY indisponível');

const phase1 = JSON.parse(fs.readFileSync(PHASE1_PATH, 'utf8'));
const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const metrics = {
  total_calls: 0, cache_hits: 0, retries: 0, http_429: 0, http_402: 0,
  timeouts: 0, successes: 0, failures: 0, by_service: {},
};
const gates = {
  ml: new RateGate({ minIntervalMs: 120 }),
  dslite: new RateGate({ minIntervalMs: 180 }),
  firecrawl: new RateGate({ minIntervalMs: 2200 }),
};
const caches = { ml: new Map(), dslite: new Map(), source: new Map(), categorySchema: new Map() };

function record(service, key) {
  metrics[key] = (metrics[key] || 0) + 1;
  if (key === 'calls') metrics.total_calls += 1;
  metrics.by_service[service] ||= { calls: 0, successes: 0, failures: 0, retries: 0, cache_hits: 0 };
  metrics.by_service[service][key] = (metrics.by_service[service][key] || 0) + 1;
}

async function requestJson(service, url, options = {}, { attempts = 3, cacheKey = '', allowedPost = false } = {}) {
  const cache = caches[service];
  if (cacheKey && cache?.has(cacheKey)) {
    record(service, 'cache_hits');
    return cache.get(cacheKey);
  }
  if ((options.method || 'GET').toUpperCase() !== 'GET' && !allowedPost) throw new Error(`write_not_allowed:${url}`);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await gates[service].schedule(async () => {
        record(service, 'calls');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
        try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          const raw = await response.text();
          let body;
          try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
          if (!response.ok) {
            const error = new Error(`${service}_http_${response.status}`);
            error.status = response.status;
            error.body = body;
            throw error;
          }
          return body;
        } finally { clearTimeout(timeout); }
      });
      record(service, 'successes');
      if (cacheKey && cache) cache.set(cacheKey, result);
      return result;
    } catch (error) {
      lastError = error;
      if (error.status === 429) record(service, 'http_429');
      if (error.status === 402) record(service, 'http_402');
      if (error.name === 'AbortError') record(service, 'timeouts');
      const transient = TRANSIENT_HTTP.has(error.status) || error.name === 'AbortError' || !error.status;
      if (transient && attempt < attempts && error.status !== 402) {
        record(service, 'retries');
        await sleep(jitteredBackoff(attempt, 1200, 10000));
        continue;
      }
      record(service, 'failures');
      throw error;
    }
  }
  throw lastError;
}

async function loadIntegrations() {
  const { data, error } = await supabase.from('integracoes').select('tipo,url,access_token,conectado').in('tipo', ['dslite', 'mercadolivre']);
  if (error) throw error;
  const result = Object.fromEntries(data.map((row) => [row.tipo, row]));
  if (!result.dslite?.conectado || !result.mercadolivre?.conectado) throw new Error('integration_disconnected');
  const account = await assertAllowedMercadoLivreToken(result.mercadolivre.access_token, 'ml-p0-sanitize');
  return { ...result, account };
}

async function mlGet(integration, pathname, cacheKey = '') {
  return requestJson('ml', `https://api.mercadolibre.com${pathname}`, {
    headers: { Authorization: `Bearer ${integration.access_token}` },
  }, { cacheKey });
}

async function mlConditional(integration, categoryId, body) {
  return requestJson('ml', `https://api.mercadolibre.com/categories/${categoryId}/attributes/conditional`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${integration.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { allowedPost: true, attempts: 2 });
}

async function fetchDslite(integration, supplierId, productId) {
  const key = `${supplierId}:${productId}`;
  const payload = await requestJson('dslite', `${String(integration.url).replace(/\/+$/, '')}/v1/CrossDocking/Catalogo/${supplierId}/${productId}`, {
    headers: { Token: integration.access_token }, timeout: 60000,
  }, { cacheKey: key });
  const product = (payload?.produtos || []).find((row) => String(row.produtoid) === String(productId)) || payload?.produtos?.[0];
  if (!product) throw new Error('dslite_product_not_found');
  return product;
}

async function scanRemoteInventory(integration) {
  const sellerId = integration.account.userId;
  const ids = [];
  const seenScroll = new Set();
  let scrollId = '';
  let expectedTotal = null;
  let pages = 0;
  while (pages < 1000) {
    const query = scrollId
      ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : 'search_type=scan&limit=100';
    const page = await mlGet(integration.mercadolivre, `/users/${sellerId}/items/search?${query}`);
    pages += 1;
    if (expectedTotal === null) expectedTotal = Number(page?.paging?.total || 0);
    const results = Array.isArray(page?.results) ? page.results.map(String) : [];
    ids.push(...results);
    if (!results.length) break;
    const next = text(page.scroll_id);
    if (!next || seenScroll.has(next)) break;
    seenScroll.add(next);
    scrollId = next;
    if (new Set(ids).size >= expectedTotal) break;
  }
  const uniqueIds = [...new Set(ids)];
  const items = [];
  const failures = [];
  for (let index = 0; index < uniqueIds.length; index += 20) {
    const batch = uniqueIds.slice(index, index + 20);
    const attributes = 'body.title,body.status,body.seller_id,body.seller_custom_field,body.user_product_id,body.catalog_product_id,body.attributes,body.variations,body.permalink';
    const response = await mlGet(integration.mercadolivre, `/items/bulk?ids=${batch.join(',')}&attributes=${attributes}`);
    for (const row of response || []) {
      if (Number(row.status_code) === 200 && row.id && row.body) items.push({ ...row.body, id: String(row.id) });
      else failures.push(String(row.id || 'unknown'));
    }
    if ((index / 20) % 25 === 0) console.log(JSON.stringify({ event: 'remote_inventory_detail', processed: Math.min(index + 20, uniqueIds.length), total: uniqueIds.length }));
  }
  for (const id of [...new Set(failures)]) {
    try { items.push(await mlGet(integration.mercadolivre, `/items/${id}?include_attributes=all`)); }
    catch { /* reliability remains false */ }
  }
  const detailedIds = new Set(items.map((item) => String(item.id)));
  const reliable = uniqueIds.length === expectedTotal && uniqueIds.every((id) => detailedIds.has(id));
  const statuses = items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  return { seller_id: sellerId, expected_total: expectedTotal, pages, ids: uniqueIds, items, statuses, reliable, missing_details: uniqueIds.filter((id) => !detailedIds.has(id)), page_safety_limit_reached: pages >= 1000 };
}

function learnedOfficialDomains() {
  const learned = {};
  for (const audit of phase1.audits) {
    const brand = audit.dslite_raw?.product?.marca || audit.level0_snapshot?.produto?.marca;
    for (const source of audit.official_sources || []) {
      if (!source.accepted_as_official || !source.domain) continue;
      const key = brandKey(brand);
      learned[key] ||= [];
      learned[key].push(String(source.domain).replace(/^www\./, '').toLowerCase());
    }
  }
  return learned;
}

class ResearchClient {
  constructor(learned) {
    this.learned = learned;
    this.circuit = null;
  }

  async search(product, dslite) {
    const gtin = normalizeGtin(dslite.ean11 || product.gtin);
    const model = text(dslite.modelo || dslite.part_number);
    const query = [gtin, dslite.marca || product.marca, model, dslite.titulo || product.nome, 'fabricante ficha técnica oficial'].filter(Boolean).join(' ');
    const key = sha256(query);
    if (caches.source.has(key)) {
      record('firecrawl', 'cache_hits');
      return caches.source.get(key);
    }
    if (this.circuit) return { status: 'SOURCE_LOOKUP_DEFERRED', error: this.circuit, attempts: 0, rows: [] };
    try {
      const payload = await requestJson('firecrawl', 'https://api.firecrawl.dev/v2/search', {
        method: 'POST', timeout: 45000,
        headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 5, sources: ['web'], country: 'BR', timeout: 30000, scrapeOptions: { formats: [{ type: 'markdown' }], onlyMainContent: true, timeout: 15000 } }),
      }, { attempts: 3, allowedPost: true });
      const rows = (payload?.data?.web || []).map((row) => ({
        url: text(row.url || row.metadata?.sourceURL),
        domain: (() => { try { return new URL(row.url || row.metadata?.sourceURL).hostname; } catch { return ''; } })(),
        title: text(row.title || row.metadata?.title),
        content: text(row.markdown || row.content || row.description).slice(0, 16000),
        consulted_at: now(),
      })).filter((row) => row.url);
      const identifiers = identityTokens(dslite.modelo, dslite.part_number, dslite.id_produto_fabricante, dslite.titulo);
      const reconciliation = reconcileOfficial({ brand: dslite.marca || product.marca, gtin, identifiers, sources: rows });
      const official = reconciliation.source && (isKnownOfficialUrl(reconciliation.source.url, dslite.marca || product.marca, this.learned) || isManufacturerHost(reconciliation.source.url, dslite.marca || product.marca));
      const result = official
        ? { status: reconciliation.status === 'checagem_manual_gtin' ? 'SOURCE_CONFLICT' : 'SOURCE_FOUND_OFFICIAL', attempts: 1, rows, reconciliation }
        : { status: 'SOURCE_NOT_FOUND', attempts: 1, rows, reconciliation };
      caches.source.set(key, result);
      return result;
    } catch (error) {
      if (error.status === 402) this.circuit = 'firecrawl_http_402_circuit_open';
      const result = { status: 'SOURCE_LOOKUP_DEFERRED', error: error.message, attempts: error.status === 429 ? 3 : 1, rows: [] };
      caches.source.set(key, result);
      return result;
    }
  }
}

async function resolveCategory(integration, product, dslite) {
  const gtin = normalizeGtin(dslite.ean11 || product.gtin);
  let catalog = null;
  if (gtin) {
    const search = await mlGet(integration, `/products/search?status=active&site_id=MLB&product_identifier=${gtin}`, `catalog:${gtin}`);
    catalog = (search?.results || [])[0] || null;
  }
  const predictions = await mlGet(integration, `/sites/MLB/domain_discovery/search?limit=3&q=${encodeURIComponent(dslite.titulo || product.nome)}`, `predict:${sha256(dslite.titulo || product.nome)}`);
  const exactDomain = catalog?.domain_id;
  const prediction = (predictions || []).find((row) => !exactDomain || row.domain_id === exactDomain) || predictions?.[0] || null;
  return {
    category_id: prediction?.category_id || null,
    domain_id: exactDomain || prediction?.domain_id || null,
    category_name: prediction?.category_name || null,
    catalog_product_id: catalog?.id || null,
    catalog_attributes: catalog?.attributes || [],
    method: catalog && prediction?.domain_id === catalog.domain_id ? 'exact_gtin_catalog_plus_same_domain_predictor' : 'title_predictor',
    validated: Boolean(prediction?.category_id && (!catalog || prediction.domain_id === catalog.domain_id)),
  };
}

async function getCategorySchema(integration, categoryId) {
  if (!categoryId) return [];
  if (caches.categorySchema.has(categoryId)) {
    record('ml', 'cache_hits');
    return caches.categorySchema.get(categoryId);
  }
  const schema = await mlGet(integration, `/categories/${categoryId}/attributes`, `schema:${categoryId}`);
  caches.categorySchema.set(categoryId, schema || []);
  return schema || [];
}

function preparedAttributes(product, dslite, modelOverride = '') {
  return [
    ['BRAND', dslite.marca || product.marca, 'dslite_level_1'],
    ['MODEL', modelOverride || dslite.modelo || dslite.part_number, modelOverride ? 'manufacturer_level_2' : 'dslite_level_1'],
    ['MPN', dslite.part_number || dslite.id_produto_fabricante, 'dslite_level_1'],
    ['GTIN', normalizeGtin(dslite.ean11 || product.gtin), 'dslite_level_1'],
  ].filter(([, value]) => text(value)).map(([id, value_name, source]) => ({ id, value_name: text(value_name), source }));
}

function directRequired(schema) {
  return schema.filter((attribute) => attribute.tags?.required || attribute.tags?.new_required);
}

async function conditionalRequired(integration, audit, categoryId, attributes, pricing) {
  if (!categoryId) return { required: [], error: 'category_missing' };
  const product = audit.level0_snapshot.produto;
  const body = {
    title: product.nome, category_id: categoryId,
    price: Number(pricing?.finalPrice || product.custom_price || 100), currency_id: 'BRL',
    available_quantity: Math.max(1, Number(product.estoque || 1)), buying_mode: 'buy_it_now',
    condition: 'new', listing_type_id: pricing?.listing_type_id || 'gold_special',
    description: { plain_text: text(product.descricao).slice(0, 2000) || product.nome },
    attributes: attributes.map(({ id, value_name }) => ({ id, value_name })),
  };
  try {
    const response = await mlConditional(integration, categoryId, body);
    return { required: response?.required_attributes || [], response };
  } catch (error) {
    return { required: [], error: error.message };
  }
}

function imageCandidates(audit, dslite) {
  const rows = [];
  const add = (url, source) => {
    const value = text(url);
    if (!value || rows.some((row) => row.url === value)) return;
    rows.push({ url: value, source });
    if (value.startsWith('https://evolusom.com.br/')) rows.push({ url: value.replace('https://evolusom.com.br/', 'https://www.evolusom.com.br/'), source: `${source}_canonical_www` });
  };
  for (const row of dslite.midias || []) if (row.tipo === 'imagem') add(row.valor, 'dslite_live');
  add(dslite.link_imagem, 'dslite_live');
  for (const image of audit.level0_snapshot?.oferta_preferencial?.imagens || []) add(typeof image === 'string' ? image : image?.url, 'preferred_offer');
  return rows;
}

async function auditImages(audit, dslite) {
  const candidates = imageCandidates(audit, dslite);
  const checked = [];
  for (const candidate of candidates.slice(0, 5)) {
    try {
      const response = await fetch(candidate.url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      if (response.status >= 300 && response.status < 400) {
        checked.push({ ...candidate, approved: false, reason: `redirect_${response.status}`, location: response.headers.get('location') });
        continue;
      }
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.startsWith('image/')) {
        checked.push({ ...candidate, approved: false, reason: !response.ok ? `http_${response.status}` : `content_type_${type}` });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(buffer).metadata();
      const approved = Number(metadata.width) >= 250 && Number(metadata.height) >= 250 && Math.max(metadata.width, metadata.height) >= 500;
      checked.push({ ...candidate, approved, reason: approved ? '' : 'minimum_dimensions', width: metadata.width, height: metadata.height, bytes: buffer.length, content_type: type });
      if (approved) break;
    } catch (error) {
      checked.push({ ...candidate, approved: false, reason: error.name === 'TimeoutError' ? 'timeout' : error.message });
    }
  }
  return { available_count: candidates.length, approved: checked.some((row) => row.approved), selected: checked.find((row) => row.approved) || null, checked };
}

function phase1SourceStatus(audit) {
  if ((audit.official_sources || []).some((source) => source.accepted_as_official)) return 'SOURCE_FOUND_OFFICIAL';
  if (audit.audit_status === 'P0_API_ERROR') return 'SOURCE_LOOKUP_DEFERRED';
  if ((audit.official_sources || []).length) return 'SOURCE_NOT_FOUND';
  return 'SOURCE_NOT_FOUND';
}

function identityConfirmed(sourceStatus, reconciliation, catalogProductId) {
  if (sourceStatus === 'SOURCE_FOUND_OFFICIAL') return true;
  return Boolean(sourceStatus === 'SOURCE_FOUND_SECONDARY' && catalogProductId && reconciliation?.gtin_match !== false);
}

function missingAttributes(schema, prepared, conditional) {
  const supplied = new Set(prepared.map((row) => row.id));
  const required = [...directRequired(schema), ...(conditional.required || [])]
    .filter((row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index);
  return { required, missing: required.filter((row) => !supplied.has(row.id)) };
}

async function createRun() {
  const { data, error } = await supabase.from('ml_p0_sanitize_runs').insert({
    source_job_id: SOURCE_JOB_ID, source_population_hash: phase1.population.sha256,
    expected_reprocess_count: 408,
  }).select('*').single();
  if (error) throw error;
  return data;
}

async function persistResult(run, audit, result) {
  const row = {
    run_id: run.id, phase1_audit_id: audit.id, population_snapshot_id: audit.population_snapshot_id,
    produto_id: audit.produto_id, sku: audit.sku, fornecedor_id: audit.fornecedor_id,
    fornecedor_nome: audit.fornecedor_nome, previous_status: audit.audit_status,
    previous_error: audit.block_reason, source_status: result.source_status,
    gtin_status: result.gtin_status || null, remote_lookup_status: result.remote.lookup_status,
    remote_listing_found: result.remote.remote_listing_found,
    structural_score: result.scores.structural, documentary_score: result.scores.documentary,
    publication_score: result.scores.publication, new_status: result.new_status,
    block_reason: result.block_reason, audit_payload: result,
  };
  const { error } = await supabase.from('ml_p0_sanitize_results').insert(row);
  if (error) throw error;
}

async function reprocessApiError(audit, context) {
  const product = audit.level0_snapshot.produto;
  const offer = audit.level0_snapshot.oferta_preferencial;
  const dslite = await fetchDslite(context.integrations.dslite, audit.fornecedor_id, offer.dslite_produto_id);
  const category = await resolveCategory(context.integrations.mercadolivre, product, dslite);
  const catalogSecondary = category.catalog_product_id ? { status: 'SOURCE_FOUND_SECONDARY', catalog_product_id: category.catalog_product_id } : null;
  const research = await context.research.search(product, dslite);
  const sourceStatus = research.status === 'SOURCE_FOUND_OFFICIAL' || research.status === 'SOURCE_CONFLICT'
    ? research.status : catalogSecondary?.status || research.status;
  const image = await auditImages(audit, dslite);
  const prepared = preparedAttributes(product, dslite);
  const schema = await getCategorySchema(context.integrations.mercadolivre, category.category_id);
  const required = directRequired(schema);
  const supplied = new Set(prepared.map((row) => row.id));
  const missing = required.filter((row) => !supplied.has(row.id));
  const remote = auditRemoteProduct({ index: context.remoteIndex, scanReliable: context.remoteScan.reliable, product, dslite, phase1: audit, catalogProductId: category.catalog_product_id });
  const identity = identityConfirmed(sourceStatus, research.reconciliation, category.catalog_product_id);
  const scores = {
    structural: structuralScore({ product, offer, dslite, imageApproved: image.approved, categoryValidated: category.validated }),
    documentary: sourceScores(sourceStatus),
  };
  const publicationGates = {
    identity, source: sourceStatus === 'SOURCE_FOUND_OFFICIAL', remote: remote.lookup_status !== 'INVENTORY_SCAN_UNRELIABLE' && !remote.remote_listing_found,
    category: category.validated, attributes: missing.length === 0, image: image.approved,
    pricing: false, content: false,
  };
  scores.publication = publicationScore(publicationGates);
  const [newStatus, blockReason] = selectNewStatus({
    sourceStatus, identityConfirmed: identity, gtinConflict: sourceStatus === 'SOURCE_CONFLICT', remoteAudit: remote,
    categoryValidated: category.validated, attributesComplete: missing.length === 0,
    imageApproved: image.approved, pricingApproved: false, contentReady: false,
    sensitive: isSensitive(product),
  });
  return {
    sku: audit.sku, supplier: audit.fornecedor_nome, previous_status: audit.audit_status,
    previous_error: audit.block_reason, attempts: research.attempts || 0, source_status: sourceStatus,
    source_lookup_error: research.error || '', source_found: research.reconciliation?.source?.url || '',
    identity_confirmed: identity, attributes_found: prepared.map((row) => row.id),
    attributes_missing: missing.map((row) => row.id), gtin: normalizeGtin(dslite.ean11 || product.gtin),
    images: image, category, remote, scores, new_status: newStatus, block_reason: blockReason,
    dslite_snapshot: dslite, publication_gates: publicationGates,
  };
}

async function sanitizeCandidate(audit, context) {
  const product = audit.level0_snapshot.produto;
  const offer = audit.level0_snapshot.oferta_preferencial;
  const dslite = audit.dslite_raw?.product || await fetchDslite(context.integrations.dslite, audit.fornecedor_id, offer.dslite_produto_id);
  const category = await resolveCategory(context.integrations.mercadolivre, product, dslite);
  let sourceStatus = phase1SourceStatus(audit);
  if (audit.sku === 'VTK001286') sourceStatus = 'SOURCE_IDENTITY_MISMATCH';
  const modelOverride = audit.sku === 'VTK017799' ? 'M110' : '';
  const prepared = preparedAttributes(product, dslite, modelOverride);
  const schema = await getCategorySchema(context.integrations.mercadolivre, category.category_id);
  const pricing = audit.pricing_snapshot?.selected;
  const conditional = await conditionalRequired(context.integrations.mercadolivre, audit, category.category_id, prepared, pricing);
  const attributeAudit = missingAttributes(schema, prepared, conditional);
  const image = await auditImages(audit, dslite);
  const remote = auditRemoteProduct({ index: context.remoteIndex, scanReliable: context.remoteScan.reliable, product, dslite, phase1: audit, catalogProductId: category.catalog_product_id });
  const identity = sourceStatus === 'SOURCE_FOUND_OFFICIAL' && audit.sku !== 'VTK001286';
  const pricingApproved = Boolean(audit.pricing_snapshot?.approved);
  const contentReady = identity && category.validated && attributeAudit.missing.length === 0 && image.approved;
  const content = contentReady ? buildContent({
    product, dslite: { ...dslite, modelo: modelOverride || dslite.modelo },
    gtin: normalizeGtin(dslite.ean11 || product.gtin),
    identifiers: identityTokens(modelOverride || dslite.modelo, dslite.part_number, dslite.titulo),
    confirmedFields: audit.content_snapshot?.technical_fields || [], maxTitleLength: 60,
  }) : {};
  if (audit.sku === 'VTK017799' && contentReady) content.title = 'Mouse com Fio Logitech M110 Silent USB Preto';
  const scores = {
    structural: structuralScore({ product, offer, dslite, imageApproved: image.approved, categoryValidated: category.validated }),
    documentary: sourceScores(sourceStatus),
  };
  const publicationGates = {
    identity, source: sourceStatus === 'SOURCE_FOUND_OFFICIAL', remote: remote.lookup_status !== 'INVENTORY_SCAN_UNRELIABLE' && !remote.remote_listing_found,
    category: category.validated, attributes: attributeAudit.missing.length === 0, image: image.approved,
    pricing: pricingApproved, content: Boolean(content.title && content.description),
  };
  scores.publication = publicationScore(publicationGates);
  const [newStatus, blockReason] = selectNewStatus({
    sourceStatus, identityConfirmed: identity, gtinConflict: false, remoteAudit: remote,
    categoryValidated: category.validated, attributesComplete: attributeAudit.missing.length === 0,
    imageApproved: image.approved, pricingApproved, contentReady: publicationGates.content,
    sensitive: isSensitive(product),
  });
  return {
    sku: audit.sku, supplier: audit.fornecedor_nome, product: product.nome,
    source_status: sourceStatus, official_source: (audit.official_sources || []).find((source) => source.accepted_as_official)?.url || '',
    category, prepared_attributes: prepared, required_attributes: attributeAudit.required,
    missing_attributes: attributeAudit.missing, conditional, image, remote, scores,
    publication_gates: publicationGates, pricing: audit.pricing_snapshot,
    content, new_status: newStatus, block_reason: blockReason,
    gtin: normalizeGtin(dslite.ean11 || product.gtin), stock: Number(offer.estoque),
    specific_diagnosis: audit.sku === 'VTK001286'
      ? { image_count: image.available_count, failed_rule: 'no_confirmed_image_url', required_fix: 'official_or_supplier_image_for_exact_seat_revision_color_and_package' }
      : audit.sku === 'VTK000486'
        ? { previous_rule_issue: 'sensitive_product_required_manufacturer_gtin_even_with_exact_model_and_ml_catalog_gtin', documentary_solution: 'manufacturer_exact_model_plus_exact_gtin_ml_catalog; no_source_conflict' }
        : null,
  };
}

async function classifyMissingGtins(context, reprocessedMap, candidateMap) {
  const rows = [];
  const targets = phase1.audits.filter((audit) => !normalizeGtin(audit.level0_snapshot?.produto?.gtin || audit.level0_snapshot?.oferta_preferencial?.gtin));
  for (let index = 0; index < targets.length; index += 1) {
    const audit = targets[index];
    const product = audit.level0_snapshot.produto;
    const offer = audit.level0_snapshot.oferta_preferencial;
    const phase2 = reprocessedMap.get(audit.sku) || candidateMap.get(audit.sku);
    let dslite = phase2?.dslite_snapshot || audit.dslite_raw?.product;
    if (!dslite) {
      try { dslite = await fetchDslite(context.integrations.dslite, audit.fornecedor_id, offer.dslite_produto_id); }
      catch { dslite = {}; }
    }
    let category = phase2?.category || audit.ml_schema_audit?.category;
    if (!category?.category_id) {
      try { category = await resolveCategory(context.integrations.mercadolivre, product, dslite); }
      catch { category = category || {}; }
    }
    let schema = [];
    try { schema = await getCategorySchema(context.integrations.mercadolivre, category?.category_id); } catch { /* lookup status handles */ }
    const gtinAttribute = schema.find((attribute) => attribute.id === 'GTIN');
    const categoryGtin = gtinAttribute?.tags?.required ? 'required' : gtinAttribute?.tags?.conditional_required ? 'conditional_required' : gtinAttribute ? 'not_required' : 'attribute_absent';
    let conditional = { required: [], error: '' };
    if (category?.category_id) {
      const prepared = preparedAttributes(product, dslite).filter((row) => row.id !== 'GTIN');
      conditional = await conditionalRequired(context.integrations.mercadolivre, audit, category.category_id, prepared, phase2?.pricing?.selected || audit.pricing_snapshot?.selected);
    }
    const conditionalIds = (conditional.required || []).map((row) => row.id);
    const conditionalRequiresGtin = conditionalIds.includes('GTIN');
    const sourceStatus = phase2?.source_status || phase1SourceStatus(audit);
    const status = classifyGtin({
      categoryGtin, conditionalRequired: conditionalRequiresGtin,
      dsliteGtin: dslite.ean11, phase1Status: audit.audit_status,
      sourceStatus, officialConfirmsAbsent: false,
    });
    rows.push({
      sku: audit.sku, fornecedor: audit.fornecedor_nome, nome: product.nome,
      gtin_atual: normalizeGtin(product.gtin || offer.gtin), categoria_gtin: categoryGtin,
      justificativa: status === 'GTIN_LOOKUP_BLOCKED' ? `Fonte oficial deferred: ${phase2?.source_lookup_error || audit.block_reason}`
        : status === 'GTIN_IDENTITY_BLOCKED' ? 'Identidade não confirmada; comparação de GTIN não aplicável.'
          : status === 'GTIN_NOT_REQUIRED' ? 'Validação condicional ML não exigiu GTIN.'
            : status === 'GTIN_SUPPLIER_MISSING' ? 'DSLite/fornecedor não forneceu GTIN para categoria que o exige ou condiciona.'
              : 'GTIN não localizado nas evidências validadas.',
      fonte: text(dslite ? `DSLite fornecedor ${audit.fornecedor_id}; ML categoria ${category?.category_id || 'indisponível'}` : ''),
      status, conditional_required_ids: conditionalIds.join('|'), dslite_gtin_live: normalizeGtin(dslite.ean11),
    });
    if ((index + 1) % 25 === 0) console.log(JSON.stringify({ event: 'gtin_classification', processed: index + 1, total: targets.length }));
  }
  return rows;
}

function buildRemoteRows(context, reprocessedMap, candidateMap) {
  return phase1.audits.map((audit) => {
    const product = audit.level0_snapshot.produto;
    const phase2 = reprocessedMap.get(audit.sku) || candidateMap.get(audit.sku);
    const dslite = phase2?.dslite_snapshot || audit.dslite_raw?.product || {};
    const category = phase2?.category || audit.ml_schema_audit?.category || {};
    const remote = auditRemoteProduct({ index: context.remoteIndex, scanReliable: context.remoteScan.reliable, product, dslite, phase1: audit, catalogProductId: category.catalog_product_id || category.product_id });
    return { sku: audit.sku, fornecedor: audit.fornecedor_nome, remote_listing_checked: remote.remote_listing_checked, remote_listing_found: remote.remote_listing_found, remote_item_ids: remote.remote_item_ids.join('|'), lookup_method: remote.lookup_method, lookup_status: remote.lookup_status, lookup_error: remote.lookup_error };
  });
}

function distribution(rows, key) {
  return rows.reduce((acc, row) => ({ ...acc, [row[key]]: (acc[row[key]] || 0) + 1 }), {});
}

function topCandidates(results) {
  return [...results].sort((a, b) => {
    const readinessA = Number(a.scores.publication || 0);
    const readinessB = Number(b.scores.publication || 0);
    const stockA = Number(a.stock || a.dslite_snapshot?.estoque || 0);
    const stockB = Number(b.stock || b.dslite_snapshot?.estoque || 0);
    const marginA = Number(a.pricing?.selected?.grossMargin || a.pricing?.grossMargin || 0);
    const marginB = Number(b.pricing?.selected?.grossMargin || b.pricing?.grossMargin || 0);
    return readinessB - readinessA || stockB - stockA || marginB - marginA || Number(b.scores.documentary ?? -1) - Number(a.scores.documentary ?? -1) || Number(a.remote.remote_listing_found) - Number(b.remote.remote_listing_found);
  }).slice(0, 20);
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const integrations = await loadIntegrations();
  const run = await createRun();
  console.log(JSON.stringify({ event: 'sanitize_run_started', run_id: run.id, source_job_id: SOURCE_JOB_ID }));
  try {
    const remoteScan = await scanRemoteInventory({ mercadolivre: integrations.mercadolivre, account: integrations.account });
    const remoteIndex = buildRemoteIndex(remoteScan.items);
    const context = { integrations, remoteScan, remoteIndex, research: new ResearchClient(learnedOfficialDomains()) };
    const apiErrors = phase1.audits.filter((audit) => audit.audit_status === 'P0_API_ERROR');
    if (apiErrors.length !== 408) throw new Error(`expected_408_api_errors_got_${apiErrors.length}`);
    const reprocessed = [];
    for (let index = 0; index < apiErrors.length; index += 1) {
      const audit = apiErrors[index];
      try { reprocessed.push(await reprocessApiError(audit, context)); }
      catch (error) {
        const product = audit.level0_snapshot.produto;
        const remote = auditRemoteProduct({ index: remoteIndex, scanReliable: remoteScan.reliable, product, dslite: {}, phase1: audit, catalogProductId: '' });
        reprocessed.push({ sku: audit.sku, supplier: audit.fornecedor_nome, previous_status: audit.audit_status, previous_error: audit.block_reason, attempts: 0, source_status: 'SOURCE_LOOKUP_DEFERRED', source_lookup_error: error.message, identity_confirmed: false, attributes_found: [], attributes_missing: [], gtin: '', images: { available_count: 0, approved: false, checked: [] }, category: {}, remote, scores: { structural: 0, documentary: null, publication: 0 }, new_status: 'SOURCE_LOOKUP_DEFERRED', block_reason: 'sanitize_pipeline_error', publication_gates: {} });
      }
      const current = reprocessed.at(-1);
      await persistResult(run, audit, current);
      if ((index + 1) % 10 === 0) console.log(JSON.stringify({ event: 'api_error_reprocess', processed: index + 1, total: apiErrors.length }));
    }
    const candidates = [];
    for (const sku of MANUAL_CANDIDATES) {
      const audit = phase1.audits.find((row) => row.sku === sku);
      const result = await sanitizeCandidate(audit, context);
      candidates.push(result);
      await persistResult(run, audit, result);
    }
    const reprocessedMap = new Map(reprocessed.map((row) => [row.sku, row]));
    const candidateMap = new Map(candidates.map((row) => [row.sku, row]));
    const gtinRows = await classifyMissingGtins(context, reprocessedMap, candidateMap);
    const remoteRows = buildRemoteRows(context, reprocessedMap, candidateMap);
    const allResults = [...reprocessed, ...candidates];
    const top20 = topCandidates(allResults);
    const sourceDistribution = distribution(reprocessed, 'source_status');
    const newStateDistribution = distribution(reprocessed, 'new_status');
    const gtinDistribution = distribution(gtinRows, 'status');
    const scoreSummary = {
      structural_average: allResults.reduce((sum, row) => sum + Number(row.scores.structural || 0), 0) / allResults.length,
      documentary_scored: allResults.filter((row) => row.scores.documentary !== null).length,
      documentary_deferred: allResults.filter((row) => row.scores.documentary === null).length,
      publication_average: allResults.reduce((sum, row) => sum + Number(row.scores.publication || 0), 0) / allResults.length,
    };
    const summary = {
      generated_at: now(), mode: 'AUDIT_ONLY', source_job_id: SOURCE_JOB_ID, sanitize_run_id: run.id,
      population_reprocessed: { total: reprocessed.length, by_supplier: distribution(reprocessed, 'supplier'), by_state: newStateDistribution },
      infrastructure: { ...metrics, remote_inventory: { seller_id: remoteScan.seller_id, expected_total: remoteScan.expected_total, captured: remoteScan.ids.length, detailed: remoteScan.items.length, pages: remoteScan.pages, statuses: remoteScan.statuses, reliable: remoteScan.reliable, missing_details: remoteScan.missing_details } },
      sources: sourceDistribution,
      gtin: gtinDistribution,
      remote_listings: { verified: remoteRows.length, found: remoteRows.filter((row) => row.remote_listing_found).length, conflicts: remoteRows.filter((row) => row.lookup_status === 'TITLE_MODEL_CANDIDATE_ONLY').length, lookup_reliable: remoteScan.reliable },
      quality: scoreSummary,
      candidates: candidates.map((row) => ({ sku: row.sku, status: row.new_status, block_reason: row.block_reason, scores: row.scores, missing_attributes: row.missing_attributes?.map((attribute) => attribute.id), title: row.content?.title || null })),
      top20: top20.map((row) => ({ sku: row.sku, supplier: row.supplier, status: row.new_status, stock: row.stock || row.dslite_snapshot?.estoque || null, margin: row.pricing?.selected?.grossMargin || row.pricing?.grossMargin || null, scores: row.scores, remote_listing_found: row.remote.remote_listing_found, block_reason: row.block_reason })),
      published: 0,
    };
    const full = { ...summary, gtin_rows: gtinRows, remote_rows: remoteRows, api_error_reprocess: reprocessed, sanitized_candidates: candidates };
    fs.writeFileSync(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    fs.writeFileSync(path.join(REPORT_DIR, 'full-report.json'), JSON.stringify(full, null, 2) + '\n');
    fs.writeFileSync(path.join(REPORT_DIR, 'gtin-classification.csv'), toCsv(['sku', 'fornecedor', 'nome', 'gtin_atual', 'categoria_gtin', 'justificativa', 'fonte', 'status', 'conditional_required_ids', 'dslite_gtin_live'], gtinRows));
    fs.writeFileSync(path.join(REPORT_DIR, 'remote-listing-audit.csv'), toCsv(['sku', 'fornecedor', 'remote_listing_checked', 'remote_listing_found', 'remote_item_ids', 'lookup_method', 'lookup_status', 'lookup_error'], remoteRows));
    fs.writeFileSync(path.join(REPORT_DIR, 'api-error-reprocess.csv'), toCsv(['sku', 'supplier', 'previous_status', 'previous_error', 'attempts', 'source_status', 'source_lookup_error', 'source_found', 'identity_confirmed', 'attributes_found', 'attributes_missing', 'gtin', 'new_status', 'block_reason'], reprocessed.map((row) => ({ ...row, attributes_found: row.attributes_found.join('|'), attributes_missing: row.attributes_missing.join('|') }))));
    fs.writeFileSync(path.join(REPORT_DIR, 'candidates.csv'), toCsv(['sku', 'supplier', 'product', 'gtin', 'stock', 'source_status', 'official_source', 'new_status', 'block_reason', 'structural_score', 'documentary_score', 'publication_score', 'missing_attributes', 'title'], allResults.map((row) => ({ ...row, product: row.product || row.dslite_snapshot?.titulo || '', structural_score: row.scores.structural, documentary_score: row.scores.documentary, publication_score: row.scores.publication, missing_attributes: (row.missing_attributes || []).map((attribute) => attribute.id || attribute).join('|'), title: row.content?.title || '' }))));
    const { error } = await supabase.from('ml_p0_sanitize_runs').update({ status: 'completed', infrastructure_metrics: metrics, result_summary: summary, completed_at: now() }).eq('id', run.id);
    if (error) throw error;
    console.log(JSON.stringify({ event: 'sanitize_completed', run_id: run.id, reprocessed: reprocessed.length, new_states: newStateDistribution, gtin: gtinDistribution, remote: summary.remote_listings, candidates: summary.candidates }));
  } catch (error) {
    await supabase.from('ml_p0_sanitize_runs').update({ status: 'failed', infrastructure_metrics: metrics, result_summary: { error: error.message }, completed_at: now() }).eq('id', run.id);
    throw error;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'sanitize_fatal', error: error.message, stack: error.stack }));
  process.exit(1);
});
