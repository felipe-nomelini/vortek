#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const shared = require('./catalog-identity-p0-executive-179.js');

const SELLER_ID = 3294514937;
const ACTOR = Object.freeze({ name: 'Rodrigo', id: '3e56ce48-f461-4784-848b-097d1e482a43' });
const SOURCE_MANIFEST = 'reports/catalog-identity-p0/BNT-ML-CATALOG-IDENTITY-01-2026-09-15-production-closeout-final/24_production_execution_manifest.json';
const ARTIFACTS = Object.freeze([
  '28_identity_reaudit_7.csv',
  '29_identity_reaudit_evidence_7.json',
  '30_identity_reconciliation_preview.json',
  '31_identity_reaudit_7_report.md',
]);
const CASES = Object.freeze([
  { sku: 'VTK017395', ml_item_id: 'MLB7599435246', catalog_product_id: 'MLB65374354', gtin: '07899924900779', brand: 'technoise', model: ['400', 'pro'], family: [['rca'], ['cabo']], material: { length: ['5 m', '5 mts', '5m'] } },
  { sku: 'VTK017306', ml_item_id: 'MLB7598596348', catalog_product_id: 'MLB33318906', gtin: '07898597133170', brand: 'evus', model: ['cp130'], family: [['cooler'], ['processador']] },
  { sku: 'VTK017415', ml_item_id: 'MLB7598468212', catalog_product_id: 'MLB23159345', gtin: '07899924901363', brand: 'technoise', model: [], family: [['fita', 'espuma'], ['chicote']], material: { quantity: ['10 rolos', 'caixa com 10'], length: ['2 m', '2m'] } },
  { sku: 'VTK017455', ml_item_id: 'MLB7320224382', catalog_product_id: 'MLB43425843', gtin: '07908639901787', brand: 'c3tech', model: ['mw15bk'], family: [['mouse']] },
  { sku: 'VTK018822', ml_item_id: 'MLB5196985347', catalog_product_id: 'MLB70223599', gtin: '07896673818669', brand: 'frahm', model: ['tf370'], family: [['caixa', 'alto falante', 'alto-falante']] },
  { sku: 'VTK017315', ml_item_id: 'MLB5196220399', catalog_product_id: 'MLB25940570', gtin: '07898597133286', brand: 'evus', model: ['mo10'], family: [['mouse']] },
  { sku: 'VTK017997', ml_item_id: 'MLB4942204669', catalog_product_id: 'MLB20693641', gtin: '07898348538537', brand: 'elsys', model: ['wr4f'], family: [['camera']] },
]);

function clean(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function searchable(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value) {
  return searchable(value).replace(/\s+/g, '');
}

function normalizeGtin(value) {
  return String(value ?? '').replace(/\D/g, '').padStart(14, '0');
}

function attributeValues(entity, ids) {
  const wanted = new Set(ids);
  const output = [];
  for (const attribute of entity?.attributes || []) {
    if (!wanted.has(attribute.id)) continue;
    if (attribute.value_name != null) output.push(String(attribute.value_name));
    for (const value of attribute.values || []) {
      if (value?.name != null) output.push(String(value.name));
    }
  }
  return [...new Set(output)];
}

function hasAny(corpus, alternatives) {
  return alternatives.some(value => searchable(corpus).includes(searchable(value)));
}

function hasAllCompact(corpus, tokens) {
  const source = compact(corpus);
  return tokens.every(token => source.includes(compact(token)));
}

function classifyCase(rule, context) {
  const { listing, snapshot, product, current, item, catalogProduct } = context;
  if (!listing || !snapshot || !product || !current || !item || !catalogProduct) {
    return { identity_state: 'INCONCLUSIVO', reason_code: 'FONTE_VIVA_INCOMPLETA', checks: {} };
  }
  const itemGtins = attributeValues(item, ['GTIN', 'EAN', 'SELLER_SKU']);
  const catalogGtins = attributeValues(catalogProduct, ['GTIN', 'EAN']);
  const remoteIdentity = [item.title, catalogProduct.name, catalogProduct.title,
    ...attributeValues(item, ['BRAND', 'MODEL']), ...attributeValues(catalogProduct, ['BRAND', 'MODEL'])].join(' ');
  const fullIdentity = [product.nome, product.marca, product.gtin, listing.titulo, snapshot.title, remoteIdentity].join(' ');
  const remoteGtins = [...itemGtins, ...catalogGtins].map(normalizeGtin).filter(Boolean);
  const relationExact = listing.ml_item_id === rule.ml_item_id
    && snapshot.ml_item_id === rule.ml_item_id
    && item.id === rule.ml_item_id
    && listing.sku === rule.sku
    && snapshot.seller_sku === rule.sku
    && product.sku === rule.sku
    && snapshot.catalog_product_id === rule.catalog_product_id
    && item.catalog_product_id === rule.catalog_product_id
    && catalogProduct.id === rule.catalog_product_id;
  const sellerValid = Number(snapshot.seller_id) === SELLER_ID && Number(item.seller_id) === SELLER_ID;
  const statusValid = ['active', 'paused'].includes(item.status) && catalogProduct.status === 'active'
    && !['closed', 'inactive', 'under_review'].includes(searchable(listing.status));
  const gtinLocalValid = normalizeGtin(product.gtin) === normalizeGtin(rule.gtin);
  const gtinRemoteValid = remoteGtins.includes(normalizeGtin(rule.gtin));
  const brandValid = compact(product.marca).includes(compact(rule.brand))
    && compact(remoteIdentity).includes(compact(rule.brand));
  const modelValid = hasAllCompact(fullIdentity, rule.model);
  const familyValid = rule.family.every(group => hasAny(fullIdentity, group));
  const materialChecks = Object.fromEntries(Object.entries(rule.material || {}).map(([key, alternatives]) => [key, hasAny(fullIdentity, alternatives)]));
  const materialValid = Object.values(materialChecks).every(Boolean);
  const remainsBlocked = current.identity_state === 'PENDENCIA_VALIDACAO'
    && current.block_price_write === true && current.block_buy_box_chase === true;
  const checks = { relation_exact: relationExact, seller_valid: sellerValid, status_valid: statusValid,
    gtin_local_valid: gtinLocalValid, gtin_remote_valid: gtinRemoteValid, brand_valid: brandValid,
    model_valid: modelValid, family_valid: familyValid, material_valid: materialValid,
    remains_blocked_during_reaudit: remainsBlocked, material_checks: materialChecks };
  const passed = Object.entries(checks).filter(([key]) => key !== 'material_checks').every(([, value]) => value === true);
  return {
    identity_state: passed ? 'SEM_CONFLITO' : 'PENDENCIA_VALIDACAO',
    reason_code: passed ? 'READBACK_7_REAUDIT_COHERENT' : 'READBACK_7_REAUDIT_NEEDS_REVIEW',
    checks,
  };
}

function safeFetchTracker(fetchImpl = global.fetch) {
  const stats = { database_gets: 0, ml_gets: 0, mutation_attempts: 0 };
  const request = async (input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      stats.mutation_attempts += 1;
      throw new Error(`READONLY_METHOD_BLOCKED:${method}`);
    }
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'api.mercadolibre.com') stats.ml_gets += 1;
    else stats.database_gets += 1;
    return fetchImpl(input, { ...init, method });
  };
  return { request, stats };
}

async function fetchRows(client, table, select, column, values) {
  const result = await client.from(table).select(select).in(column, values);
  if (result.error) throw new Error(`${table}_read_failed:${result.error.code}`);
  return result.data || [];
}

async function countState(client, state) {
  const result = await client.from('ml_catalog_identity_current').select('ml_item_id', { count: 'exact', head: true })
    .eq('seller_id', SELLER_ID).eq('identity_state', state);
  if (result.error) throw new Error(`identity_count_failed:${state}:${result.error.code}`);
  return result.count || 0;
}

async function loadDatabase(client) {
  const ids = CASES.map(row => row.ml_item_id);
  const [listings, snapshots, currents] = await Promise.all([
    fetchRows(client, 'anuncios_ml', 'ml_item_id,produto_id,sku,titulo,preco_ml,status,catalogo,updated_at', 'ml_item_id', ids),
    fetchRows(client, 'catalogo_ml_snapshot', 'ml_item_id,seller_id,produto_id,sku_local,seller_sku,related_item_id,catalog_product_id,status,price,price_to_win,title,synced_at', 'ml_item_id', ids),
    fetchRows(client, 'ml_catalog_identity_current', 'seller_id,ml_item_id,identity_state,block_price_write,block_buy_box_chase,ml_live_source_available,audit_id', 'ml_item_id', ids),
  ]);
  const productIds = listings.map(row => row.produto_id).filter(Boolean);
  const products = await fetchRows(client, 'produtos', 'id,sku,nome,marca,gtin,ativo,estoque,custom_price,updated_at', 'id', productIds);
  if ([listings, snapshots, currents, products].some(rows => rows.length !== CASES.length)) {
    throw new Error(`database_coverage_invalid:${listings.length}:${snapshots.length}:${currents.length}:${products.length}`);
  }
  return { listings, snapshots, currents, products };
}

function operationalSnapshot(database) {
  const sort = rows => [...rows].sort((a, b) => clean(a.ml_item_id || a.id).localeCompare(clean(b.ml_item_id || b.id)));
  return {
    listings: sort(database.listings),
    snapshots: sort(database.snapshots),
    currents: sort(database.currents),
    products: sort(database.products),
  };
}

async function mlGet(fetcher, token, endpoint) {
  const response = await fetcher(`https://api.mercadolibre.com${endpoint}`, {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`ml_read_failed:${endpoint}:${response.status}`);
  return body;
}

function csvCell(value) {
  let output = value == null ? '' : typeof value === 'object' ? shared.stableJson(value) : String(value);
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replace(/"/g, '""')}"`;
}

function csv(rows, columns) {
  return `\uFEFF${[columns, ...rows.map(row => columns.map(column => row[column]))].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function writeArtifacts(outputDirectory, result) {
  if (fs.existsSync(outputDirectory)) throw new Error('output_directory_already_exists');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const auditRows = result.decisions.map(row => ({
    sku: row.sku, ml_item_id: row.ml_item_id, catalog_product_id: row.catalog_product_id,
    local_name: row.local.product.nome, listing_title: row.local.listing.titulo,
    snapshot_title: row.local.snapshot.title, live_item_title: row.live.item.title,
    live_product_name: row.live.catalog_product.name || row.live.catalog_product.title,
    previous_state: row.previous_state, identity_state: row.identity_state,
    reason_code: row.reason_code, checks: row.checks, pricing_eligible_by_identity: false,
  }));
  const bodies = new Map();
  bodies.set(ARTIFACTS[0], csv(auditRows, ['sku','ml_item_id','catalog_product_id','local_name','listing_title','snapshot_title',
    'live_item_title','live_product_name','previous_state','identity_state','reason_code','checks','pricing_eligible_by_identity']));
  bodies.set(ARTIFACTS[1], `${shared.stableJson(result, 2)}\n`);
  bodies.set(ARTIFACTS[2], `${shared.stableJson(result.reconciliation_preview, 2)}\n`);
  const counts = result.decision_counts;
  bodies.set(ARTIFACTS[3], [
    '# BNT-ML-CATALOG-IDENTITY-01 — reauditoria dos sete bloqueios', '',
    `- Executada em: ${result.finished_at}`,
    `- Ator registrado: ${ACTOR.name} (${ACTOR.id})`,
    `- Casos analisados: ${result.decisions.length}`,
    `- SEM_CONFLITO: ${counts.SEM_CONFLITO || 0}`,
    `- CONFLITO_CONFIRMADO: ${counts.CONFLITO_CONFIRMADO || 0}`,
    `- PENDENCIA_VALIDACAO: ${counts.PENDENCIA_VALIDACAO || 0}`,
    `- INCONCLUSIVO: ${counts.INCONCLUSIVO || 0}`,
    `- Escritas no banco ou Mercado Livre: 0`,
    `- Preço, estoque, custom_price, produtos.ativo e vínculos alterados: 0`,
    `- Os sete permaneceram bloqueados durante a reauditoria: ${result.safety.all_remained_blocked ? 'SIM' : 'NÃO'}`,
    `- Reconciliação projetada: ${result.reconciliation_preview.equation}`,
    '',
    'Esta etapa apenas classificou os sete casos. A projeção produtiva não foi alterada.',
    '',
  ].join('\n'));
  for (const [name, body] of bodies) fs.writeFileSync(path.join(outputDirectory, name), body, { flag: 'wx' });
  const checksums = ARTIFACTS.map(name => `${shared.sha256(fs.readFileSync(path.join(outputDirectory, name)))}  ${name}`).join('\n') + '\n';
  fs.writeFileSync(path.join(outputDirectory, 'SHA256SUMS.txt'), checksums, { flag: 'wx' });
}

async function run(options, dependencies = {}) {
  const startedAt = new Date().toISOString();
  const serviceUrl = dependencies.serviceUrl || process.env.SUPABASE_SERVICE_URL;
  const serviceKey = dependencies.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) throw new Error('supabase_service_environment_missing');
  const databaseTarget = await (dependencies.assertTarget || shared.assertProductionTarget)(serviceUrl);
  const tracker = dependencies.tracker || safeFetchTracker(dependencies.fetchImpl || global.fetch);
  const client = dependencies.client || createClient(serviceUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: tracker.request },
  });
  const sourcePath = path.resolve(options.source || SOURCE_MANIFEST);
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const sourceById = new Map((source.decisions || []).map(row => [row.ml_item_id, row]));
  if (CASES.some(row => !sourceById.has(row.ml_item_id))) throw new Error('source_manifest_missing_case');
  const before = await loadDatabase(client);
  if (before.currents.some(row => row.identity_state !== 'PENDENCIA_VALIDACAO' || !row.block_price_write || !row.block_buy_box_chase)) {
    throw new Error('reaudit_case_not_blocked');
  }
  const integration = await client.from('integracoes').select('access_token,token_expires_at,conectado')
    .eq('tipo', 'mercadolivre').maybeSingle();
  if (integration.error || !integration.data?.conectado || !integration.data?.access_token) throw new Error('ml_token_unavailable');
  if (Date.parse(integration.data.token_expires_at || '') - Date.now() < 30 * 60 * 1000) throw new Error('ml_token_ttl_insufficient');
  const token = integration.data.access_token;
  const me = await mlGet(tracker.request, token, '/users/me?attributes=id');
  if (Number(me.id) !== SELLER_ID) throw new Error('ml_seller_invalid');
  const liveById = new Map();
  for (const rule of CASES) {
    const item = await mlGet(tracker.request, token, `/items/${encodeURIComponent(rule.ml_item_id)}?attributes=id,seller_id,title,status,catalog_product_id,seller_custom_field,item_relations,attributes,last_updated`);
    const catalogProduct = await mlGet(tracker.request, token, `/products/${encodeURIComponent(rule.catalog_product_id)}`);
    liveById.set(rule.ml_item_id, { item, catalogProduct });
  }
  const maps = {
    listing: new Map(before.listings.map(row => [row.ml_item_id, row])),
    snapshot: new Map(before.snapshots.map(row => [row.ml_item_id, row])),
    current: new Map(before.currents.map(row => [row.ml_item_id, row])),
    product: new Map(before.products.map(row => [row.id, row])),
  };
  const decisions = CASES.map(rule => {
    const listing = maps.listing.get(rule.ml_item_id);
    const context = { listing, snapshot: maps.snapshot.get(rule.ml_item_id), current: maps.current.get(rule.ml_item_id),
      product: maps.product.get(listing?.produto_id), item: liveById.get(rule.ml_item_id)?.item,
      catalogProduct: liveById.get(rule.ml_item_id)?.catalogProduct };
    const decision = classifyCase(rule, context);
    return { ...rule, previous_state: context.current?.identity_state || null, ...decision,
      pricing_eligible_by_identity: false,
      local: { product: context.product, listing: context.listing, snapshot: context.snapshot },
      live: { item: context.item, catalog_product: context.catalogProduct },
      prior_drift: sourceById.get(rule.ml_item_id)?.evidence || null };
  });
  const after = await loadDatabase(client);
  const beforeHash = shared.sha256(shared.stableJson(operationalSnapshot(before)));
  const afterHash = shared.sha256(shared.stableJson(operationalSnapshot(after)));
  if (beforeHash !== afterHash) throw new Error('readonly_database_changed_during_reaudit');
  if (tracker.stats.mutation_attempts !== 0) throw new Error('readonly_mutation_attempt_detected');
  const currentCounts = {};
  for (const state of ['SEM_CONFLITO','CONFLITO_CONFIRMADO','PENDENCIA_VALIDACAO','INCONCLUSIVO']) {
    currentCounts[state] = await countState(client, state);
  }
  const decisionCounts = Object.fromEntries([...Map.groupBy(decisions, row => row.identity_state).entries()].map(([key, rows]) => [key, rows.length]));
  const approved = decisionCounts.SEM_CONFLITO || 0;
  const projected = {
    SEM_CONFLITO: currentCounts.SEM_CONFLITO + approved,
    CONFLITO_CONFIRMADO: currentCounts.CONFLITO_CONFIRMADO + (decisionCounts.CONFLITO_CONFIRMADO || 0),
    PENDENCIA_VALIDACAO: currentCounts.PENDENCIA_VALIDACAO - approved,
    INCONCLUSIVO: currentCounts.INCONCLUSIVO + (decisionCounts.INCONCLUSIVO || 0),
  };
  const blocked = projected.CONFLITO_CONFIRMADO + projected.PENDENCIA_VALIDACAO + projected.INCONCLUSIVO;
  const reconciliationPreview = { current: currentCounts, decisions: decisionCounts, projected,
    total: Object.values(projected).reduce((sum, value) => sum + value, 0), blocked,
    equation: `${Object.values(projected).reduce((sum, value) => sum + value, 0)}=${projected.SEM_CONFLITO}+${projected.CONFLITO_CONFIRMADO}+${projected.PENDENCIA_VALIDACAO}+${projected.INCONCLUSIVO}`,
    applied: false };
  const result = { version: 'BNT-ML-CATALOG-IDENTITY-01/reaudit-7-v1', started_at: startedAt,
    finished_at: new Date().toISOString(), actor: ACTOR, database_target: databaseTarget,
    source_manifest: { path: sourcePath, sha256: shared.sha256(fs.readFileSync(sourcePath)) },
    readonly_stats: tracker.stats, decision_counts: decisionCounts, decisions,
    safety: { before_hash: beforeHash, after_hash: afterHash, operational_invariants_equal: true,
      all_remained_blocked: after.currents.every(row => row.identity_state === 'PENDENCIA_VALIDACAO' && row.block_price_write && row.block_buy_box_chase),
      database_writes: 0, ml_writes: 0 }, reconciliation_preview: reconciliationPreview };
  writeArtifacts(path.resolve(options.output), result);
  return { output_directory: path.resolve(options.output), decision_counts: decisionCounts,
    reconciliation_preview: reconciliationPreview, readonly_stats: tracker.stats };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    if (!['output','source'].includes(key) || !argv[index + 1]) throw new Error('usage: --output DIR [--source FILE]');
    options[key] = argv[index + 1];
  }
  if (!options.output) throw new Error('usage: --output DIR [--source FILE]');
  return options;
}

if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).then(result => {
    process.stdout.write(`${shared.stableJson({ event: 'catalog_identity_reaudit_7_completed', ...result }, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${shared.stableJson({ event: 'catalog_identity_reaudit_7_failed', error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { ARTIFACTS, CASES, classifyCase, parseArgs, safeFetchTracker };
