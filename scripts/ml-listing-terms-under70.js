#!/usr/bin/env node

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { deleteMlListingPermanentlyWith } = require('../src/lib/ml/listing-deletion-core.ts');
const { detachDeletedMlListing } = require('../src/lib/ml/listing-deletion-database.ts');
const {
  batchManifestState,
  classifyMlListingUnder70,
  hasActiveMixedPriceGroup,
  isMlListingDeletedForBatch,
} = require('../src/lib/ml/listing-terms-batch-core.ts');
const { normalizeMlListingTermsWith } = require('./lib/ml-listing-terms-operation');

const OPERATION_KEY = 'ml-under70-terms-20260913-v1';
const JOB_TYPE = 'ml_listing_terms_under70';
const TABLE = 'ml_listing_terms_batch_items';
const SUPABASE_PRODUCTION_IP = '192.168.1.162';
const BULK_SIZE = 20;
const DB_BATCH_SIZE = 180;
const SCAN_PAGE_SIZE = 100;
const SOURCE_VALIDATION_CONCURRENCY = 6;

const KNOWN_PAIRS = [
  { sku: 'VTK012448', standardId: 'MLB7111713346', catalogId: 'MLB4880526723', catalogState: 'closed', reason: 'catalog_closed_required' },
  { sku: 'VTK012044', standardId: 'MLB7111711972', catalogId: 'MLB4880561333', catalogState: 'closed', reason: 'catalog_closed_required' },
  { sku: 'VTK012651', standardId: 'MLB4857635575', catalogId: 'MLB7173718908', catalogState: 'closed', reason: 'catalog_conflicts_with_source' },
  { sku: 'VTK012444', standardId: 'MLB4857623221', catalogId: 'MLB7149339312', catalogState: 'closed', reason: 'listing_conflicts_with_source' },
  { sku: 'VTK017218', standardId: 'MLB4937546181', catalogId: 'MLB7381238864', catalogState: 'under_review', reason: 'wrong_catalog_exact_duplicate', duplicateOf: 'MLB5199882917' },
  { sku: 'VTK017345', standardId: 'MLB4994950929', catalogId: 'MLB5005542855', catalogState: 'under_review', reason: 'exact_duplicate', duplicateOf: 'MLB7602525364' },
  { sku: 'VTK012141', standardId: 'MLB7111714590', catalogId: 'MLB4880560607', catalogState: 'active', reason: 'catalog_attribute_conflicts_with_source' },
  { sku: 'VTK017875', standardId: 'MLB5204988407', catalogId: 'MLB7608375690', catalogState: 'active', reason: 'catalog_attribute_conflicts_with_source' },
];

const PROTECTED_SURVIVORS = [
  { sku: 'VTK017219', itemId: 'MLB5199882917', belowThreshold: false },
  { sku: 'VTK017806', itemId: 'MLB7602525364', belowThreshold: true },
];

function argValue(name) {
  const prefix = `${name}=`;
  const direct = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function selectedMode() {
  const explicit = String(argValue('--mode') || '').trim().toLowerCase();
  if (explicit) return explicit;
  for (const mode of ['inspect', 'prepare', 'canary', 'apply', 'verify']) {
    if (process.argv.includes(`--${mode}`)) return mode;
  }
  return 'inspect';
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function consume() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, consume));
  return results;
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function gtinKey(value) {
  return digits(value).replace(/^0+(?=\d)/, '');
}

function brandsEquivalent(left, right) {
  const leftCompact = normalizeText(left).replace(/\s+/g, '');
  const rightCompact = normalizeText(right).replace(/\s+/g, '');
  if (!leftCompact || !rightCompact) return true;
  if (leftCompact === rightCompact) return true;
  const shorter = leftCompact.length <= rightCompact.length ? leftCompact : rightCompact;
  const longer = leftCompact.length > rightCompact.length ? leftCompact : rightCompact;
  return shorter.length >= 5 && longer.includes(shorter);
}

function extractAttribute(item, id) {
  const attribute = (Array.isArray(item?.attributes) ? item.attributes : [])
    .find((entry) => String(entry?.id || '').trim().toUpperCase() === id);
  return String(attribute?.value_name || attribute?.values?.[0]?.name || attribute?.value_id || '').trim();
}

function extractSku(item) {
  return String(item?.seller_custom_field || extractAttribute(item, 'SELLER_SKU') || '').trim();
}

function manifestHash(rows) {
  const material = rows
    .map((row) => ({
      ml_item_id: row.ml_item_id,
      action: row.action,
      reason: row.reason,
      before_state: row.before_state,
      desired_state: row.desired_state,
      is_canary: row.is_canary === true,
    }))
    .sort((a, b) => a.ml_item_id.localeCompare(b.ml_item_id));
  return crypto.createHash('sha256').update(canonicalJson(material)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function nowIso() {
  return new Date().toISOString();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function event(name, details = {}) {
  return { event: name, at: nowIso(), ...details };
}

async function assertProductionDatabaseTarget() {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 é obrigatório.');
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (branch !== 'dev') throw new Error(`Branch bloqueada: ${branch || '(vazia)'}. Use dev.`);

  const raw = String(process.env.SUPABASE_SERVICE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!raw || !key) throw new Error('SUPABASE_SERVICE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== SUPABASE_PRODUCTION_IP) {
    throw new Error(`Destino bloqueado: somente ${SUPABASE_PRODUCTION_IP} é gravável nesta operação.`);
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => entry.address !== SUPABASE_PRODUCTION_IP)) {
    throw new Error('Não foi possível comprovar o Supabase produtivo .162.');
  }
  return { url: raw, key };
}

function makeDb(config) {
  return createClient(config.url, config.key, { auth: { autoRefreshToken: false, persistSession: false } });
}

class ExternalClients {
  constructor(db, allowTokenRefresh) {
    this.db = db;
    this.allowTokenRefresh = allowTokenRefresh;
    this.mlToken = null;
    this.mlAccount = null;
    this.mlIntegration = null;
    this.dsliteConfig = null;
  }

  async loadMlIntegration() {
    if (this.mlIntegration) return this.mlIntegration;
    const { data, error } = await this.db.from('integracoes').select('*').eq('tipo', 'mercadolivre').maybeSingle();
    if (error || !data) throw new Error(`Integração Mercado Livre indisponível: ${error?.message || 'não encontrada'}`);
    this.mlIntegration = data;
    return data;
  }

  async validMlToken(force = false) {
    const integration = await this.loadMlIntegration();
    const expiresAt = new Date(integration.token_expires_at || 0).getTime();
    if (!force && integration.access_token && expiresAt - Date.now() > 5 * 60 * 1000) {
      this.mlAccount = await assertAllowedMercadoLivreToken(integration.access_token, `${OPERATION_KEY}:cached`);
      this.mlToken = integration.access_token;
      return integration.access_token;
    }
    if (!this.allowTokenRefresh) throw new Error('Token ML precisa ser renovado; execute prepare/apply autorizado.');
    if (!integration.refresh_token || !integration.client_id || !integration.client_secret) {
      throw new Error('Integração ML sem credenciais de renovação.');
    }
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: integration.client_id,
        client_secret: integration.client_secret,
        refresh_token: integration.refresh_token,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
      throw new Error(`Renovação do token ML falhou com HTTP ${response.status}.`);
    }
    this.mlAccount = await assertAllowedMercadoLivreToken(payload.access_token, `${OPERATION_KEY}:refresh`);
    const patch = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_expires_at: new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString(),
      conectado: true,
      last_refresh_at: nowIso(),
      last_refresh_error: null,
      last_refresh_error_code: null,
    };
    const { error } = await this.db.from('integracoes').update(patch).eq('tipo', 'mercadolivre');
    if (error) throw new Error(`Token renovado, mas não persistido: ${error.message}`);
    Object.assign(integration, patch);
    this.mlToken = payload.access_token;
    return payload.access_token;
  }

  async ml(path, options = {}, authRetry = true) {
    const token = this.mlToken || await this.validMlToken();
    const response = await fetch(`https://api.mercadolibre.com${path}`, {
      ...options,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    if (response.status === 401 && authRetry && this.allowTokenRefresh) {
      this.mlToken = await this.validMlToken(true);
      return this.ml(path, options, false);
    }
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? data : null,
      error: response.ok ? null : {
        code: String(data?.error || data?.code || `http_${response.status}`),
        message: String(data?.message || `Mercado Livre respondeu HTTP ${response.status}`),
      },
    };
  }

  async loadDsliteConfig() {
    if (this.dsliteConfig) return this.dsliteConfig;
    const { data, error } = await this.db.from('integracoes').select('url,access_token').eq('tipo', 'dslite').maybeSingle();
    if (error || !data?.url || !data?.access_token) throw new Error('Configuração DSLite indisponível.');
    this.dsliteConfig = { url: String(data.url).replace(/\/+$/, ''), token: data.access_token };
    return this.dsliteConfig;
  }

  async dsliteProduct(supplierId, productId) {
    const config = await this.loadDsliteConfig();
    const path = `/v1/CrossDocking/Catalogo/${encodeURIComponent(supplierId)}/${encodeURIComponent(productId)}`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${config.url}${path}`, {
        headers: { Accept: 'application/json', Token: config.token },
      });
      const data = await response.json().catch(() => null);
      const product = data?.produto || (Array.isArray(data?.produtos) ? data.produtos[0] : null);
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 5) {
        return { ok: response.ok && Boolean(product), status: response.status, product: product || null };
      }
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 30_000)
        : Math.min(1000 * (2 ** attempt), 10_000);
      await wait(delay);
    }
    return { ok: false, status: 0, product: null };
  }
}

async function fetchAllMlItemIds(clients, sellerId) {
  const itemIds = [];
  const seen = new Set();
  let scrollId = '';
  let pages = 0;
  while (true) {
    const path = scrollId
      ? `/users/${encodeURIComponent(sellerId)}/items/search?search_type=scan&limit=${SCAN_PAGE_SIZE}&scroll_id=${encodeURIComponent(scrollId)}`
      : `/users/${encodeURIComponent(sellerId)}/items/search?search_type=scan&limit=${SCAN_PAGE_SIZE}`;
    const result = await clients.ml(path);
    if (!result.ok || !result.data) throw new Error(result.error?.message || 'Falha no scan do Mercado Livre.');
    pages += 1;
    const pageIds = Array.isArray(result.data.results) ? result.data.results.map(String) : [];
    for (const itemId of pageIds) {
      if (!seen.has(itemId)) {
        seen.add(itemId);
        itemIds.push(itemId);
      }
    }
    if (pageIds.length === 0) break;
    const nextScroll = String(result.data.scroll_id || '').trim();
    if (!nextScroll || nextScroll === scrollId) throw new Error('Cursor do scan ML não avançou.');
    scrollId = nextScroll;
  }
  return { itemIds, pages };
}

function buildBulkPath(itemIds) {
  if (!itemIds.length || itemIds.length > BULK_SIZE) throw new Error('Lote ML deve conter de 1 a 20 IDs.');
  const fields = [
    'status', 'sub_status', 'price', 'listing_type_id', 'shipping', 'tags', 'title',
    'seller_custom_field', 'attributes', 'sold_quantity', 'available_quantity', 'user_product_id',
    'catalog_product_id', 'catalog_listing', 'last_updated', 'seller_id',
  ];
  const ids = itemIds.map(encodeURIComponent).join(',');
  const attributes = ['id', 'status_code', ...fields.map((field) => `body.${field}`)]
    .map(encodeURIComponent).join(',');
  return `/items/bulk?ids=${ids}&attributes=${attributes}`;
}

async function fetchItems(clients, itemIds) {
  const items = new Map();
  for (const batch of chunks(itemIds, BULK_SIZE)) {
    const result = await clients.ml(buildBulkPath(batch));
    if (!result.ok || !Array.isArray(result.data)) throw new Error(result.error?.message || 'Falha no lote de itens ML.');
    for (const row of result.data) {
      const id = String(row?.id || '').trim();
      if (Number(row?.status_code) === 200 && id && row.body) items.set(id, { ...row.body, id });
    }
  }
  if (items.size !== itemIds.length) throw new Error(`Mercado Livre devolveu ${items.size}/${itemIds.length} anúncios.`);
  return items;
}

async function fetchTableByValues(db, table, columns, filterColumn, values) {
  const rows = [];
  for (const batch of chunks([...new Set(values.filter(Boolean))], DB_BATCH_SIZE)) {
    if (!batch.length) continue;
    const { data, error } = await db.from(table).select(columns).in(filterColumn, batch);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
}

async function loadLocalContext(db, items) {
  const itemIds = [...items.keys()];
  const [listings, snapshots, primaryProducts] = await Promise.all([
    fetchTableByValues(db, 'anuncios_ml', 'ml_item_id,produto_id,sku,status,tipo', 'ml_item_id', itemIds),
    fetchTableByValues(db, 'catalogo_ml_snapshot', 'ml_item_id,produto_id,catalog_product_id,catalog_listing,status,price', 'ml_item_id', itemIds),
    fetchTableByValues(db, 'produtos', 'id,ml_item_id', 'ml_item_id', itemIds),
  ]);
  const productIdByItem = new Map();
  for (const row of [...snapshots, ...listings]) if (row.produto_id) productIdByItem.set(String(row.ml_item_id), String(row.produto_id));
  for (const row of primaryProducts) if (row.ml_item_id) productIdByItem.set(String(row.ml_item_id), String(row.id));
  const productColumns = 'id,sku,nome,marca,gtin,dslite_fornecedor_id,dslite_produto_id,dslite_ultima_sync,oferta_preferencial_id,ativo,ml_item_id';
  const missingSkus = [...new Set([...items.values()]
    .filter((item) => !productIdByItem.has(String(item.id)))
    .map(extractSku)
    .filter(Boolean))];
  const productsBySku = await fetchTableByValues(db, 'produtos', productColumns, 'sku', missingSkus);
  const productIdBySku = new Map(productsBySku.map((row) => [String(row.sku || '').trim(), String(row.id)]));
  for (const item of items.values()) {
    if (productIdByItem.has(String(item.id))) continue;
    const productId = productIdBySku.get(extractSku(item));
    if (productId) productIdByItem.set(String(item.id), productId);
  }
  const productIds = [...new Set(productIdByItem.values())];
  const productsById = await fetchTableByValues(
    db,
    'produtos',
    productColumns,
    'id',
    productIds,
  );
  const offers = await fetchTableByValues(
    db,
    'produto_fornecedor_ofertas',
    'id,produto_id,dslite_fornecedor_id,dslite_produto_id,sku_oferta,sku_fornecedor,nome,marca,gtin,ativo,last_sync_at',
    'produto_id',
    productIds,
  );
  return {
    listings,
    snapshots,
    productIdByItem,
    productsById: new Map(productsById.map((row) => [String(row.id), row])),
    offersByProduct: Map.groupBy(offers, (row) => String(row.produto_id)),
  };
}

function sourceReference(local, itemId) {
  const productId = local.productIdByItem.get(itemId) || null;
  const product = productId ? local.productsById.get(productId) || null : null;
  const offers = productId ? local.offersByProduct.get(productId) || [] : [];
  const preferred = offers.find((row) => String(row.id) === String(product?.oferta_preferencial_id || ''))
    || offers.find((row) => row.ativo !== false)
    || null;
  return { productId, product, preferred, offers };
}

async function validateAgainstSource(clients, item, source, requireDirectDslite) {
  const product = source.product;
  if (!product) return { ok: false, reason: 'bentevi_product_not_found', evidence: {} };
  const expectedSku = String(product.sku || '').trim();
  const itemSku = extractSku(item);
  if (itemSku && expectedSku && itemSku !== expectedSku) {
    return { ok: false, reason: 'seller_sku_conflicts_with_bentevi', evidence: { expected_sku: expectedSku, item_sku: itemSku } };
  }

  let direct = null;
  if (requireDirectDslite) {
    const supplierId = String(product.dslite_fornecedor_id || source.preferred?.dslite_fornecedor_id || '').trim();
    const dsliteProductId = String(product.dslite_produto_id || source.preferred?.dslite_produto_id || '').trim();
    if (!supplierId || !dsliteProductId) {
      return { ok: false, reason: 'dslite_identity_missing', evidence: { expected_sku: expectedSku } };
    }
    const result = await clients.dsliteProduct(supplierId, dsliteProductId);
    if (!result.ok || !result.product) {
      return { ok: false, reason: 'dslite_product_unavailable', evidence: { expected_sku: expectedSku, http: result.status } };
    }
    direct = result.product;
  }

  const sourceGtins = [...new Set([
    gtinKey(product.gtin), gtinKey(source.preferred?.gtin), gtinKey(direct?.ean11),
  ].filter(Boolean))];
  const itemGtin = gtinKey(extractAttribute(item, 'GTIN') || extractAttribute(item, 'EAN'));
  if (itemGtin && sourceGtins.length && !sourceGtins.includes(itemGtin)) {
    return { ok: false, reason: 'gtin_conflicts_with_source', evidence: { expected_sku: expectedSku, item_gtin: itemGtin, source_gtins: sourceGtins } };
  }

  const sourceBrand = normalizeText(direct?.marca || product.marca || source.preferred?.marca);
  const itemBrand = normalizeText(extractAttribute(item, 'BRAND'));
  if (sourceBrand && itemBrand && !brandsEquivalent(sourceBrand, itemBrand)) {
    return { ok: false, reason: 'brand_conflicts_with_source', evidence: { expected_sku: expectedSku, item_brand: itemBrand, source_brand: sourceBrand } };
  }

  return {
    ok: true,
    reason: 'source_confirmed',
    evidence: {
      expected_sku: expectedSku,
      produto_id: source.productId,
      source_gtins: sourceGtins,
      dslite_supplier_id: String(product.dslite_fornecedor_id || source.preferred?.dslite_fornecedor_id || '') || null,
      dslite_product_id: String(product.dslite_produto_id || source.preferred?.dslite_produto_id || '') || null,
      dslite_checked: Boolean(direct),
    },
  };
}

async function resolveCatalogRequirement(clients, standard, source) {
  let catalogProductId = String(standard.catalog_product_id || '').trim();
  if (!catalogProductId) {
    const gtin = digits(source.product?.gtin || source.preferred?.gtin);
    if (!gtin) return { ok: false, reason: 'catalog_product_not_identified' };
    const search = await clients.ml(`/products/search?site_id=MLB&status=active&product_identifier=${encodeURIComponent(gtin)}`);
    const ids = [...new Set((search.data?.results || [])
      .map((row) => String(row?.catalog_product_id || row?.id || '').trim())
      .filter((id) => /^MLB\d+$/.test(id)))];
    if (!search.ok || search.data?.query_type !== 'GTIN' || ids.length !== 1) {
      return { ok: false, reason: 'catalog_product_identity_not_unique' };
    }
    catalogProductId = ids[0];
  }
  const result = await clients.ml(`/products/${encodeURIComponent(catalogProductId)}`);
  if (!result.ok || !result.data) return { ok: false, reason: 'catalog_product_unavailable' };
  return {
    ok: true,
    required: String(result.data?.settings?.listing_strategy || '') === 'catalog_required',
    catalogProductId,
  };
}

async function verifyDuplicateModeration(clients, pair) {
  if (!pair.duplicateOf) return { ok: true, evidence: {} };
  const result = await clients.ml(`/moderations/last_moderation/${encodeURIComponent(pair.catalogId)}-ITM`);
  const entries = Array.isArray(result.data) ? result.data : [];
  const exact = entries.find((entry) => String(entry?.name || '') === 'EXACT_DUPLICATE_CATALOG');
  const references = (exact?.evidence || []).map((entry) => String(entry?.text_matched || '')).filter(Boolean);
  const expectedReference = pair.duplicateOf.replace(/^MLB/, '');
  return {
    ok: result.ok && Boolean(exact) && references.includes(expectedReference),
    evidence: { moderation: exact?.name || null, duplicate_of: pair.duplicateOf, references },
  };
}

function makeManifestRow({ item, source, action, reason, desiredState, evidence = {}, priority = 100 }) {
  return {
    ml_item_id: String(item.id),
    ordinal: priority,
    sku: String(source.product?.sku || extractSku(item) || '').trim() || null,
    produto_id: source.productId || null,
    action,
    reason,
    is_canary: false,
    before_state: batchManifestState(item),
    desired_state: desiredState || {},
    source_evidence: evidence,
    status: action === 'blocked' ? 'blocked' : 'prepared',
  };
}

async function buildManifest(db, clients) {
  await clients.validMlToken();
  const me = await clients.ml('/users/me');
  if (!me.ok || !me.data?.id) throw new Error('Não foi possível confirmar a conta ML.');
  if (String(me.data.id) !== String(clients.mlAccount?.userId || '')) throw new Error('Identidade ML divergente.');

  const scan = await fetchAllMlItemIds(clients, me.data.id);
  const items = await fetchItems(clients, scan.itemIds);
  const allIds = [...items.keys()];
  const local = await loadLocalContext(db, items);
  const knownIds = new Set(KNOWN_PAIRS.flatMap((pair) => [pair.standardId, pair.catalogId]));
  const groups = new Map();
  for (const item of items.values()) {
    const groupId = String(item.user_product_id || '').trim();
    if (!groupId) continue;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(item);
  }

  const catalogTargets = [...items.values()].filter((item) => {
    const classification = classifyMlListingUnder70(item);
    return classification.target && !knownIds.has(item.id) && item.catalog_listing === true;
  });
  const catalogValidationEntries = await mapWithConcurrency(
    catalogTargets,
    SOURCE_VALIDATION_CONCURRENCY,
    async (item, index) => {
      const validation = await validateAgainstSource(clients, item, sourceReference(local, item.id), false);
      if ((index + 1) % 50 === 0 || index + 1 === catalogTargets.length) {
        process.stdout.write(`${JSON.stringify({
          event: 'source_validation_progress',
          processed: index + 1,
          total: catalogTargets.length,
        })}\n`);
      }
      return [item.id, validation];
    },
  );
  const catalogValidations = new Map(catalogValidationEntries);

  const rowsById = new Map();
  for (const item of items.values()) {
    const classification = classifyMlListingUnder70(item);
    if (!classification.target || knownIds.has(item.id)) continue;
    const source = sourceReference(local, item.id);
    const group = String(item.user_product_id || '').trim() ? groups.get(String(item.user_product_id)) || [] : [];
    let action = classification.reason === 'already_compliant' ? 'noop' : 'normalize';
    let reason = classification.reason;
    let evidence = {};

    if (classification.blockedByMandatoryFreeShipping) {
      action = 'blocked';
      reason = 'mandatory_free_shipping';
    } else if (group.length && hasActiveMixedPriceGroup(group)) {
      action = 'blocked';
      reason = 'active_user_product_crosses_threshold';
    } else if (item.catalog_listing === true) {
      const validation = catalogValidations.get(item.id);
      if (!validation) throw new Error(`Validação de origem ausente para ${item.id}.`);
      evidence = validation.evidence;
      if (!validation.ok) {
        action = 'blocked';
        reason = validation.reason;
      }
    }

    rowsById.set(item.id, makeManifestRow({
      item,
      source,
      action,
      reason,
      desiredState: action === 'normalize' ? { listing_type_id: 'gold_special', free_shipping: false } : {},
      evidence,
      priority: action === 'normalize' ? 200 : action === 'noop' ? 300 : 400,
    }));
  }

  for (const pair of KNOWN_PAIRS) {
    const standard = items.get(pair.standardId);
    const catalog = items.get(pair.catalogId);
    if (!standard || !catalog) throw new Error(`Par conhecido incompleto: ${pair.sku}.`);
    const source = sourceReference(local, pair.standardId);
    const [sourceValidation, requirement, duplicate] = await Promise.all([
      validateAgainstSource(clients, standard, source, true),
      resolveCatalogRequirement(clients, standard, source),
      verifyDuplicateModeration(clients, pair),
    ]);
    const skuMatches = String(source.product?.sku || '') === pair.sku
      && extractSku(standard) === pair.sku
      && extractSku(catalog) === pair.sku;
    const catalogStatusMatches = pair.catalogState === 'closed'
      ? String(catalog.status) === 'closed'
      : pair.catalogState === 'active'
        ? String(catalog.status) === 'active'
        : String(catalog.status) === 'under_review'
          && (catalog.sub_status || []).map(String).includes('forbidden');
    const safe = sourceValidation.ok
      && requirement.ok
      && requirement.required
      && duplicate.ok
      && skuMatches
      && catalogStatusMatches
      && String(standard.status) === 'active'
      && Number(standard.sold_quantity || 0) === 0
      && Number(catalog.sold_quantity || 0) === 0;
    const evidence = {
      ...sourceValidation.evidence,
      ...duplicate.evidence,
      catalog_required: requirement.ok ? requirement.required : null,
      catalog_product_id: requirement.catalogProductId || null,
      expected_sku: pair.sku,
    };
    rowsById.set(pair.catalogId, makeManifestRow({
      item: catalog,
      source,
      action: safe ? 'delete_permanent' : 'blocked',
      reason: safe ? pair.reason : `known_pair_preflight_failed:${pair.reason}`,
      desiredState: safe ? { deleted: true } : {},
      evidence,
      priority: 10,
    }));
    rowsById.set(pair.standardId, makeManifestRow({
      item: standard,
      source,
      action: safe ? 'delete_permanent' : 'blocked',
      reason: safe ? 'catalog_required_without_surviving_listing' : `known_pair_preflight_failed:${pair.reason}`,
      desiredState: safe ? { deleted: true, leave_sku_unlisted: true } : {},
      evidence,
      priority: 20,
    }));
  }

  for (const survivor of PROTECTED_SURVIVORS) {
    if (survivor.belowThreshold) continue;
    const item = items.get(survivor.itemId);
    if (!item) throw new Error(`Sobrevivente protegido ausente: ${survivor.itemId}.`);
    const source = sourceReference(local, survivor.itemId);
    const validation = await validateAgainstSource(clients, item, source, true);
    rowsById.set(survivor.itemId, makeManifestRow({
      item,
      source,
      action: validation.ok && extractSku(item) === survivor.sku ? 'noop' : 'blocked',
      reason: validation.ok ? 'protected_survivor_above_threshold' : validation.reason,
      desiredState: { preserve: true },
      evidence: validation.evidence,
      priority: 300,
    }));
  }

  const rows = [...rowsById.values()]
    .sort((a, b) => a.ordinal - b.ordinal || a.ml_item_id.localeCompare(b.ml_item_id));
  rows.forEach((row, index) => { row.ordinal = index; });

  const activeCounts = new Map();
  for (const item of items.values()) {
    if (String(item.status) !== 'active') continue;
    const groupId = String(item.user_product_id || '').trim();
    if (groupId) activeCounts.set(groupId, (activeCounts.get(groupId) || 0) + 1);
  }
  const canary = rows.find((row) => row.action === 'normalize'
    && row.before_state.catalog_listing === false
    && Number(row.before_state.sold_quantity || 0) === 0
    && (!row.before_state.user_product_id || activeCounts.get(row.before_state.user_product_id) === 1));
  if (!canary) throw new Error('Nenhum canário isolado e sem vendas foi encontrado.');
  canary.is_canary = true;

  const summary = {
    seller_id: Number(me.data.id),
    scanned: items.size,
    scan_pages: scan.pages,
    active_under_70: [...items.values()].filter((item) => classifyMlListingUnder70(item).target).length,
    manifest_rows: rows.length,
    normalize: rows.filter((row) => row.action === 'normalize').length,
    delete_permanent: rows.filter((row) => row.action === 'delete_permanent').length,
    noop: rows.filter((row) => row.action === 'noop').length,
    blocked: rows.filter((row) => row.action === 'blocked').length,
    listing_type_changes: rows.filter((row) => row.action === 'normalize' && row.before_state.listing_type_id !== 'gold_special').length,
    buyer_shipping_changes: rows.filter((row) => row.action === 'normalize' && row.before_state.free_shipping !== false).length,
    canary: canary.ml_item_id,
    blocked_reasons: Object.fromEntries(
      [...Map.groupBy(rows.filter((row) => row.action === 'blocked'), (row) => row.reason).entries()]
        .map(([reason, entries]) => [reason, entries.length])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    known_pairs: KNOWN_PAIRS.map((pair) => {
      const standard = rowsById.get(pair.standardId);
      const catalog = rowsById.get(pair.catalogId);
      return {
        sku: pair.sku,
        standard: { id: pair.standardId, action: standard?.action, reason: standard?.reason },
        catalog: { id: pair.catalogId, action: catalog?.action, reason: catalog?.reason },
        evidence: standard?.source_evidence || {},
      };
    }),
    blocked_samples: rows.filter((row) => row.action === 'blocked').slice(0, 25).map((row) => ({
      item_id: row.ml_item_id,
      sku: row.sku,
      reason: row.reason,
      evidence: row.source_evidence,
      before_state: row.before_state,
      same_sku_items: [...items.values()]
        .filter((item) => extractSku(item) === row.sku)
        .map((item) => ({
          id: item.id,
          status: item.status,
          sub_status: item.sub_status,
          catalog_listing: item.catalog_listing === true,
          catalog_product_id: item.catalog_product_id || null,
          price: item.price,
          sold_quantity: item.sold_quantity,
        })),
    })),
  };
  return { rows, summary, hash: manifestHash(rows), items };
}

async function persistManifest(db, manifest) {
  const existing = await db.from('jobs').select('id,status').eq('tipo', JOB_TYPE).eq('dedupe_key', OPERATION_KEY).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) throw new Error(`Operação única já preparada no job ${existing.data.id}.`);
  const jobId = crypto.randomUUID();
  const log = [event('manifest_prepared', { manifest_hash: manifest.hash, summary: manifest.summary })];
  const { error: jobError } = await db.from('jobs').insert({
    id: jobId,
    tipo: JOB_TYPE,
    status: 'pendente',
    progresso: 0,
    total: manifest.rows.length,
    processados: 0,
    unidade_progresso: 'itens',
    log,
    dedupe_key: OPERATION_KEY,
  });
  if (jobError) throw new Error(`Falha ao criar job: ${jobError.message}`);
  try {
    for (const batch of chunks(manifest.rows, DB_BATCH_SIZE)) {
      const { error } = await db.from(TABLE).insert(batch.map((row) => ({ ...row, job_id: jobId })));
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    await db.from('jobs').delete().eq('id', jobId);
    throw new Error(`Falha ao salvar manifesto: ${error.message}`);
  }
  return { jobId, hash: manifest.hash };
}

async function loadAllManifestRows(db, jobId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(TABLE).select('*').eq('job_id', jobId)
      .order('ordinal', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function getPreparedHash(log) {
  const entries = Array.isArray(log) ? log : [];
  return String(entries.find((entry) => entry?.event === 'manifest_prepared')?.manifest_hash || '');
}

async function loadJobAndManifest(db, jobId, confirmation) {
  if (!jobId || !confirmation) throw new Error('--job-id e --confirm são obrigatórios.');
  const { data: job, error } = await db.from('jobs').select('*').eq('id', jobId).eq('tipo', JOB_TYPE).maybeSingle();
  if (error || !job) throw new Error(`Job não encontrado: ${error?.message || jobId}`);
  const rows = await loadAllManifestRows(db, jobId);
  const preparedHash = getPreparedHash(job.log);
  const currentHash = manifestHash(rows);
  if (!preparedHash || preparedHash !== currentHash || confirmation !== preparedHash) {
    throw new Error('Hash de confirmação não corresponde ao manifesto persistido.');
  }
  return { job, rows, hash: preparedHash, log: Array.isArray(job.log) ? job.log : [] };
}

async function updateRow(db, jobId, itemId, patch) {
  const { error } = await db.from(TABLE).update({ ...patch, updated_at: nowIso() })
    .eq('job_id', jobId).eq('ml_item_id', itemId);
  if (error) throw new Error(`Falha ao atualizar auditoria de ${itemId}: ${error.message}`);
}

async function updateJobProgress(db, jobId, log, total) {
  const { count, error } = await db.from(TABLE).select('*', { count: 'exact', head: true })
    .eq('job_id', jobId).in('status', ['confirmed', 'skipped']);
  if (error) throw new Error(error.message);
  const processed = Number(count || 0);
  const { error: updateError } = await db.from('jobs').update({
    processados: processed,
    progresso: total ? Math.min(99, Math.floor((processed / total) * 100)) : 99,
    log,
  }).eq('id', jobId);
  if (updateError) throw new Error(updateError.message);
}

async function reconcileObserved(db, item) {
  const localStatus = String(item.status || '') === 'active' ? 'ativo' : 'pausado';
  const listingPatch = {
    preco_ml: Number(item.price || 0),
    status: localStatus,
    tipo: String(item.listing_type_id || 'gold_pro'),
    titulo: String(item.title || ''),
    catalogo: item.catalog_listing === true,
    updated_at: nowIso(),
  };
  const listing = await db.from('anuncios_ml').update(listingPatch).eq('ml_item_id', String(item.id));
  if (listing.error) throw new Error(listing.error.message);
  const snapshot = await db.from('catalogo_ml_snapshot').update({
    status: item.status || null,
    price: Number(item.price || 0),
    catalog_listing: item.catalog_listing === true,
    catalog_product_id: item.catalog_product_id || null,
    last_updated_ml: item.last_updated || null,
    synced_at: nowIso(),
  }).eq('ml_item_id', String(item.id));
  if (snapshot.error) throw new Error(snapshot.error.message);
}

async function processManifestRow(db, clients, jobId, row) {
  if (['confirmed', 'skipped'].includes(row.status)) return;
  if (row.action === 'blocked') throw new Error(`${row.ml_item_id} bloqueado: ${row.reason}`);
  if (row.action === 'noop') {
    await updateRow(db, jobId, row.ml_item_id, { status: 'skipped', readback: row.before_state, applied_at: nowIso() });
    return;
  }

  await updateRow(db, jobId, row.ml_item_id, {
    status: 'applying', attempts: Number(row.attempts || 0) + 1, last_error: null,
  });
  try {
    if (row.action === 'delete_permanent') {
      const current = await clients.ml(`/items/${encodeURIComponent(row.ml_item_id)}`);
      if (!current.ok || !current.data) throw new Error(current.error?.message || 'Falha na leitura anterior à exclusão.');
      const currentSku = extractSku(current.data);
      if (row.sku && currentSku && row.sku !== currentSku) throw new Error(`SKU mudou de ${row.sku} para ${currentSku}.`);
      if (Number(current.data.sold_quantity || 0) > 0) throw new Error('Anúncio passou a possuir vendas; exclusão interrompida.');
      const deleted = await deleteMlListingPermanentlyWith(clients.ml.bind(clients), row.ml_item_id);
      if (!deleted.ok) throw new Error(`${deleted.code}: ${deleted.error}`);
      await detachDeletedMlListing(db, row.ml_item_id);
      await updateRow(db, jobId, row.ml_item_id, {
        status: 'confirmed', readback: batchManifestState(deleted.item), applied_at: nowIso(),
      });
      return;
    }

    const result = await normalizeMlListingTermsWith(clients.ml.bind(clients), row.ml_item_id);
    if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
    if (result.item) await reconcileObserved(db, result.item);
    await updateRow(db, jobId, row.ml_item_id, {
      status: result.skipped ? 'skipped' : 'confirmed',
      readback: batchManifestState(result.item),
      applied_at: nowIso(),
    });
  } catch (error) {
    await updateRow(db, jobId, row.ml_item_id, { status: 'error', last_error: String(error.message || error) });
    throw error;
  }
}

async function appendJobEvent(db, jobId, log, entry, patch = {}) {
  const next = [...log, entry];
  const { error } = await db.from('jobs').update({ log: next, ...patch }).eq('id', jobId);
  if (error) throw new Error(error.message);
  return next;
}

async function runCanary(db, clients, loaded) {
  if (!['pendente', 'on_hold'].includes(loaded.job.status)) throw new Error(`Estado do job não permite canário: ${loaded.job.status}.`);
  if (loaded.rows.some((row) => row.action === 'blocked')) throw new Error('Manifesto possui linhas bloqueadas; nenhuma escrita foi iniciada.');
  const canary = loaded.rows.find((row) => row.is_canary);
  if (!canary) throw new Error('Canário não encontrado no manifesto.');
  if (!['confirmed', 'skipped'].includes(canary.status)) await processManifestRow(db, clients, loaded.job.id, canary);
  const log = await appendJobEvent(db, loaded.job.id, loaded.log, event('canary_confirmed', { ml_item_id: canary.ml_item_id }), {
    status: 'on_hold', finished_at: null,
  });
  await updateJobProgress(db, loaded.job.id, log, loaded.rows.length);
  return { canary: canary.ml_item_id };
}

async function verifyJob(db, clients, loaded) {
  const me = await clients.ml('/users/me');
  if (!me.ok || !me.data?.id) throw new Error('Conta ML indisponível na verificação.');
  const scan = await fetchAllMlItemIds(clients, me.data.id);
  const items = await fetchItems(clients, scan.itemIds);
  const violations = [];
  for (const item of items.values()) {
    const classification = classifyMlListingUnder70(item);
    if (classification.target && classification.reason !== 'already_compliant') {
      violations.push({ item_id: item.id, reason: classification.reason });
    }
  }
  for (const pair of KNOWN_PAIRS) {
    for (const itemId of [pair.catalogId, pair.standardId]) {
      const item = items.get(itemId);
      if (item && !isMlListingDeletedForBatch(item)) violations.push({ item_id: itemId, reason: 'deletion_not_confirmed' });
    }
    const activeSameSku = [...items.values()].filter((item) => String(item.status) === 'active' && extractSku(item) === pair.sku);
    if (activeSameSku.length) violations.push({ item_id: activeSameSku.map((item) => item.id).join(','), reason: `sku_still_active:${pair.sku}` });
  }
  const protectedRows = loaded.rows.filter((row) => row.desired_state?.preserve === true);
  for (const row of protectedRows) {
    const item = items.get(row.ml_item_id);
    if (!item || String(item.status) !== 'active'
      || Number(item.price) !== Number(row.before_state.price)
      || Number(item.available_quantity) !== Number(row.before_state.available_quantity)
      || String(item.title || '') !== String(row.before_state.title || '')) {
      violations.push({ item_id: row.ml_item_id, reason: 'protected_survivor_changed' });
    }
  }
  return { ok: violations.length === 0, violations, scanned: items.size, active_under_70: [...items.values()].filter((item) => classifyMlListingUnder70(item).target).length };
}

async function runApply(db, clients, loaded) {
  if (loaded.rows.some((row) => row.action === 'blocked')) throw new Error('Manifesto possui linhas bloqueadas; nenhuma escrita adicional foi iniciada.');
  const canaryConfirmed = loaded.log.some((entry) => entry?.event === 'canary_confirmed')
    || loaded.rows.some((row) => row.is_canary && ['confirmed', 'skipped'].includes(row.status));
  if (!canaryConfirmed) throw new Error('Execute e confirme o canário antes do lote completo.');
  let log = await appendJobEvent(db, loaded.job.id, loaded.log, event('batch_started'), { status: 'rodando', finished_at: null });
  try {
    for (const [index, row] of loaded.rows.entries()) {
      await processManifestRow(db, clients, loaded.job.id, row);
      if ((index + 1) % 25 === 0 || index + 1 === loaded.rows.length) {
        await updateJobProgress(db, loaded.job.id, log, loaded.rows.length);
        process.stdout.write(`${JSON.stringify({
          event: 'batch_progress',
          job_id: loaded.job.id,
          visited: index + 1,
          total: loaded.rows.length,
        })}\n`);
      }
    }
    const refreshed = await loadJobAndManifest(db, loaded.job.id, loaded.hash);
    const verification = await verifyJob(db, clients, refreshed);
    if (!verification.ok) throw new Error(`Verificação final encontrou ${verification.violations.length} divergência(s).`);
    log = await appendJobEvent(db, loaded.job.id, log, event('batch_verified', verification), {
      status: 'completo', progresso: 100, processados: loaded.rows.length, finished_at: nowIso(),
    });
    return { verification, log_entries: log.length };
  } catch (error) {
    await appendJobEvent(db, loaded.job.id, log, event('batch_on_hold', { error: String(error.message || error) }), {
      status: 'on_hold', finished_at: null,
    });
    throw error;
  }
}

async function main() {
  const mode = selectedMode();
  if (!['inspect', 'prepare', 'canary', 'apply', 'verify'].includes(mode)) throw new Error(`Modo inválido: ${mode}.`);
  const config = await assertProductionDatabaseTarget();
  const db = makeDb(config);
  const clients = new ExternalClients(db, mode !== 'inspect');
  await clients.validMlToken();
  process.stdout.write(`${JSON.stringify({ event: 'preflight_ok', mode, database_host: SUPABASE_PRODUCTION_IP, ml_user_id: clients.mlAccount?.userId || null })}\n`);

  if (mode === 'inspect' || mode === 'prepare') {
    const manifest = await buildManifest(db, clients);
    process.stdout.write(`${JSON.stringify({ event: 'manifest_ready', hash: manifest.hash, summary: manifest.summary })}\n`);
    if (mode === 'prepare') {
      const saved = await persistManifest(db, manifest);
      process.stdout.write(`${JSON.stringify({ event: 'manifest_persisted', job_id: saved.jobId, confirmation_hash: saved.hash })}\n`);
    }
    return;
  }

  const jobId = String(argValue('--job-id') || '').trim();
  const confirmation = String(argValue('--confirm') || '').trim();
  const loaded = await loadJobAndManifest(db, jobId, confirmation);
  if (mode === 'canary') {
    const result = await runCanary(db, clients, loaded);
    process.stdout.write(`${JSON.stringify({ event: 'canary_complete', job_id: jobId, ...result })}\n`);
    return;
  }
  if (mode === 'verify') {
    const result = await verifyJob(db, clients, loaded);
    process.stdout.write(`${JSON.stringify({ event: 'verification_complete', job_id: jobId, ...result })}\n`);
    if (!result.ok) process.exitCode = 2;
    return;
  }
  const result = await runApply(db, clients, loaded);
  process.stdout.write(`${JSON.stringify({ event: 'batch_complete', job_id: jobId, ...result })}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'ml_under70_batch_failed', error: String(error?.message || error) }));
    process.exitCode = 1;
  });
}

module.exports = {
  KNOWN_PAIRS,
  OPERATION_KEY,
  PROTECTED_SURVIVORS,
  brandsEquivalent,
  buildBulkPath,
  gtinKey,
  manifestHash,
  selectedMode,
  validateAgainstSource,
};
