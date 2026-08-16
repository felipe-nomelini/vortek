const crypto = require('crypto');
const { normalizeGtin, plain, text, isSensitive } = require('./ml-p0-audit');

const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const PRODUCT_IDENTIFIER_IDS = new Set(['GTIN', 'EAN', 'UPC', 'JAN', 'ISBN', 'ISBN10', 'ISBN13', 'GTIN14']);

const KNOWN_OFFICIAL_DOMAINS = {
  agratto: ['agratto.com.br'],
  daddario: ['daddario.com'],
  hayonik: ['hayonik.com.br'],
  logitech: ['logitech.com', 'logitechstore.com.br'],
  tagima: ['tagima.com.br'],
  thunderx3: ['thunderx3.com.br'],
  toshiba: ['toshibaenergia.com.br'],
  yamaha: ['yamaha.com', 'br.yamaha.com'],
};

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function brandKey(value) {
  return plain(value).replace(/[^a-z0-9]/g, '');
}

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function officialDomainsFor(brand, learned = {}) {
  const key = brandKey(brand);
  return [...new Set([...(KNOWN_OFFICIAL_DOMAINS[key] || []), ...(learned[key] || [])])];
}

function isKnownOfficialUrl(url, brand, learned = {}) {
  const host = hostOf(url);
  return officialDomainsFor(brand, learned).some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function jitteredBackoff(attempt, baseMs = 1000, maxMs = 15000, random = Math.random) {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.75 + random() * 0.5));
}

class RateGate {
  constructor({ minIntervalMs = 0 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.tail = Promise.resolve();
    this.lastStartedAt = 0;
  }

  schedule(task) {
    const run = async () => {
      const wait = Math.max(0, this.lastStartedAt + this.minIntervalMs - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastStartedAt = Date.now();
      return task();
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function extractItemIdentity(item) {
  const skus = new Set();
  const gtins = new Set();
  const addAttribute = (attribute) => {
    const value = text(attribute?.value_name || attribute?.value_id);
    if (!value) return;
    if (attribute.id === 'SELLER_SKU') skus.add(value);
    if (PRODUCT_IDENTIFIER_IDS.has(attribute.id)) {
      const gtin = normalizeGtin(value);
      if (gtin) gtins.add(gtin);
    }
  };
  if (text(item.seller_custom_field)) skus.add(text(item.seller_custom_field));
  for (const attribute of item.attributes || []) addAttribute(attribute);
  for (const variation of item.variations || []) {
    if (text(variation.seller_custom_field)) skus.add(text(variation.seller_custom_field));
    for (const attribute of variation.attributes || []) addAttribute(attribute);
    for (const attribute of variation.attribute_combinations || []) addAttribute(attribute);
  }
  return {
    item_id: text(item.id),
    user_product_id: text(item.user_product_id),
    catalog_product_id: text(item.catalog_product_id),
    title: text(item.title),
    status: text(item.status),
    seller_id: item.seller_id ? String(item.seller_id) : '',
    skus: [...skus],
    gtins: [...gtins],
  };
}

function buildRemoteIndex(items) {
  const index = { sku: new Map(), gtin: new Map(), userProduct: new Map(), item: new Map(), catalogProduct: new Map(), all: [] };
  const add = (map, key, row) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };
  for (const item of items) {
    const row = extractItemIdentity(item);
    index.all.push(row);
    add(index.item, row.item_id, row);
    add(index.userProduct, row.user_product_id, row);
    add(index.catalogProduct, row.catalog_product_id, row);
    for (const sku of row.skus) add(index.sku, sku, row);
    for (const gtin of row.gtins) add(index.gtin, gtin, row);
  }
  return index;
}

function titleModelCandidates(index, product, model) {
  const modelText = text(model);
  if (modelText.length < 4) return [];
  const brand = plain(product.marca || '');
  const modelNorm = plain(modelText);
  return index.all.filter((item) => {
    const title = plain(item.title);
    return title.includes(modelNorm) && (!brand || title.includes(brand));
  });
}

function auditRemoteProduct({ index, scanReliable, product, dslite, phase1, catalogProductId }) {
  const exact = new Map();
  const methods = [];
  const addRows = (method, rows) => {
    methods.push(method);
    for (const row of rows || []) exact.set(row.item_id, row);
  };
  addRows('seller_sku_full_inventory', index.sku.get(product.sku));
  const gtin = normalizeGtin(dslite?.ean11 || product.gtin);
  if (gtin) addRows('gtin_full_inventory', index.gtin.get(gtin));
  else methods.push('gtin_unavailable');
  if (text(phase1?.ml_item_id || product.ml_item_id)) addRows('item_id', index.item.get(text(phase1?.ml_item_id || product.ml_item_id)));
  else methods.push('item_id_unavailable');
  const userProductId = text(phase1?.duplicate_audit?.user_product_id);
  if (userProductId) addRows('user_product_id', index.userProduct.get(userProductId));
  else methods.push('user_product_id_unavailable');
  if (catalogProductId) addRows('catalog_product_id', index.catalogProduct.get(catalogProductId));
  else methods.push('catalog_product_id_unavailable');
  const model = dslite?.modelo || dslite?.part_number || '';
  const titleCandidates = titleModelCandidates(index, product, model);
  methods.push('title_model_diagnostic');
  const rows = [...exact.values()];
  return {
    remote_listing_checked: true,
    remote_listing_found: rows.length > 0,
    remote_item_ids: rows.map((row) => row.item_id),
    exact_matches: rows,
    title_model_candidates: titleCandidates.map((row) => row.item_id),
    lookup_method: methods.join('|'),
    lookup_status: !scanReliable ? 'INVENTORY_SCAN_UNRELIABLE' : rows.length ? 'FOUND_EXACT' : titleCandidates.length ? 'TITLE_MODEL_CANDIDATE_ONLY' : 'NOT_FOUND',
    lookup_error: scanReliable ? '' : 'seller_inventory_scan_incomplete',
  };
}

function sourceScores(status) {
  if (status === 'SOURCE_FOUND_OFFICIAL') return 100;
  if (status === 'SOURCE_FOUND_SECONDARY') return 60;
  if (status === 'SOURCE_NOT_FOUND') return 20;
  if (status === 'SOURCE_CONFLICT' || status === 'SOURCE_IDENTITY_MISMATCH') return 0;
  return null;
}

function structuralScore({ product, offer, dslite, imageApproved, categoryValidated }) {
  let score = 0;
  if (product.ativo && product.ml_status === 'sem_anuncio') score += 15;
  if (Number(product.estoque) > 0 && Number(offer.estoque) > 0) score += 15;
  if (Number(offer.custo) > 0) score += 10;
  if (text(dslite?.marca || product.marca)) score += 10;
  if (text(dslite?.modelo || dslite?.part_number) || normalizeGtin(dslite?.ean11 || product.gtin)) score += 15;
  if (text(dslite?.descricao || product.descricao)) score += 10;
  if (imageApproved) score += 15;
  if (categoryValidated) score += 10;
  return Math.min(100, score);
}

function publicationScore(gates) {
  const weights = { identity: 20, source: 15, remote: 15, category: 10, attributes: 15, image: 10, pricing: 10, content: 5 };
  return Object.entries(weights).reduce((score, [key, weight]) => score + (gates[key] ? weight : 0), 0);
}

function selectNewStatus({ sourceStatus, identityConfirmed, gtinConflict, remoteAudit, categoryValidated, attributesComplete, imageApproved, pricingApproved, contentReady, sensitive }) {
  if (gtinConflict) return ['P0_MANUAL_GTIN', 'gtin_conflict'];
  if (remoteAudit.remote_listing_found) return ['P0_MANUAL_IDENTITY', 'remote_listing_exists'];
  if (remoteAudit.lookup_status === 'TITLE_MODEL_CANDIDATE_ONLY') return ['P0_MANUAL_IDENTITY', 'possible_remote_listing_requires_review'];
  if (sourceStatus === 'SOURCE_LOOKUP_DEFERRED') return ['SOURCE_LOOKUP_DEFERRED', 'external_source_infrastructure_deferred'];
  if (remoteAudit.lookup_status === 'INVENTORY_SCAN_UNRELIABLE') return ['P0_MANUAL_TECH', 'remote_lookup_unreliable'];
  if (sourceStatus === 'SOURCE_NOT_FOUND') return ['SOURCE_NOT_FOUND', 'official_source_not_found'];
  if (sourceStatus === 'SOURCE_FOUND_SECONDARY') return ['P0_MANUAL_IDENTITY', 'official_source_not_confirmed'];
  if (sourceStatus === 'SOURCE_CONFLICT') return ['P0_MANUAL_TECH', 'source_conflict'];
  if (sourceStatus === 'SOURCE_IDENTITY_MISMATCH' || !identityConfirmed) return ['P0_MANUAL_IDENTITY', 'identity_not_confirmed'];
  if (!imageApproved) return ['P0_MANUAL_IMAGE', 'image_not_approved'];
  if (!categoryValidated || !attributesComplete || !pricingApproved || !contentReady) return ['P0_MANUAL_TECH', 'publication_requirements_incomplete'];
  if (sensitive && sourceStatus !== 'SOURCE_FOUND_OFFICIAL') return ['P0_MANUAL_TECH', 'sensitive_product_requires_official_source'];
  return ['P0_READY', null];
}

function classifyGtin({ categoryGtin, conditionalRequired, dsliteGtin, phase1Status, sourceStatus, officialConfirmsAbsent }) {
  if (officialConfirmsAbsent) return 'GTIN_CONFIRMED_ABSENT';
  if (phase1Status === 'P0_MANUAL_IDENTITY' || sourceStatus === 'SOURCE_IDENTITY_MISMATCH') return 'GTIN_IDENTITY_BLOCKED';
  if (sourceStatus === 'SOURCE_LOOKUP_DEFERRED') return 'GTIN_LOOKUP_BLOCKED';
  if (categoryGtin === 'not_required' && !conditionalRequired) return 'GTIN_NOT_REQUIRED';
  if (!normalizeGtin(dsliteGtin)) return 'GTIN_SUPPLIER_MISSING';
  return 'GTIN_NOT_FOUND';
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function toCsv(headers, rows) {
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n') + '\n';
}

module.exports = {
  KNOWN_OFFICIAL_DOMAINS,
  PRODUCT_IDENTIFIER_IDS,
  RateGate,
  TRANSIENT_HTTP,
  auditRemoteProduct,
  brandKey,
  buildRemoteIndex,
  classifyGtin,
  extractItemIdentity,
  isKnownOfficialUrl,
  jitteredBackoff,
  officialDomainsFor,
  publicationScore,
  selectNewStatus,
  sha256,
  sourceScores,
  structuralScore,
  toCsv,
};
