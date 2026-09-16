#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const shared = require('./catalog-identity-p0-executive-179.js');
const priorReaudit = require('./catalog-identity-p0-reaudit-7.js');
const closeout = require('./catalog-identity-p0-production-closeout.js');

const SELLER_ID = 3294514937;
const ACTOR = Object.freeze({ name: 'Rodrigo', id: '3e56ce48-f461-4784-848b-097d1e482a43' });
const VERSION = 'BNT-ML-CATALOG-IDENTITY-01/finalize-title-drifts-25-v1';
const TTL_MS = 30 * 60 * 1000;
const EXPECTED_BEFORE = Object.freeze({ SEM_CONFLITO: 1501, CONFLITO_CONFIRMADO: 22, PENDENCIA_VALIDACAO: 27, INCONCLUSIVO: 0 });
const EXPECTED_AFTER = Object.freeze({ SEM_CONFLITO: 1526, CONFLITO_CONFIRMADO: 22, PENDENCIA_VALIDACAO: 2, INCONCLUSIVO: 0 });
const ARTIFACTS = Object.freeze([
  '32_identity_reaudit_18.csv',
  '33_identity_reaudit_evidence_18.json',
  '34_identity_release_25_manifest.json',
  '35_identity_release_25_before_after.csv',
  '36_final_identity_reconciliation.json',
  '37_p0_closeout_final.md',
]);

const NEW_CASES = Object.freeze([
  { sku: 'VTK000303', ml_item_id: 'MLB7137239362', catalog_product_id: 'MLB60101636', gtin: '7898461965487', brand: 'ventisol', model: ['turbo'], family: [['ventilador']], material: { size: ['50cm', '50 cm'], voltage: ['220v'] }, content_quality_flag: 'TITLE_REVIEW_REQUIRED' },
  { sku: 'VTK012606', ml_item_id: 'MLB7157761038', catalog_product_id: 'MLB22936241', gtin: '7897013517402', brand: 'elgin', model: ['mv4123'], family: [['calculadora']] },
  { sku: 'VTK017192', ml_item_id: 'MLB5196179289', catalog_product_id: 'MLB36165222', gtin: '7898446730048', brand: 'implastec', model: ['500ml'], family: [['alcool', 'isopropilico']], material: { volume: ['500ml', '500 ml'] } },
  { sku: 'VTK017432', ml_item_id: 'MLB5196305189', catalog_product_id: 'MLB36772043', gtin: '7908639901503', brand: 'c3tech', model: ['kbm11bk'], family: [['teclado']] },
  { sku: 'VTK017452', ml_item_id: 'MLB5195693789', catalog_product_id: 'MLB44553702', gtin: '7898578155146', brand: 'aiwa', model: ['sp03bl'], family: [['caixa', 'speaker']] },
  { sku: 'VTK017501', ml_item_id: 'MLB5195694753', catalog_product_id: 'MLB69135354', gtin: '7908639903316', brand: 'c3tech', model: ['mt36bk'], family: [['gabinete']], material: { power: ['200w', '200 w'] } },
  { sku: 'VTK017503', ml_item_id: 'MLB5195695605', catalog_product_id: 'MLB50061217', gtin: '7908639900513', brand: 'c3tech', model: ['lb40bk'], family: [['leitor'], ['codigo de barras']] },
  { sku: 'VTK017578', ml_item_id: 'MLB5196228611', catalog_product_id: 'MLB18909165', gtin: '7899838821573', brand: 'multilaser', model: ['tc220'], family: [['teclado']] },
  { sku: 'VTK017692', ml_item_id: 'MLB7598736448', catalog_product_id: 'MLB27962660', gtin: '7908685679623', brand: 'multilaser', model: ['nb413'], family: [['tablet']], material: { memory: ['4gb', '4 gb'], storage: ['64gb', '64 gb'], size: ['7'] } },
  { sku: 'VTK017709', ml_item_id: 'MLB7599181224', catalog_product_id: 'MLB29527454', gtin: '7897748704931', brand: 'stetsom', model: ['sx1'], family: [['controle']] },
  { sku: 'VTK018418', ml_item_id: 'MLB5196877119', catalog_product_id: 'MLB66053326', gtin: '7908639903897', brand: 'c3tech', model: ['mr240'], family: [['monitor']], material: { size: ['24'] } },
  { sku: 'VTK018799', ml_item_id: 'MLB7598595224', catalog_product_id: 'MLB32955232', gtin: '7896673816856', brand: 'frahm', model: ['fip302bp36'], family: [['camera']] },
  { sku: 'VTK018826', ml_item_id: 'MLB7599425720', catalog_product_id: 'MLB28249754', gtin: '4895228200501', brand: 'tech one', model: ['pwb2366'], family: [['inversor', 'conversor']], material: { input: ['24v', '24 v'], output: ['110v', '110 v'], power: ['800w', '800 w'] } },
  { sku: 'VTK018978', ml_item_id: 'MLB7598528112', catalog_product_id: 'MLB22381168', gtin: '7898419498456', brand: 'proeletronic', model: ['cahd200015'], family: [['cabo'], ['hdmi']], material: { length: ['15m', '15 m', '15 metros'] } },
  { sku: 'VTK019222', ml_item_id: 'MLB5196223707', catalog_product_id: 'MLB37831821', gtin: '7908639901640', brand: 'c3tech', model: ['hu230bk'], family: [['hub'], ['usb']], material: { ports: ['4 portas'] } },
  { sku: 'VTK022558', ml_item_id: 'MLB5196223545', catalog_product_id: 'MLB21871598', gtin: '7898555219731', brand: 'c3tech', model: ['ep07bk'], family: [['fone'], ['ouvido']] },
  { sku: 'VTK023645', ml_item_id: 'MLB7598596270', catalog_product_id: 'MLB21652236', gtin: '7898555210745', brand: 'c3tech', model: ['lb110bk'], family: [['leitor'], ['codigo de barras']], material: { voltage: ['5v', '5 v'] } },
  { sku: 'VTK026053', ml_item_id: 'MLB5195693021', catalog_product_id: 'MLB51100288', gtin: '7908639900674', brand: 'c3tech', model: ['psg700b'], family: [['fonte']], material: { power: ['700w', '700 w'] } },
]);
const CASES = Object.freeze([...priorReaudit.CASES, ...NEW_CASES].sort((a, b) => a.sku.localeCompare(b.sku)));

function parseArgs(argv) {
  const options = { mode: argv[0] };
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    if (!['output','universe','manifest'].includes(key) || !argv[index + 1]) throw new Error('usage: prepare|apply --output DIR --universe CSV [--manifest FILE]');
    options[key] = argv[index + 1];
  }
  if (!['prepare','apply'].includes(options.mode) || !options.output || !options.universe) throw new Error('usage: prepare|apply --output DIR --universe CSV [--manifest FILE]');
  return options;
}

function csvCell(value) {
  let output = value == null ? '' : typeof value === 'object' ? shared.stableJson(value) : String(value);
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replace(/"/g, '""')}"`;
}

function csv(rows, columns) {
  return `\uFEFF${[columns, ...rows.map(row => columns.map(column => row[column]))].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function manifestHash(manifest) {
  return shared.sha256(shared.stableJson({
    version: manifest.version, run_id: manifest.run_id, generated_at: manifest.generated_at,
    expires_at: manifest.expires_at, seller_id: manifest.seller_id, actor: manifest.actor,
    universe_sha256: manifest.universe_sha256,
    decisions: manifest.decisions.map(row => ({
      sku: row.sku, ml_item_id: row.ml_item_id, produto_id: row.produto_id,
      catalog_product_id: row.catalog_product_id, standard_item_id: row.standard_item_id,
      identity_state: row.identity_state, reason_code: row.reason_code,
      material_fingerprint: row.material_fingerprint, command_id: row.command_id,
      local_listing_price: row.local_listing_price, produtos_ativo: row.produtos_ativo,
      produtos_estoque: row.produtos_estoque, produtos_custom_price: row.produtos_custom_price,
      content_quality_flag: row.content_quality_flag || null,
    })),
  }));
}

async function loadTokenReadOnly(client) {
  const result = await client.from('integracoes').select('access_token,token_expires_at,conectado')
    .eq('tipo', 'mercadolivre').maybeSingle();
  if (result.error || !result.data?.conectado || !result.data?.access_token) throw new Error('ml_token_unavailable');
  if (Date.parse(result.data.token_expires_at || '') - Date.now() < 30 * 60 * 1000) throw new Error('ml_token_ttl_insufficient');
  return result.data.access_token;
}

async function stateCounts(client) {
  const counts = {};
  for (const state of ['SEM_CONFLITO','CONFLITO_CONFIRMADO','PENDENCIA_VALIDACAO','INCONCLUSIVO']) {
    const result = await client.from('ml_catalog_identity_current').select('ml_item_id', { count: 'exact', head: true })
      .eq('seller_id', SELLER_ID).eq('identity_state', state);
    if (result.error) throw new Error(`identity_count_failed:${state}:${result.error.code}`);
    counts[state] = result.count || 0;
  }
  return counts;
}

function loadUniverse(file) {
  const bytes = fs.readFileSync(file);
  const rows = shared.parseCsv(bytes.toString('utf8'));
  const ids = rows.map(row => row.ml_item_id);
  if (rows.length !== 1550 || new Set(ids).size !== 1550) throw new Error('universe_invalid');
  return { ids, sha256: shared.sha256(bytes) };
}

async function buildManifest(client, ml, universe, existing = null) {
  const scope = CASES.map(row => ({ ...row, audited_state: 'SEM_CONFLITO' }));
  const live = await shared.liveEvidence({ audit: scope, batch01: [], batch02: [] }, client, ml);
  const currents = await shared.fetchByValues(client, 'ml_catalog_identity_current',
    'seller_id,ml_item_id,audit_id,identity_state,reason_code,block_price_write,block_buy_box_chase,ml_live_source_available',
    'ml_item_id', scope.map(row => row.ml_item_id));
  if (currents.length !== 25) throw new Error(`current_coverage_invalid:${currents.length}`);
  const audits = await shared.fetchByValues(client, 'ml_catalog_identity_audits', 'id,ml_item_id,comparisons,input_row', 'id', currents.map(row => row.audit_id));
  const currentById = new Map(currents.map(row => [row.ml_item_id, row]));
  const auditById = new Map(audits.map(row => [row.id, row]));
  const commandById = new Map((existing?.decisions || []).map(row => [row.ml_item_id, row.command_id]));
  const decisions = scope.map(rule => {
    const listing = live.listingById.get(rule.ml_item_id);
    const snapshot = live.snapshotById.get(rule.ml_item_id);
    const product = live.productById.get(listing?.produto_id);
    const current = currentById.get(rule.ml_item_id);
    const item = live.itemById.get(rule.ml_item_id);
    const catalogProduct = live.productByCatalog.get(rule.catalog_product_id);
    const classified = priorReaudit.classifyCase(rule, { listing, snapshot, product, current, item, catalogProduct });
    if (classified.identity_state !== 'SEM_CONFLITO') throw new Error(`reaudit_not_clear:${rule.sku}:${classified.reason_code}`);
    const relation = { ml_item_id: rule.ml_item_id, produto_id: listing.produto_id, sku: listing.sku,
      standard_item_id: snapshot.related_item_id || null, catalog_product_id: snapshot.catalog_product_id };
    const material = shared.materialSnapshot(item, catalogProduct, { product, listing, snapshot });
    const audit = auditById.get(current.audit_id);
    return {
      sku: rule.sku, ml_item_id: rule.ml_item_id, produto_id: listing.produto_id,
      seller_id: SELLER_ID, catalog_product_id: rule.catalog_product_id,
      standard_item_id: snapshot.related_item_id || null,
      identity_state: 'SEM_CONFLITO', reason_code: 'TITLE_DRIFT_REAUDIT_APPROVED',
      material_fingerprint: shared.sha256(shared.stableJson(material)),
      ml_live_source_available: true, pricing_eligible_by_identity: true,
      observed_at: new Date().toISOString(), current_price: Number(item.price),
      available_quantity: Number(item.available_quantity), local_listing_price: Number(listing.preco_ml),
      produtos_ativo: product.ativo, produtos_estoque: product.estoque,
      produtos_custom_price: product.custom_price, old_relation: relation, new_relation: relation,
      action: 'RELEASE_TITLE_DRIFT_AFTER_READBACK', action_result: 'RELEASED_AFTER_TITLE_REAUDIT',
      error: null, command_id: commandById.get(rule.ml_item_id) || crypto.randomUUID(),
      content_quality_flag: rule.content_quality_flag || null,
      comparisons: audit?.comparisons || [],
      evidence: { source: 'ml_live', checks: classified.checks,
        previous_state: current.identity_state, previous_reason_code: current.reason_code,
        content_quality_flag: rule.content_quality_flag || null,
        title_before: audit?.input_row?.ml_readback?.title || null,
        title_current: item.title, catalog_product_name: catalogProduct.name || catalogProduct.title || null },
      ml_readback: { item_id: item.id, seller_id: item.seller_id, status: item.status,
        catalog_product_id: item.catalog_product_id, related_item_id: snapshot.related_item_id || null,
        title: item.title, observed_at: new Date().toISOString() },
      rollback_plan: { strategy: 'restore_pending_identity_projection_with_compensating_run', destructive_delete: false },
    };
  });
  const generatedAt = existing?.generated_at || new Date().toISOString();
  const manifest = { version: VERSION, run_id: existing?.run_id || crypto.randomUUID(),
    generated_at: generatedAt, expires_at: existing?.expires_at || new Date(Date.parse(generatedAt) + TTL_MS).toISOString(),
    seller_id: SELLER_ID, actor: ACTOR, universe_sha256: universe.sha256,
    decisions, readonly_stats: ml.stats() };
  manifest.manifest_hash = manifestHash(manifest);
  return manifest;
}

function ensureOutput(output, create) {
  if (create) {
    if (fs.existsSync(output)) throw new Error('output_directory_already_exists');
    fs.mkdirSync(output, { recursive: true });
  } else if (!fs.existsSync(output)) throw new Error('output_directory_missing');
}

function writeChecksums(output) {
  const names = fs.readdirSync(output).filter(name => name !== 'SHA256SUMS.txt').sort();
  const body = names.map(name => `${shared.sha256(fs.readFileSync(path.join(output, name)))}  ${name}`).join('\n') + '\n';
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), body);
}

function writePrepared(output, manifest) {
  ensureOutput(output, true);
  const newDecisions = manifest.decisions.filter(row => NEW_CASES.some(rule => rule.ml_item_id === row.ml_item_id));
  const columns = ['sku','ml_item_id','catalog_product_id','previous_state','identity_state','reason_code','title_before','title_current','checks','content_quality_flag'];
  const rows = newDecisions.map(row => ({ sku: row.sku, ml_item_id: row.ml_item_id,
    catalog_product_id: row.catalog_product_id, previous_state: row.evidence.previous_state,
    identity_state: row.identity_state, reason_code: row.reason_code,
    title_before: row.evidence.title_before, title_current: row.evidence.title_current,
    checks: row.evidence.checks, content_quality_flag: row.content_quality_flag }));
  fs.writeFileSync(path.join(output, ARTIFACTS[0]), csv(rows, columns), { flag: 'wx' });
  fs.writeFileSync(path.join(output, ARTIFACTS[1]), `${shared.stableJson({ generated_at: manifest.generated_at,
    actor: ACTOR, mutation_attempts: 0, decisions: newDecisions }, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(output, ARTIFACTS[2]), `${shared.stableJson(manifest, 2)}\n`, { flag: 'wx' });
  writeChecksums(output);
}

function operationalSnapshot(snapshot) {
  return { products: snapshot.products, listings: snapshot.listings,
    target_relations: snapshot.target_relations, outbox: snapshot.outbox };
}

async function acquireLocks(client, runId) {
  const ownerToken = `bnt-ml-catalog-identity-final:${runId}:${crypto.randomUUID()}`;
  const domains = [];
  try {
    for (const domain of closeout.LOCK_DOMAINS) {
      const result = await client.rpc('acquire_sync_domain_lock', { p_domain: domain,
        p_owner_task: 'BNT-ML-CATALOG-IDENTITY-01', p_owner_token: ownerToken,
        p_owner_job_id: null, p_ttl_seconds: 1800, p_metadata: { run_id: runId, actor_id: ACTOR.id, purpose: 'finalize_25_identity_only' } });
      if (result.error || !result.data) throw new Error(`lock_unavailable:${domain}`);
      domains.push(domain);
    }
    return { ownerToken, domains };
  } catch (error) {
    for (const domain of domains.reverse()) await client.rpc('release_sync_domain_lock', { p_domain: domain, p_owner_token: ownerToken, p_force: false });
    throw error;
  }
}

async function releaseLocks(client, lock) {
  if (!lock) return;
  for (const domain of [...lock.domains].reverse()) {
    const result = await client.rpc('release_sync_domain_lock', { p_domain: domain, p_owner_token: lock.ownerToken, p_force: false });
    if (result.error) throw new Error(`lock_release_failed:${domain}`);
  }
}

async function apply(options, client, ml, universe) {
  closeout.assertDatabaseCredentialGate();
  if (process.env.P0_ACTOR_ID !== ACTOR.id) throw new Error('p0_actor_rodrigo_required');
  const manifestFile = path.resolve(options.manifest || path.join(options.output, ARTIFACTS[2]));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.version !== VERSION || manifest.manifest_hash !== manifestHash(manifest)) throw new Error('manifest_invalid');
  if (Date.parse(manifest.expires_at) <= Date.now()) throw new Error('manifest_expired');
  if (manifest.decisions.length !== 25 || new Set(manifest.decisions.map(row => row.ml_item_id)).size !== 25) throw new Error('manifest_scope_invalid');
  const actor = await client.from('profiles').select('id,cargo').eq('id', ACTOR.id).maybeSingle();
  if (actor.error || actor.data?.cargo !== 'admin') throw new Error('actor_invalid');
  let lock = null;
  let runCreated = false;
  try {
    lock = await acquireLocks(client, manifest.run_id);
    const beforeCounts = await stateCounts(client);
    if (shared.stableJson(beforeCounts) !== shared.stableJson(EXPECTED_BEFORE)) throw new Error(`before_reconciliation_changed:${shared.stableJson(beforeCounts)}`);
    const before = await client.rpc('ml_catalog_identity_safety_snapshot', { p_seller_id: SELLER_ID, p_item_ids: universe.ids });
    if (before.error) throw new Error(`before_snapshot_failed:${before.error.code}`);
    const fresh = await buildManifest(client, ml, universe, manifest);
    if (fresh.manifest_hash !== manifest.manifest_hash) throw new Error(`manifest_changed:${fresh.manifest_hash}`);
    const runPayload = { id: manifest.run_id, state: 'applying', mode: 'apply', rule_version: VERSION,
      baseline_filename: '34_identity_release_25_manifest.json', baseline_sha256: manifest.manifest_hash,
      baseline_count: 25, delta_count: 25, total_count: 25, manifest_hash: manifest.manifest_hash,
      approved_manifest_hash: manifest.manifest_hash, snapshot_at: manifest.generated_at,
      started_at: new Date().toISOString(), approved_at: new Date().toISOString(),
      created_by: ACTOR.id, approved_by: ACTOR.id,
      summary: { source: 'TITLE_DRIFT_REAUDIT_25', expected_before: EXPECTED_BEFORE, expected_after: EXPECTED_AFTER } };
    const created = await client.from('ml_catalog_identity_runs').insert(runPayload);
    if (created.error) throw new Error(`run_create_failed:${created.error.code}`);
    runCreated = true;
    const seeded = await client.from('ml_catalog_identity_audits').insert(manifest.decisions.map((row, ordinal) => ({
      run_id: manifest.run_id, ml_item_id: row.ml_item_id, ordinal, source_origin: 'delta_vivo',
      processing_state: 'pending', attempts: 0, input_row: row,
    })));
    if (seeded.error) throw new Error(`audit_seed_failed:${seeded.error.code}`);
    const applied = await client.rpc('apply_ml_catalog_identity_projection_batch', {
      p_run_id: manifest.run_id, p_actor_id: ACTOR.id, p_manifest_hash: manifest.manifest_hash,
      p_payloads: manifest.decisions.map(row => ({ ...row, action_reason: row.action_result })),
    });
    if (applied.error) throw new Error(`projection_failed:${applied.error.code || applied.error.message}`);
    const after = await client.rpc('ml_catalog_identity_safety_snapshot', { p_seller_id: SELLER_ID, p_item_ids: universe.ids });
    if (after.error) throw new Error(`after_snapshot_failed:${after.error.code}`);
    if (shared.stableJson(operationalSnapshot(before.data)) !== shared.stableJson(operationalSnapshot(after.data))) throw new Error('operational_invariant_changed');
    const afterCounts = await stateCounts(client);
    if (shared.stableJson(afterCounts) !== shared.stableJson(EXPECTED_AFTER)) throw new Error(`final_reconciliation_failed:${shared.stableJson(afterCounts)}`);
    const current = await shared.fetchByValues(client, 'ml_catalog_identity_current',
      'ml_item_id,identity_state,reason_code,block_price_write,block_buy_box_chase,ml_live_source_available,audit_id',
      'ml_item_id', manifest.decisions.map(row => row.ml_item_id));
    if (current.length !== 25 || current.some(row => row.identity_state !== 'SEM_CONFLITO' || row.block_price_write || row.block_buy_box_chase)) throw new Error('final_readback_invalid');
    const completed = await client.from('ml_catalog_identity_runs').update({ state: 'completed', finished_at: new Date().toISOString(),
      summary: { source: 'TITLE_DRIFT_REAUDIT_25', released: 25, final: EXPECTED_AFTER,
        price_changes: 0, stock_changes: 0, custom_price_changes: 0, produtos_ativo_changes: 0, relinks: 0 } })
      .eq('id', manifest.run_id).eq('state', 'applying').select('id').maybeSingle();
    if (completed.error || !completed.data) throw new Error('run_complete_failed');
    writeFinal(options.output, manifest, before.data, after.data, beforeCounts, afterCounts, current);
    return { run_id: manifest.run_id, released: 25, counts: afterCounts };
  } catch (error) {
    if (runCreated) await client.from('ml_catalog_identity_runs').update({ state: 'paused', finished_at: new Date().toISOString(),
      safety_stop: { code: String(error?.message || error).slice(0, 500), source: 'TITLE_DRIFT_REAUDIT_25' } }).eq('id', manifest.run_id).eq('state', 'applying');
    throw error;
  } finally {
    await releaseLocks(client, lock);
  }
}

function writeFinal(output, manifest, before, after, beforeCounts, afterCounts, current) {
  const currentById = new Map(current.map(row => [row.ml_item_id, row]));
  const rows = manifest.decisions.map(row => ({ sku: row.sku, ml_item_id: row.ml_item_id,
    catalog_product_id: row.catalog_product_id, identity_state_before: 'PENDENCIA_VALIDACAO',
    identity_state_after: currentById.get(row.ml_item_id)?.identity_state,
    block_price_write_before: true, block_price_write_after: currentById.get(row.ml_item_id)?.block_price_write,
    action: row.action, action_result: row.action_result, actor_id: ACTOR.id,
    content_quality_flag: row.content_quality_flag || '' }));
  fs.writeFileSync(path.join(output, ARTIFACTS[3]), csv(rows, ['sku','ml_item_id','catalog_product_id',
    'identity_state_before','identity_state_after','block_price_write_before','block_price_write_after',
    'action','action_result','actor_id','content_quality_flag']), { flag: 'wx' });
  const reconciliation = { total: 1550, before: beforeCounts, after: afterCounts,
    equation: '1550=1526+22+2', released: 25, blocked: 24, applied: true,
    invariants: { products: before.products.sha256 === after.products.sha256,
      listings: before.listings.sha256 === after.listings.sha256,
      relations: before.target_relations.sha256 === after.target_relations.sha256,
      outbox: before.outbox.sha256 === after.outbox.sha256 },
    price_changes: 0, stock_changes: 0, custom_price_changes: 0, produtos_ativo_changes: 0, relinks: 0 };
  fs.writeFileSync(path.join(output, ARTIFACTS[4]), `${shared.stableJson(reconciliation, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(output, ARTIFACTS[5]), [
    '# BNT-ML-CATALOG-IDENTITY-01 — fechamento final', '',
    `- Estado: CONCLUÍDA`, `- Ator: ${ACTOR.name} (${ACTOR.id})`,
    `- Run produtivo: ${manifest.run_id}`, `- Liberações executadas: 25`,
    `- Reconciliação: 1.550 = 1.526 SEM_CONFLITO + 22 CONFLITO_CONFIRMADO + 2 PENDENCIA_VALIDACAO`,
    `- Identidade bloqueada: 24`, `- Preços alterados: 0`, `- Estoques alterados: 0`,
    `- custom_price alterados: 0`, `- produtos.ativo alterados: 0`, `- Relinks executados: 0`,
    `- VTK000303: identidade liberada com TITLE_REVIEW_REQUIRED`,
    `- Readback e invariantes operacionais: APROVADOS`, '',
  ].join('\n'), { flag: 'wx' });
  writeChecksums(output);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const serviceUrl = process.env.SUPABASE_SERVICE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) throw new Error('supabase_service_environment_missing');
  const target = await shared.assertProductionTarget(serviceUrl);
  const client = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const universe = loadUniverse(path.resolve(options.universe));
  const token = await loadTokenReadOnly(client);
  const ml = shared.readonlyMl(token);
  const account = await ml.get('/users/me?attributes=id');
  if (!account.ok || Number(account.data?.id) !== SELLER_ID) throw new Error('ml_seller_invalid');
  if (options.mode === 'prepare') {
    const counts = await stateCounts(client);
    if (shared.stableJson(counts) !== shared.stableJson(EXPECTED_BEFORE)) throw new Error(`prepare_reconciliation_changed:${shared.stableJson(counts)}`);
    const manifest = await buildManifest(client, ml, universe);
    manifest.database_target = target;
    writePrepared(path.resolve(options.output), manifest);
    process.stdout.write(`${shared.stableJson({ event: 'identity_finalize_25_prepared', run_id: manifest.run_id,
      manifest_hash: manifest.manifest_hash, decisions: manifest.decisions.length, counts }, 2)}\n`);
    return;
  }
  const result = await apply(options, client, ml, universe);
  process.stdout.write(`${shared.stableJson({ event: 'identity_finalize_25_applied', ...result }, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${shared.stableJson({ event: 'identity_finalize_25_failed', error: String(error?.message || error) })}\n`);
  process.exitCode = 1;
});

module.exports = { ARTIFACTS, CASES, EXPECTED_AFTER, EXPECTED_BEFORE, NEW_CASES, manifestHash, parseArgs };
