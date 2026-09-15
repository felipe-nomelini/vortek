#!/usr/bin/env node

const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { buildMlItemsBulkPath, getMlItemsBulkBody } = require('../src/lib/ml/items-bulk.ts');

const INPUTS = {
  order: ['ORDEM_ORACULO_P0_AUDITORIA_179_E_CORRECAO_2026-09-15.md', '16157ece3c9d5d4d88adfe9cf370cb6ea8989f3898ceefe88175ffdc3d52bf97'],
  audit: ['P0_AUDITORIA_EXECUTIVA_179_CASOS_2026-09-15.csv', '2625441261e9ad9c52f78c237d35a20aeb2c518fa602ba6e6d16f2f57c63c6fb'],
  release: ['P0_RELEASE_IDENTIDADE_155.json', '5a23527d7738a5231898c7c3ed777670d0f82fc9f85ec1043264c91df920251c'],
  pending: ['P0_PENDENCIAS_RESIDUAIS_2.json', '065e24ab43d337471bb3c2a26e24702f079d4c38655642604a9fe8d21059265c'],
  batch01: ['P0_CORRECAO_VINCULOS_BATCH_01.json', 'e91023f9abad0df4258f7c1d74b22ac1ca8c83444803399ac950bc800522656d'],
  batch02: ['P0_CORRECAO_VINCULOS_BATCH_02.json', 'bbe395847d265713b470fcf95f3490267fdb1139356700f43e533825f2757ec3'],
};
const PRIOR_MANIFEST_HASH = '321ee56989aba0814a7daf6f367829ebe0b64b97dd75e21123fb2e4f08e150ff';
const PRIOR_AUDIT_SHA = 'eda059e01de3a465cbbc91bd0716cb2bf3ffd825454788fd21d643cc81d920ad';
const SOURCE_SHA = '59cdbbc17ae5d991a036b5fd4e0d584fa791f6747cab871b57424c220bc76d38';
const SELLER_ID = 3294514937;
const RELEASE_SOURCE = 'P0_AUDITORIA_EXECUTIVA_179';
const MANIFEST_TTL_MS = 15 * 60 * 1000;
const MATERIAL_ATTRIBUTES = new Set([
  'BRAND','GTIN','MODEL','MPN','PART_NUMBER','SALE_FORMAT','UNITS_PER_PACK','PACKS_NUMBER',
  'PACKAGES_NUMBER','PACKAGING_BOXES_NUMBER','CAPACITY','STORAGE_CAPACITY','NOMINAL_VOLTAGE',
  'VOLTAGE','LENGTH','WIDTH','HEIGHT','COLOR','MAIN_COLOR','CELL_BATTERY_SIZE','CELL_BATTERY_COMPOSITION',
]);
const ARTIFACTS = [
  '11_identity_reaudit_179.csv','12_identity_release_155.json','13_residual_pending_2.json',
  '14_relink_batch_01_before_after.json','15_relink_batch_02_before_after.json',
  '16_relink_failures.json','17_pricing_eligibility_after_identity.csv','18_p0_final_closeout.md',
];

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
}
function stableJson(value, spacing = 0) { return JSON.stringify(stable(value), null, spacing); }
function manifestHash(manifest) {
  return sha256(stableJson({
    version: manifest.version, run_id: manifest.run_id, generated_at: manifest.generated_at,
    expires_at: manifest.expires_at, source_sha256: manifest.source_sha256,
    prior_manifest_hash: manifest.prior_manifest_hash, seller_id: manifest.seller_id,
    database_target: manifest.database_target || null,
    decisions: manifest.decisions.map(row => ({
      sku: row.sku, ml_item_id: row.ml_item_id, catalog_product_id: row.catalog_product_id,
      standard_item_id: row.standard_item_id, identity_state: row.identity_state,
      reason_code: row.reason_code, action: row.action, action_result: row.action_result,
      command_id: row.command_id, material_fingerprint: row.material_fingerprint,
      material_changed: row.material_changed, ml_live_source_available: row.ml_live_source_available,
      pricing_eligible_by_identity: row.pricing_eligible_by_identity,
      current_price: row.current_price, available_quantity: row.available_quantity,
      local_listing_price: row.local_listing_price,
      old_relation: row.old_relation, eligibility: row.eligibility, error: row.error,
      batch_source: row._batch_source || null,
    })),
  }));
}
function clean(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' '); }
function chunks(values, size) { return Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size)); }

function parseCsv(source) {
  source = source.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); cell = ''; if (row.some(Boolean)) rows.push(row); row = [];
    } else cell += c;
  }
  if (quoted) throw new Error('csv_unclosed_quote');
  if (cell || row.length) { row.push(cell); if (row.some(Boolean)) rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function normalizeExecutiveRow(row) {
  return {
    sku: clean(row.sku), ml_item_id: clean(row.ml_item_id), catalog_product_id: clean(row.catalog_product_id),
    standard_item_id: clean(row.standard_item_id) || null, previous_state: clean(row.previous_state),
    audited_state: clean(row.audited_state), reason_code: clean(row.reason_code), risk_tier: clean(row.risk_tier),
    local_name: clean(row.local_name), remote_title: clean(row.remote_title), execution_action: clean(row.execution_action),
    pricing_eligible: row.pricing_eligible === true || String(row.pricing_eligible).toLowerCase() === 'true', notes: clean(row.notes),
  };
}

function loadInputs(inputDir, priorDir) {
  const loaded = {};
  for (const [key, [name, expected]] of Object.entries(INPUTS)) {
    const bytes = fs.readFileSync(path.join(inputDir, name));
    const actual = sha256(bytes); if (actual !== expected) throw new Error(`input_sha_mismatch:${name}:${actual}`);
    loaded[key] = key === 'order' ? bytes.toString('utf8') : key === 'audit'
      ? parseCsv(bytes.toString('utf8')).map(normalizeExecutiveRow)
      : JSON.parse(bytes.toString('utf8')).map(normalizeExecutiveRow);
  }
  const priorAuditPath = path.join(priorDir, '01_catalog_identity_audit.csv');
  const priorManifestPath = path.join(priorDir, '10_rollback_manifest.json');
  if (sha256(fs.readFileSync(priorAuditPath)) !== PRIOR_AUDIT_SHA) throw new Error('prior_audit_sha_mismatch');
  const priorManifest = JSON.parse(fs.readFileSync(priorManifestPath, 'utf8'));
  if (priorManifest.manifest_hash !== PRIOR_MANIFEST_HASH || priorManifest.source?.sha256 !== SOURCE_SHA) throw new Error('prior_manifest_mismatch');
  const priorRows = parseCsv(fs.readFileSync(priorAuditPath, 'utf8'));
  validateInputs(loaded, priorRows);
  return { ...loaded, priorRows };
}

function validateInputs(input, priorRows) {
  const count = (rows, field) => Object.fromEntries([...Map.groupBy(rows, row => row[field]).entries()].map(([key, values]) => [key, values.length]));
  if (input.audit.length !== 179 || new Set(input.audit.map(row => row.ml_item_id)).size !== 179 || new Set(input.audit.map(row => row.sku)).size !== 179) throw new Error('executive_universe_invalid');
  if (stableJson(count(input.audit, 'audited_state')) !== stableJson({ CONFLITO_CONFIRMADO: 22, PENDENCIA_VALIDACAO: 2, SEM_CONFLITO: 155 })) throw new Error('executive_states_invalid');
  if (stableJson(count(input.audit, 'previous_state')) !== stableJson({ CONFLITO_CONFIRMADO: 21, PENDENCIA_VALIDACAO: 158 })) throw new Error('executive_previous_states_invalid');
  const groups = [input.release, input.batch01, input.batch02, input.pending];
  if (stableJson(groups.map(group => group.length)) !== stableJson([155, 15, 7, 2])) throw new Error('executive_groups_invalid');
  const union = groups.flat();
  if (new Set(union.map(row => row.ml_item_id)).size !== 179) throw new Error('executive_groups_overlap');
  const auditById = new Map(input.audit.map(row => [row.ml_item_id, row]));
  if (union.some(row => stableJson(row) !== stableJson(auditById.get(row.ml_item_id)))) throw new Error('executive_groups_do_not_match_csv');
  const priorById = new Map(priorRows.map(row => [row.ml_item_id, row]));
  if (input.audit.some(row => priorById.get(row.ml_item_id)?.identity_state_after !== row.previous_state)) throw new Error('executive_prior_state_mismatch');
  const promoted = input.audit.find(row => row.sku === 'VTK017209');
  if (promoted?.audited_state !== 'CONFLITO_CONFIRMADO' || promoted.reason_code !== 'BRAND_IDENTITY_DIVERGENTE') throw new Error('executive_promoted_conflict_missing');
  const pending = input.pending.map(row => row.sku).sort();
  if (stableJson(pending) !== stableJson(['VTK018051','VTK019387'])) throw new Error('executive_pending_invalid');
}

function attributeMap(source) {
  const rows = Array.isArray(source?.attributes) ? source.attributes : [];
  return Object.fromEntries(rows.filter(row => MATERIAL_ATTRIBUTES.has(String(row?.id || '').toUpperCase())).map(row => {
    const values = Array.isArray(row.values) ? row.values.map(value => clean(value?.name || value?.id)).filter(Boolean).sort() : [];
    return [String(row.id).toUpperCase(), [...new Set([clean(row.value_name || row.value_id), ...values].filter(Boolean))].sort()];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

function materialSnapshot(item, product, local = {}) {
  return {
    item_id: clean(item?.id), seller_id: Number(item?.seller_id || 0), title: clean(item?.title || item?.name),
    catalog_listing: item?.catalog_listing === true, catalog_product_id: clean(item?.catalog_product_id),
    category_id: clean(item?.category_id), domain_id: clean(item?.domain_id),
    seller_custom_field: clean(item?.seller_custom_field),
    relations: (Array.isArray(item?.item_relations) ? item.item_relations.map(row => clean(row?.id)).filter(Boolean) : []).sort(),
    item_attributes: attributeMap(item), product_id: clean(product?.id), product_status: clean(product?.status),
    product_name: clean(product?.name || product?.title), product_attributes: attributeMap(product),
    local_product: {
      id: clean(local.product?.id), sku: clean(local.product?.sku), name: clean(local.product?.nome),
      brand: clean(local.product?.marca), gtin: clean(local.product?.gtin),
    },
    local_listing: {
      ml_item_id: clean(local.listing?.ml_item_id), produto_id: clean(local.listing?.produto_id),
      sku: clean(local.listing?.sku), title: clean(local.listing?.titulo), catalog_listing: local.listing?.catalogo === true,
    },
    catalog_snapshot: {
      ml_item_id: clean(local.snapshot?.ml_item_id), seller_id: Number(local.snapshot?.seller_id || 0),
      produto_id: clean(local.snapshot?.produto_id), sku_local: clean(local.snapshot?.sku_local),
      seller_sku: clean(local.snapshot?.seller_sku), related_item_id: clean(local.snapshot?.related_item_id),
      catalog_product_id: clean(local.snapshot?.catalog_product_id), title: clean(local.snapshot?.title),
    },
  };
}

function jsonObject(value) {
  if (!value) return {};
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

async function assertProductionTarget(serviceUrl) {
  const parsed = new URL(serviceUrl);
  if (parsed.hostname === '192.168.1.160') throw new Error('legacy_target_forbidden');
  if (parsed.hostname === '192.168.1.162') return { configured_host: parsed.hostname, resolved_addresses: [parsed.hostname] };
  if (parsed.hostname !== 'supabase.bentevi.shop') throw new Error(`production_target_invalid:${parsed.hostname}`);
  const resolved = await dns.lookup(parsed.hostname, { all: true });
  const addresses = [...new Set(resolved.map(row => row.address))];
  if (!addresses.includes('192.168.1.162')) throw new Error(`production_target_resolution_invalid:${addresses.join(',')}`);
  return { configured_host: parsed.hostname, resolved_addresses: addresses };
}

async function loadToken(client) {
  const select = 'access_token,refresh_token,client_id,client_secret,token_expires_at,conectado';
  const read = async () => {
    const result = await client.from('integracoes').select(select).eq('tipo', 'mercadolivre').maybeSingle();
    if (result.error || !result.data?.conectado) throw new Error('ml_token_unavailable');
    return result.data;
  };
  const validateOwner = async token => {
    const response = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || Number(payload?.id) !== SELLER_ID) throw new Error('ml_token_owner_invalid');
  };
  const usable = integration => integration.access_token
    && Date.parse(integration.token_expires_at || '') - Date.now() >= 45 * 60 * 1000;
  let integration = await read();
  if (usable(integration)) {
    await validateOwner(integration.access_token);
    return integration.access_token;
  }
  if (!integration.refresh_token || !integration.client_id || !integration.client_secret) throw new Error('ml_refresh_credentials_unavailable');
  const owner = `catalog-identity-p0:${crypto.randomUUID()}`;
  const acquired = await client.rpc('acquire_integracao_refresh_lock', {
    p_tipo: 'mercadolivre', p_owner: owner, p_ttl_seconds: 25,
  });
  if (acquired.error || !acquired.data) throw new Error('ml_refresh_lock_unavailable');
  try {
    integration = await read();
    if (usable(integration)) {
      await validateOwner(integration.access_token);
      return integration.access_token;
    }
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: integration.client_id,
        client_secret: integration.client_secret, refresh_token: integration.refresh_token }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token || !payload?.refresh_token) throw new Error(`ml_token_refresh_failed:${response.status}`);
    await validateOwner(payload.access_token);
    const updated = await client.from('integracoes').update({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_expires_at: new Date(Date.now() + Number(payload.expires_in || 10800) * 1000).toISOString(),
      conectado: true,
      last_refresh_at: new Date().toISOString(),
      last_refresh_error: null,
      last_refresh_error_code: null,
    }).eq('tipo', 'mercadolivre');
    if (updated.error) throw new Error(`ml_token_persist_failed:${updated.error.code}`);
    return payload.access_token;
  } finally {
    await client.rpc('release_integracao_refresh_lock', { p_tipo: 'mercadolivre', p_owner: owner });
  }
}

function readonlyMl(token) {
  let gets = 0;
  const get = async endpoint => {
    gets += 1;
    const response = await fetch(`https://api.mercadolibre.com${endpoint}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data: body };
  };
  return { get, stats: () => ({ get: gets, head: 0, mutation_attempts: 0 }) };
}

async function fetchByValues(client, table, select, column, values) {
  const output = [];
  for (const batch of chunks([...new Set(values.filter(Boolean))], 100)) {
    const result = await client.from(table).select(select).in(column, batch);
    if (result.error) throw new Error(`${table}_read_failed:${result.error.code}`);
    output.push(...(result.data || []));
  }
  return output;
}

async function liveEvidence(input, client, ml) {
  const ids = input.audit.map(row => row.ml_item_id);
  const expectedCount = ids.length;
  const [listings, snapshots] = await Promise.all([
    fetchByValues(client, 'anuncios_ml', 'ml_item_id,produto_id,sku,titulo,preco_ml,status,catalogo,updated_at', 'ml_item_id', ids),
    fetchByValues(client, 'catalogo_ml_snapshot', 'ml_item_id,seller_id,produto_id,sku_local,seller_sku,related_item_id,catalog_product_id,status,price,price_to_win,title,synced_at', 'ml_item_id', ids),
  ]);
  if (listings.length !== expectedCount || snapshots.length !== expectedCount) throw new Error(`database_coverage_invalid:${listings.length}:${snapshots.length}:${expectedCount}`);
  const listingById = new Map(listings.map(row => [row.ml_item_id, row]));
  const snapshotById = new Map(snapshots.map(row => [row.ml_item_id, row]));
  const productIds = [...new Set(listings.map(row => row.produto_id).filter(Boolean))];
  const products = await fetchByValues(client, 'produtos', 'id,sku,nome,marca,gtin,ativo,estoque,custom_price,oferta_preferencial_id,updated_at', 'id', productIds);
  const productById = new Map(products.map(row => [row.id, row]));
  const itemById = new Map();
  for (const batch of chunks(ids, 20)) {
    const result = await ml.get(buildMlItemsBulkPath(batch, [
      'seller_id','title','status','price','available_quantity','catalog_listing','catalog_product_id',
      'category_id','domain_id','seller_custom_field','item_relations','attributes','last_updated',
    ]));
    if (!result.ok || !Array.isArray(result.data)) throw new Error(`ml_items_read_failed:${result.status}`);
    for (const entry of result.data) {
      const item = getMlItemsBulkBody(entry);
      if (item) itemById.set(item.id, item);
    }
  }
  if (itemById.size !== expectedCount) throw new Error(`ml_item_coverage_invalid:${itemById.size}:${expectedCount}`);
  const productByCatalog = new Map();
  for (const catalogId of [...new Set(input.audit.map(row => row.catalog_product_id))]) {
    const result = await ml.get(`/products/${encodeURIComponent(catalogId)}`);
    if (!result.ok || result.data?.id !== catalogId) throw new Error(`ml_catalog_product_read_failed:${catalogId}:${result.status}`);
    productByCatalog.set(catalogId, result.data);
  }
  const eligibility = new Map();
  for (const row of [...(input.batch01 || []), ...(input.batch02 || [])]) {
    const relation = itemById.get(row.ml_item_id)?.item_relations?.[0]?.id || null;
    if (!relation) continue;
    const result = await ml.get(`/items/${encodeURIComponent(relation)}/catalog_listing_eligibility`);
    eligibility.set(row.ml_item_id, { ok: result.ok, http_status: result.status, status: result.data?.status || null,
      reason: result.data?.reason || null, standard_item_id: relation });
  }
  return { listingById, snapshotById, productById, itemById, productByCatalog, eligibility };
}

function createDecision(row, prior, live, commandId) {
  const item = live.itemById.get(row.ml_item_id);
  const catalogProduct = live.productByCatalog.get(row.catalog_product_id);
  const listing = live.listingById.get(row.ml_item_id);
  const snapshot = live.snapshotById.get(row.ml_item_id);
  const localProduct = live.productById.get(listing?.produto_id);
  const previousEvidence = jsonObject(prior.evidence);
  const beforeMaterial = materialSnapshot(previousEvidence.ml_item, previousEvidence.ml_catalog_product, {
    product: jsonObject(prior.local_product), listing: jsonObject(prior.local_listing),
    snapshot: jsonObject(prior.catalog_snapshot),
  });
  const afterMaterial = materialSnapshot(item, catalogProduct, { product: localProduct, listing, snapshot });
  const materialFingerprint = sha256(stableJson(afterMaterial));
  const materialChanged = stableJson(beforeMaterial) !== stableJson(afterMaterial);
  const catalogChanged = item.catalog_product_id !== row.catalog_product_id || snapshot.catalog_product_id !== row.catalog_product_id;
  const sellerValid = Number(item.seller_id) === SELLER_ID && Number(snapshot.seller_id) === SELLER_ID;
  const relation = item.item_relations?.[0]?.id || null;
  let finalState = row.audited_state;
  let reasonCode = row.reason_code;
  let actionResult = row.execution_action === 'RELINK_TRANSACTION_REQUIRED' ? 'BLOCKED_NO_SAFE_RELINK'
    : row.execution_action === 'HOLD_MANUAL_EVIDENCE' ? 'REQUIRES_CONFIRMATION' : 'RELEASED_AFTER_READBACK';
  let error = null;
  if (!sellerValid || catalogChanged) throw new Error(`release_systemic_drift:${row.ml_item_id}`);
  if (row.audited_state === 'SEM_CONFLITO' && materialChanged) {
    finalState = 'PENDENCIA_VALIDACAO'; reasonCode = 'READBACK_MATERIAL_DRIFT'; actionResult = 'ABORTED_MATERIAL_DRIFT';
    error = 'Evidência material mudou desde o dry-run; release individual abortado.';
  }
  const eligibility = live.eligibility.get(row.ml_item_id) || null;
  const safeRelink = row.audited_state === 'CONFLITO_CONFIRMADO' && relation && eligibility?.status === 'READY_FOR_OPTIN';
  if (safeRelink) throw new Error(`safe_relink_path_requires_candidate_manifest:${row.ml_item_id}`);
  const liveAvailable = Boolean(item && catalogProduct && catalogProduct.status === 'active');
  if (!liveAvailable) { finalState = 'INCONCLUSIVO'; reasonCode = 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL'; actionResult = 'SOURCE_UNAVAILABLE'; }
  const oldRelation = { ml_item_id: row.ml_item_id, produto_id: listing.produto_id, sku: listing.sku,
    standard_item_id: relation, catalog_product_id: item.catalog_product_id };
  return {
    ...row, command_id: commandId, produto_id: listing.produto_id, seller_id: SELLER_ID,
    identity_state: finalState, reason_code: reasonCode, action_result: actionResult,
    conflict_type: row.audited_state === 'CONFLITO_CONFIRMADO' ? row.reason_code : null,
    material_fingerprint: materialFingerprint, material_changed: materialChanged,
    ml_live_source_available: liveAvailable, pricing_eligible_by_identity: finalState === 'SEM_CONFLITO' && liveAvailable,
    observed_at: new Date().toISOString(), current_price: Number(item.price), available_quantity: Number(item.available_quantity),
    local_listing_price: Number(listing.preco_ml),
    produtos_ativo: localProduct?.ativo ?? null, produtos_estoque: localProduct?.estoque ?? null,
    produtos_custom_price: localProduct?.custom_price ?? null, old_relation: oldRelation, new_relation: oldRelation,
    action: row.execution_action, error, eligibility,
    evidence: { source: 'ml_live', identity_release_source: RELEASE_SOURCE, executive_sha256: INPUTS.audit[1],
      prior_manifest_hash: PRIOR_MANIFEST_HASH, before_material_fingerprint: sha256(stableJson(beforeMaterial)),
      material_fingerprint: materialFingerprint, item_last_updated: item.last_updated || null,
      snapshot_synced_at: snapshot.synced_at, eligibility },
    comparisons: prior.comparisons ? JSON.parse(prior.comparisons) : [],
    ml_readback: { item_id: item.id, seller_id: item.seller_id, status: item.status, price: item.price,
      available_quantity: item.available_quantity, catalog_product_id: item.catalog_product_id,
      related_item_id: relation, observed_at: new Date().toISOString() },
    rollback_plan: { strategy: 'append_blocking_audit_and_restore_current_projection', destructive_delete: false },
  };
}

async function buildPlan(input, client, ml, existingManifest = null) {
  const live = await liveEvidence(input, client, ml);
  const priorById = new Map(input.priorRows.map(row => [row.ml_item_id, row]));
  const commandIds = existingManifest ? new Map(existingManifest.decisions.map(row => [row.ml_item_id, row.command_id])) : null;
  const decisions = input.audit.map(row => createDecision(row, priorById.get(row.ml_item_id), live,
    commandIds?.get(row.ml_item_id) || crypto.randomUUID()));
  const generatedAt = existingManifest?.generated_at || new Date().toISOString();
  const manifest = { version: 'BNT-ML-CATALOG-IDENTITY-01/executive-179-v1', run_id: existingManifest?.run_id || crypto.randomUUID(),
    generated_at: generatedAt, expires_at: existingManifest?.expires_at || new Date(Date.parse(generatedAt) + MANIFEST_TTL_MS).toISOString(),
    source_sha256: INPUTS.audit[1], prior_manifest_hash: PRIOR_MANIFEST_HASH, seller_id: SELLER_ID,
    decisions, readonly_stats: ml.stats(), database_target: existingManifest?.database_target || null };
  manifest.manifest_hash = manifestHash(manifest);
  return manifest;
}

function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? stableJson(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function csv(rows, columns) { return `\uFEFF${[columns, ...rows.map(row => columns.map(column => row[column]))].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`; }
function writeAtomic(file, body) { const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, body); fs.renameSync(temporary, file); }

function writeArtifacts(outputDir, manifest, phase, application = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const decisions = manifest.decisions;
  const batch = number => decisions.filter(row => (number === 1 ? manifestBatch(row, 1) : manifestBatch(row, 2)));
  const auditColumns = ['sku','produto_id','ml_item_id','standard_item_id','catalog_product_id','previous_state','identity_state','reason_code','risk_tier','action','action_result','material_fingerprint','pricing_eligible_by_identity','observed_at','ml_readback','error'];
  const eligibilityColumns = ['sku','ml_item_id','effective_ml_item_id','identity_state','identity_release_source','ml_live_source_available','block_price_write','block_buy_box_chase','pricing_eligible_by_identity','economic_state','pricing_queue','audit_id'];
  const release = decisions.filter(row => row.execution_action === 'RELEASE_IDENTITY_GATE_AFTER_READBACK');
  const pending = decisions.filter(row => row.execution_action === 'HOLD_MANUAL_EVIDENCE');
  const conflicts = decisions.filter(row => row.execution_action === 'RELINK_TRANSACTION_REQUIRED');
  const decorate = row => ({ ...row, audit_id: application[row.ml_item_id]?.audit_id || null, phase });
  writeAtomic(path.join(outputDir, ARTIFACTS[0]), csv(decisions.map(decorate), auditColumns));
  writeAtomic(path.join(outputDir, ARTIFACTS[1]), `${stableJson(release.map(decorate), 2)}\n`);
  writeAtomic(path.join(outputDir, ARTIFACTS[2]), `${stableJson(pending.map(decorate), 2)}\n`);
  writeAtomic(path.join(outputDir, ARTIFACTS[3]), `${stableJson(batch(1).map(decorate), 2)}\n`);
  writeAtomic(path.join(outputDir, ARTIFACTS[4]), `${stableJson(batch(2).map(decorate), 2)}\n`);
  writeAtomic(path.join(outputDir, ARTIFACTS[5]), `${stableJson(conflicts.filter(row => row.action_result !== 'RELINK_CONFIRMED').map(decorate), 2)}\n`);
  const eligibility = decisions.map(row => ({ sku: row.sku, ml_item_id: row.ml_item_id, effective_ml_item_id: row.ml_item_id,
    identity_state: row.identity_state, identity_release_source: RELEASE_SOURCE,
    ml_live_source_available: row.ml_live_source_available, block_price_write: !row.pricing_eligible_by_identity,
    block_buy_box_chase: !row.pricing_eligible_by_identity, pricing_eligible_by_identity: row.pricing_eligible_by_identity,
    economic_state: row.pricing_eligible_by_identity ? 'PENDENTE_VALIDACAO_INDIVIDUAL' : 'NAO_APLICAVEL_IDENTIDADE_BLOQUEADA',
    pricing_queue: row.pricing_eligible_by_identity ? '' : 'BLOQUEADO_IDENTIDADE', audit_id: application[row.ml_item_id]?.audit_id || null }));
  writeAtomic(path.join(outputDir, ARTIFACTS[6]), csv(eligibility, eligibilityColumns));
  const counts = Object.fromEntries([...Map.groupBy(decisions, row => row.identity_state).entries()].map(([key, values]) => [key, values.length]));
  const summary = [`# P0 — Fechamento da auditoria executiva de 179 casos`, '', `- Fase: ${phase}`,
    `- Run: \`${manifest.run_id}\``, `- Manifesto: \`${manifest.manifest_hash}\``, `- Total: ${decisions.length}`,
    `- SEM_CONFLITO: ${counts.SEM_CONFLITO || 0}`, `- CONFLITO_CONFIRMADO: ${counts.CONFLITO_CONFIRMADO || 0}`,
    `- PENDENCIA_VALIDACAO: ${counts.PENDENCIA_VALIDACAO || 0}`, `- INCONCLUSIVO: ${counts.INCONCLUSIVO || 0}`,
    `- Liberados por identidade: ${decisions.filter(row => row.pricing_eligible_by_identity).length}`,
    `- Bloqueados por identidade: ${decisions.filter(row => !row.pricing_eligible_by_identity).length}`,
    `- Relinks confirmados: ${conflicts.filter(row => row.action_result === 'RELINK_CONFIRMED').length}`,
    `- Relinks sem caminho seguro: ${conflicts.filter(row => row.action_result === 'BLOCKED_NO_SAFE_RELINK').length}`,
    `- Alterações de preço executadas: 0`, `- Alterações de estoque executadas: 0`,
    `- Alterações de produtos.ativo executadas: 0`, '',
    'Os 1.371 casos anteriores permanecem fora desta projeção. Esta missão não executou repricing nem validação econômica final.', ''];
  writeAtomic(path.join(outputDir, ARTIFACTS[7]), summary.join('\n'));
  const inventory = Object.fromEntries(ARTIFACTS.map(name => [name, { sha256: sha256(fs.readFileSync(path.join(outputDir, name))) }]));
  writeAtomic(path.join(outputDir, phase === 'prepared' ? 'prepared_manifest.json' : 'applied_manifest.json'), `${stableJson({ ...manifest, artifacts: inventory, application }, 2)}\n`);
}

function manifestBatch(row, batch) {
  const source = batch === 1 ? INPUTS.batch01[0] : INPUTS.batch02[0];
  return row.execution_action === 'RELINK_TRANSACTION_REQUIRED' && row.notes && row._batch_source === source;
}

function tagBatches(input, manifest) {
  const first = new Set(input.batch01.map(row => row.ml_item_id));
  const second = new Set(input.batch02.map(row => row.ml_item_id));
  for (const row of manifest.decisions) row._batch_source = first.has(row.ml_item_id) ? INPUTS.batch01[0] : second.has(row.ml_item_id) ? INPUTS.batch02[0] : null;
}

async function applyManifest(input, manifest, client, actorId, outputDir, ml) {
  if (!/^[0-9a-f-]{36}$/i.test(actorId || '')) throw new Error('p0_actor_id_required');
  const actor = await client.from('profiles').select('id,cargo').eq('id', actorId).maybeSingle();
  if (actor.error || actor.data?.cargo !== 'admin') throw new Error('p0_actor_admin_required');
  if (Date.parse(manifest.expires_at) <= Date.now()) throw new Error('prepared_manifest_expired');
  const fresh = await buildPlan(input, client, ml, manifest); tagBatches(input, fresh); fresh.manifest_hash = manifestHash(fresh);
  if (fresh.manifest_hash !== manifest.manifest_hash) throw new Error(`prepared_manifest_changed:${fresh.manifest_hash}`);
  const runPayload = { id: manifest.run_id, state: 'applying', mode: 'apply', rule_version: manifest.version,
    baseline_filename: INPUTS.audit[0], baseline_sha256: INPUTS.audit[1], baseline_count: 179, delta_count: 0,
    total_count: 179, manifest_hash: manifest.manifest_hash, approved_manifest_hash: manifest.manifest_hash,
    snapshot_at: manifest.generated_at, started_at: new Date().toISOString(), approved_at: new Date().toISOString(),
    created_by: actorId, approved_by: actorId, summary: { source: RELEASE_SOURCE, scope: 179, price_changes: 0, stock_changes: 0, produtos_ativo_changes: 0 } };
  const existing = await client.from('ml_catalog_identity_runs').select('id,state,manifest_hash').eq('id', manifest.run_id).maybeSingle();
  if (existing.error) throw new Error(`run_read_failed:${existing.error.code}`);
  if (!existing.data) { const created = await client.from('ml_catalog_identity_runs').insert(runPayload); if (created.error) throw new Error(`run_create_failed:${created.error.code}`); }
  else if (existing.data.manifest_hash !== manifest.manifest_hash || !['applying','completed'].includes(existing.data.state)) throw new Error('run_replay_conflict');
  for (const batch of chunks(manifest.decisions, 50)) {
    const rows = batch.map((row, index) => ({ run_id: manifest.run_id, ml_item_id: row.ml_item_id,
      ordinal: manifest.decisions.indexOf(row), source_origin: 'baseline', processing_state: 'pending',
      attempts: 0, input_row: row }));
    const inserted = await client.from('ml_catalog_identity_audits').upsert(rows, { onConflict: 'run_id,ml_item_id', ignoreDuplicates: true });
    if (inserted.error) throw new Error(`audit_seed_failed:${inserted.error.code}`);
  }
  const application = {};
  for (const batch of chunks(manifest.decisions, 20)) {
    for (const row of batch) {
      const payload = { ...row, action_reason: row.action_result, rollback_plan: row.rollback_plan };
      const result = await client.rpc('apply_ml_catalog_identity_projection', { p_run_id: manifest.run_id,
        p_actor_id: actorId, p_manifest_hash: manifest.manifest_hash, p_command_id: row.command_id, p_payload: payload });
      if (result.error) throw new Error(`projection_apply_failed:${row.ml_item_id}:${result.error.code || result.error.message}`);
      application[row.ml_item_id] = result.data;
    }
    const productIds = [...new Set(batch.map(row => row.produto_id).filter(Boolean))];
    const after = await fetchByValues(client, 'produtos', 'id,ativo,estoque,custom_price', 'id', productIds);
    const byId = new Map(after.map(row => [row.id, row]));
    if (batch.some(row => { const product = byId.get(row.produto_id); return product?.ativo !== row.produtos_ativo
      || product?.estoque !== row.produtos_estoque || product?.custom_price !== row.produtos_custom_price; })) throw new Error('operational_product_invariant_changed');
  }
  const counts = Object.fromEntries([...Map.groupBy(manifest.decisions, row => row.identity_state).entries()].map(([key, values]) => [key, values.length]));
  const completed = await client.from('ml_catalog_identity_runs').update({ state: 'completed', finished_at: new Date().toISOString(),
    summary: { source: RELEASE_SOURCE, total: 179, ...counts,
      liberados_pricing_por_identidade: manifest.decisions.filter(row => row.pricing_eligible_by_identity).length,
      bloqueados_pricing: manifest.decisions.filter(row => !row.pricing_eligible_by_identity).length,
      relinks_confirmed: 0, blocked_no_safe_relink: manifest.decisions.filter(row => row.action_result === 'BLOCKED_NO_SAFE_RELINK').length,
      price_changes: 0, stock_changes: 0, produtos_ativo_changes: 0 } }).eq('id', manifest.run_id).eq('state', 'applying')
    .select('id').maybeSingle();
  if (completed.error || !completed.data) throw new Error(`run_complete_failed:${completed.error?.code || 'state_changed'}`);
  writeArtifacts(outputDir, manifest, 'applied', application);
  return { application, counts };
}

function parseArgs(argv) {
  const args = { mode: argv[0] };
  for (let i = 1; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  if (!['prepare','apply'].includes(args.mode) || !args['input-dir'] || !args['prior-dir'] || !args['output-dir']) throw new Error('usage: prepare|apply --input-dir DIR --prior-dir DIR --output-dir DIR [--manifest FILE]');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serviceUrl = process.env.SUPABASE_SERVICE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) throw new Error('supabase_service_environment_missing');
  const databaseTarget = await assertProductionTarget(serviceUrl);
  const client = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const input = loadInputs(path.resolve(args['input-dir']), path.resolve(args['prior-dir']));
  const token = await loadToken(client); const ml = readonlyMl(token);
  if (args.mode === 'prepare') {
    const manifest = await buildPlan(input, client, ml); tagBatches(input, manifest);
    manifest.database_target = databaseTarget;
    manifest.manifest_hash = manifestHash(manifest);
    writeArtifacts(path.resolve(args['output-dir']), manifest, 'prepared');
    console.log(stableJson({ event: 'p0_179_prepared', run_id: manifest.run_id, manifest_hash: manifest.manifest_hash,
      expires_at: manifest.expires_at, output_dir: path.resolve(args['output-dir']) }, 2));
    return;
  }
  const manifestPath = path.resolve(args.manifest || path.join(args['output-dir'], 'prepared_manifest.json'));
  const wrapper = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifest = { ...wrapper }; delete manifest.artifacts; delete manifest.application;
  let result;
  try {
    result = await applyManifest(input, manifest, client, process.env.P0_ACTOR_ID, path.resolve(args['output-dir']), ml);
  } catch (error) {
    await client.from('ml_catalog_identity_runs').update({ state: 'paused', finished_at: new Date().toISOString(),
      safety_stop: { code: String(error?.message || error).slice(0, 500), source: RELEASE_SOURCE } })
      .eq('id', manifest.run_id).eq('state', 'applying');
    throw error;
  }
  console.log(stableJson({ event: 'p0_179_applied', run_id: manifest.run_id, manifest_hash: manifest.manifest_hash, ...result.counts }, 2));
}

if (require.main === module) main().catch(error => { console.error(String(error?.message || error)); process.exitCode = 1; });

module.exports = {
  assertProductionTarget,
  chunks,
  createDecision,
  csv,
  fetchByValues,
  jsonObject,
  liveEvidence,
  loadInputs,
  loadToken,
  materialSnapshot,
  normalizeExecutiveRow,
  parseCsv,
  readonlyMl,
  sha256,
  stableJson,
  writeAtomic,
};
