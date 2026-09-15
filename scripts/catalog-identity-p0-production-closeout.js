#!/usr/bin/env node

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const shared = require('./catalog-identity-p0-executive-179.js');

const SELLER_ID = 3294514937;
const ACTOR_ID = '3e56ce48-f461-4784-848b-097d1e482a43';
const ACTOR_NAME = 'Rodrigo';
const ORDER_SHA = '6d98c995732dacd3884ca9c39c43aa24eafef03366ae70b34d0197e77aa9cbfe';
const PRIOR_AUDIT_SHA = 'eda059e01de3a465cbbc91bd0716cb2bf3ffd825454788fd21d643cc81d920ad';
const EXECUTIVE_AUDIT_SHA = 'f093690ec77432cfb05b9d0ad6b4ee60f34a57d2d55a31ef68738950a5d4c784';
const SOURCE_SHA = '59cdbbc17ae5d991a036b5fd4e0d584fa791f6747cab871b57424c220bc76d38';
const RELEASE_SOURCE = 'P0_AUDITORIA_EXECUTIVA_179';
const ORIGINAL_SOURCE = 'P0_DRY_RUN_1550_ORIGINAL';
const MANIFEST_TTL_MS = 30 * 60 * 1000;
const LOCK_TTL_SECONDS = 1800;
const LOCK_DOMAINS = [
  'produtos:dslite_catalogo',
  'produtos:dslite_preco',
  'anuncios:ml_pull',
  'anuncios:ml_push',
];
const REQUIRED_EXECUTIVE_ARTIFACTS = [
  '11_identity_reaudit_179.csv',
  '12_identity_release_155.json',
  '13_residual_pending_2.json',
  '14_relink_batch_01_before_after.json',
  '15_relink_batch_02_before_after.json',
  '16_relink_failures.json',
];
const APPROVED_TITLE_DRIFTS = Object.freeze({
  MLB7598571454: Object.freeze({
    sku: 'VTK020218',
    catalog_product_id: 'MLB7980691',
    expected_catalog_brand: 'intelbras',
    expected_catalog_model: 'ts 5150',
    family_tokens: Object.freeze(['telefone', '5150']),
    content_quality_flag: null,
  }),
  MLB5196468229: Object.freeze({
    sku: 'VTK020755',
    catalog_product_id: 'MLB24097960',
    expected_catalog_brand: 'mxt',
    expected_catalog_model: '125',
    family_tokens: Object.freeze(['hdmi', 'vga']),
    content_quality_flag: null,
  }),
  MLB5196875175: Object.freeze({
    sku: 'VTK018217',
    catalog_product_id: 'MLB62850998',
    expected_catalog_brand: 'code',
    expected_catalog_model: 'premium cromado chrome',
    family_tokens: Object.freeze(['sensor']),
    content_quality_flag: 'TITLE_REVIEW_REQUIRED',
  }),
});

function clean(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function parseJson(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return parsed == null ? fallback : parsed;
}

function bool(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function assertDatabaseCredentialGate() {
  if (process.env.SUPABASE_DB_URL) return { mode: 'SUPABASE_DB_URL' };
  const target = process.env.P0_SSH_DATABASE_TARGET || 'bentevi-supabase-prod';
  try {
    const hostname = childProcess.execFileSync('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', target, 'hostname',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    if (hostname !== 'supabase-dev') throw new Error('ssh_database_target_invalid');
    return { mode: 'SSH', target, hostname };
  } catch {
    throw new Error('BLOCKED_CREDENTIAL');
  }
}

function resolveLockOwnerToken(runId) {
  const supplied = clean(process.env.P0_LOCK_OWNER_TOKEN);
  if (!supplied) return `bnt-ml-catalog-identity-p0:${runId}:${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9:_-]{32,200}$/.test(supplied)) throw new Error('p0_lock_owner_token_invalid');
  return supplied;
}

function searchable(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function withoutTitles(snapshot) {
  return {
    ...snapshot,
    title: '',
    local_listing: { ...snapshot.local_listing, title: '' },
    catalog_snapshot: { ...snapshot.catalog_snapshot, title: '' },
  };
}

function materialAttributeValues(snapshot, attributeId) {
  const values = snapshot?.product_attributes?.[attributeId] || [];
  return searchable(Array.isArray(values) ? values.join(' ') : values);
}

function approvedTitleDriftFor({ row, prior, item, listing, snapshot, beforeMaterial, afterMaterial, sellerValid, catalogChanged }) {
  const rule = APPROVED_TITLE_DRIFTS[row.ml_item_id];
  if (!rule || row.audited_state !== 'SEM_CONFLITO') return { approved: false, rule: null };
  const previousEvidence = parseJson(prior.evidence);
  const previousListing = parseJson(prior.local_listing);
  const previousSnapshot = parseJson(prior.catalog_snapshot);
  const itemTitle = searchable(item.title);
  const nonTitleMaterialEqual = shared.stableJson(withoutTitles(beforeMaterial)) === shared.stableJson(withoutTitles(afterMaterial));
  const relationValid = row.sku === rule.sku
    && listing.sku === rule.sku
    && snapshot.seller_sku === rule.sku
    && row.catalog_product_id === rule.catalog_product_id
    && item.catalog_product_id === rule.catalog_product_id
    && snapshot.catalog_product_id === rule.catalog_product_id;
  const statusValid = item.status === (previousEvidence.ml_item?.status || 'active')
    && listing.status === previousListing.status
    && snapshot.status === previousSnapshot.status;
  const brandValid = materialAttributeValues(afterMaterial, 'BRAND').includes(rule.expected_catalog_brand);
  const modelValid = materialAttributeValues(afterMaterial, 'MODEL').includes(rule.expected_catalog_model);
  const familyValid = rule.family_tokens.every(token => itemTitle.includes(searchable(token)));
  const approved = nonTitleMaterialEqual && relationValid && statusValid && sellerValid && !catalogChanged
    && brandValid && modelValid && familyValid;
  return {
    approved,
    rule,
    checks: { non_title_material_equal: nonTitleMaterialEqual, relation_valid: relationValid, status_valid: statusValid,
      seller_valid: sellerValid, catalog_changed: catalogChanged, brand_valid: brandValid, model_valid: modelValid,
      family_valid: familyValid },
    titles: {
      ml_item_before: beforeMaterial.title,
      ml_item_after: afterMaterial.title,
      local_listing_before: beforeMaterial.local_listing.title,
      local_listing_after: afterMaterial.local_listing.title,
      catalog_snapshot_before: beforeMaterial.catalog_snapshot.title,
      catalog_snapshot_after: afterMaterial.catalog_snapshot.title,
    },
  };
}

function manifestHash(manifest) {
  return shared.sha256(shared.stableJson({
    version: manifest.version,
    run_id: manifest.run_id,
    generated_at: manifest.generated_at,
    expires_at: manifest.expires_at,
    order_sha256: manifest.order_sha256,
    source_sha256: manifest.source_sha256,
    prior_audit_sha256: manifest.prior_audit_sha256,
    executive_audit_sha256: manifest.executive_audit_sha256,
    seller_id: manifest.seller_id,
    actor: manifest.actor,
    release: manifest.release,
    decisions: manifest.decisions.map(decision => ({
      ml_item_id: decision.ml_item_id,
      sku: decision.sku,
      produto_id: decision.produto_id,
      standard_item_id: decision.standard_item_id,
      catalog_product_id: decision.catalog_product_id,
      identity_state: decision.identity_state,
      reason_code: decision.reason_code,
      material_fingerprint: decision.material_fingerprint,
      ml_live_source_available: decision.ml_live_source_available,
      pricing_eligible_by_identity: decision.pricing_eligible_by_identity,
      current_price: decision.current_price,
      available_quantity: decision.available_quantity,
      local_listing_price: decision.local_listing_price,
      produtos_ativo: decision.produtos_ativo,
      produtos_estoque: decision.produtos_estoque,
      produtos_custom_price: decision.produtos_custom_price,
      old_relation: decision.old_relation,
      new_relation: decision.new_relation,
      command_id: decision.command_id,
      population_source: decision.population_source,
      action: decision.action,
      action_result: decision.action_result,
      approved_title_drift: decision.evidence?.approved_title_drift || false,
      content_quality_flag: decision.evidence?.content_quality_flag || null,
    })),
  }));
}

function verifyFile(file, expectedHash, code) {
  const bytes = fs.readFileSync(file);
  const actual = shared.sha256(bytes);
  if (actual !== expectedHash) throw new Error(`${code}:${actual}`);
  return bytes;
}

function stateCounts(rows, field = 'identity_state') {
  const counts = {};
  for (const row of rows) counts[row[field]] = (counts[row[field]] || 0) + 1;
  return counts;
}

function loadCanonicalInputs({ priorDir, executiveDir, orderFile }) {
  verifyFile(orderFile, ORDER_SHA, 'order_sha_mismatch');
  const priorBytes = verifyFile(path.join(priorDir, '01_catalog_identity_audit.csv'), PRIOR_AUDIT_SHA, 'prior_audit_sha_mismatch');
  const executiveBytes = verifyFile(path.join(executiveDir, '11_identity_reaudit_179.csv'), EXECUTIVE_AUDIT_SHA, 'executive_audit_sha_mismatch');
  const priorRows = shared.parseCsv(priorBytes.toString('utf8'));
  const executiveRows = shared.parseCsv(executiveBytes.toString('utf8'));
  if (priorRows.length !== 1550 || new Set(priorRows.map(row => row.ml_item_id)).size !== 1550) throw new Error('prior_universe_invalid');
  if (new Set(priorRows.map(row => row.sku)).size !== 1549) throw new Error('prior_sku_cardinality_invalid');
  if (executiveRows.length !== 179 || new Set(executiveRows.map(row => row.ml_item_id)).size !== 179) throw new Error('executive_universe_invalid');
  const priorCounts = stateCounts(priorRows, 'identity_state_after');
  const executiveCounts = stateCounts(executiveRows);
  if (shared.stableJson(priorCounts) !== shared.stableJson({ SEM_CONFLITO: 1371, CONFLITO_CONFIRMADO: 21, PENDENCIA_VALIDACAO: 158 })) throw new Error('prior_counts_invalid');
  if (shared.stableJson(executiveCounts) !== shared.stableJson({ SEM_CONFLITO: 155, CONFLITO_CONFIRMADO: 22, PENDENCIA_VALIDACAO: 2 })) throw new Error('executive_counts_invalid');
  const priorById = new Map(priorRows.map(row => [row.ml_item_id, row]));
  if (executiveRows.some(row => !priorById.has(row.ml_item_id))) throw new Error('executive_item_outside_universe');
  const executiveById = new Map(executiveRows.map(row => [row.ml_item_id, row]));
  const audit = priorRows.map(prior => {
    const executive = executiveById.get(prior.ml_item_id);
    const auditedState = executive?.identity_state || prior.identity_state_after;
    const populationSource = executive ? RELEASE_SOURCE : ORIGINAL_SOURCE;
    return {
      sku: clean(prior.sku),
      ml_item_id: clean(prior.ml_item_id),
      catalog_product_id: clean(prior.catalog_product_id),
      standard_item_id: clean(prior.standard_item_id) || null,
      previous_state: clean(prior.identity_state_after),
      audited_state: auditedState,
      reason_code: clean(executive?.reason_code || prior.reason_code || (auditedState === 'SEM_CONFLITO' ? 'IDENTIDADE_COHERENTE_COM_DUAS_ANCORAS' : 'VALIDACAO_MANUAL_REQUERIDA')),
      risk_tier: clean(executive?.risk_tier || prior.risk_tier || 'MEDIO'),
      local_name: clean(parseJson(prior.local_product).nome),
      remote_title: clean(parseJson(prior.ml_readback).title || parseJson(prior.evidence).ml_item?.title),
      execution_action: auditedState === 'SEM_CONFLITO'
        ? (executive ? 'RELEASE_IDENTITY_GATE_AFTER_READBACK' : 'BACKFILL_ORIGINAL_CLEAR_PROJECTION')
        : auditedState === 'CONFLITO_CONFIRMADO' ? 'HOLD_BLOCKED_NO_SAFE_RELINK' : 'HOLD_MANUAL_EVIDENCE',
      pricing_eligible: auditedState === 'SEM_CONFLITO',
      notes: clean(executive?.error || ''),
      population_source: populationSource,
    };
  });
  const consolidated = stateCounts(audit, 'audited_state');
  if (shared.stableJson(consolidated) !== shared.stableJson({ SEM_CONFLITO: 1526, CONFLITO_CONFIRMADO: 22, PENDENCIA_VALIDACAO: 2 })) throw new Error('consolidated_counts_invalid');
  return { audit, priorRows, priorById, executiveRows, executiveById, executiveDir };
}

function decisionFromLive(row, prior, live, commandId) {
  const item = live.itemById.get(row.ml_item_id);
  const catalogProduct = live.productByCatalog.get(row.catalog_product_id);
  const listing = live.listingById.get(row.ml_item_id);
  const snapshot = live.snapshotById.get(row.ml_item_id);
  const localProduct = live.productById.get(listing?.produto_id);
  if (!item || !catalogProduct || !listing || !snapshot || !localProduct) throw new Error(`readback_coverage_invalid:${row.ml_item_id}`);
  const previousEvidence = parseJson(prior.evidence);
  const beforeMaterial = shared.materialSnapshot(previousEvidence.ml_item, previousEvidence.ml_catalog_product, {
    product: parseJson(prior.local_product),
    listing: parseJson(prior.local_listing),
    snapshot: parseJson(prior.catalog_snapshot),
  });
  const afterMaterial = shared.materialSnapshot(item, catalogProduct, { product: localProduct, listing, snapshot });
  const materialFingerprint = shared.sha256(shared.stableJson(afterMaterial));
  const materialChanged = shared.stableJson(beforeMaterial) !== shared.stableJson(afterMaterial);
  const sellerValid = Number(item.seller_id) === SELLER_ID && Number(snapshot.seller_id) === SELLER_ID;
  const catalogChanged = item.catalog_product_id !== row.catalog_product_id || snapshot.catalog_product_id !== row.catalog_product_id;
  const liveAvailable = Boolean(item && catalogProduct?.status === 'active');
  const approvedTitleDrift = approvedTitleDriftFor({
    row, prior, item, listing, snapshot, beforeMaterial, afterMaterial, sellerValid, catalogChanged,
  });
  let identityState = row.audited_state;
  let reasonCode = row.reason_code;
  let actionResult = identityState === 'SEM_CONFLITO' ? 'RELEASED_AFTER_READBACK'
    : identityState === 'CONFLITO_CONFIRMADO' ? 'BLOCKED_NO_SAFE_RELINK' : 'REQUIRES_CONFIRMATION';
  let error = null;
  if (!liveAvailable) {
    identityState = 'INCONCLUSIVO';
    reasonCode = 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL';
    actionResult = 'SOURCE_UNAVAILABLE';
    error = 'Fonte viva ML indisponível para decisão.';
  } else if ((!sellerValid || catalogChanged || materialChanged) && row.audited_state === 'SEM_CONFLITO' && !approvedTitleDrift.approved) {
    identityState = 'PENDENCIA_VALIDACAO';
    reasonCode = 'READBACK_MATERIAL_DRIFT';
    actionResult = 'DRIFT_BLOCKED_NEW';
    error = 'Deriva material detectada; projeção clara individual não aplicada.';
  } else if (materialChanged && approvedTitleDrift.approved) {
    reasonCode = 'READBACK_TITLE_DRIFT_EXECUTIVE_APPROVED';
    actionResult = 'RELEASED_AFTER_EXECUTIVE_TITLE_REVIEW';
  }
  const relation = item.item_relations?.[0]?.id || null;
  const oldRelation = {
    ml_item_id: row.ml_item_id,
    produto_id: listing.produto_id,
    sku: listing.sku,
    standard_item_id: relation,
    catalog_product_id: item.catalog_product_id,
  };
  const pricingEligible = identityState === 'SEM_CONFLITO' && liveAvailable;
  return {
    ...row,
    command_id: commandId,
    produto_id: listing.produto_id,
    seller_id: SELLER_ID,
    identity_state: identityState,
    reason_code: reasonCode,
    conflict_type: row.audited_state === 'CONFLITO_CONFIRMADO' ? row.reason_code : null,
    material_fingerprint: materialFingerprint,
    material_changed: materialChanged,
    ml_live_source_available: liveAvailable,
    pricing_eligible_by_identity: pricingEligible,
    observed_at: new Date().toISOString(),
    current_price: Number(item.price),
    available_quantity: Number(item.available_quantity),
    local_listing_price: Number(listing.preco_ml),
    produtos_ativo: localProduct.ativo,
    produtos_estoque: localProduct.estoque,
    produtos_custom_price: localProduct.custom_price,
    old_relation: oldRelation,
    new_relation: oldRelation,
    action: row.execution_action,
    action_result: actionResult,
    error,
    evidence: {
      source: 'ml_live',
      identity_release_source: row.population_source,
      order_sha256: ORDER_SHA,
      prior_audit_sha256: PRIOR_AUDIT_SHA,
      executive_audit_sha256: EXECUTIVE_AUDIT_SHA,
      before_material_fingerprint: shared.sha256(shared.stableJson(beforeMaterial)),
      material_fingerprint: materialFingerprint,
      material_changed: materialChanged,
      seller_valid: sellerValid,
      catalog_changed: catalogChanged,
      approved_title_drift: approvedTitleDrift.approved,
      approved_title_drift_checks: approvedTitleDrift.checks || null,
      approved_title_drift_titles: approvedTitleDrift.titles || null,
      content_quality_flag: approvedTitleDrift.rule?.content_quality_flag || null,
      item_last_updated: item.last_updated || null,
      snapshot_synced_at: snapshot.synced_at,
    },
    comparisons: parseJson(prior.comparisons, []),
    ml_readback: {
      item_id: item.id,
      seller_id: item.seller_id,
      status: item.status,
      title: item.title,
      price: item.price,
      available_quantity: item.available_quantity,
      catalog_product_id: item.catalog_product_id,
      seller_sku: snapshot.seller_sku,
      snapshot_status: snapshot.status,
      listing_status: listing.status,
      related_item_id: relation,
      observed_at: new Date().toISOString(),
    },
    rollback_plan: {
      strategy: 'append_blocking_audit_and_restore_current_projection',
      rollback_state: 'PENDENCIA_VALIDACAO',
      destructive_delete: false,
    },
  };
}

async function buildManifest(input, client, ml, release, existing = null) {
  const live = await shared.liveEvidence({ audit: input.audit, batch01: [], batch02: [] }, client, ml);
  const commandIds = existing ? new Map(existing.decisions.map(row => [row.ml_item_id, row.command_id])) : new Map();
  const decisions = input.audit.map(row => decisionFromLive(
    row,
    input.priorById.get(row.ml_item_id),
    live,
    commandIds.get(row.ml_item_id) || crypto.randomUUID(),
  ));
  const generatedAt = existing?.generated_at || new Date().toISOString();
  const manifest = {
    version: 'BNT-ML-CATALOG-IDENTITY-01/production-closeout-v2-title-microaudit',
    run_id: existing?.run_id || crypto.randomUUID(),
    generated_at: generatedAt,
    expires_at: existing?.expires_at || new Date(Date.parse(generatedAt) + MANIFEST_TTL_MS).toISOString(),
    order_sha256: ORDER_SHA,
    source_sha256: SOURCE_SHA,
    prior_audit_sha256: PRIOR_AUDIT_SHA,
    executive_audit_sha256: EXECUTIVE_AUDIT_SHA,
    seller_id: SELLER_ID,
    actor: { name: ACTOR_NAME, id: ACTOR_ID },
    release,
    readonly_stats: ml.stats(),
    decisions,
  };
  manifest.manifest_hash = manifestHash(manifest);
  return manifest;
}

function operationalSnapshot(snapshot) {
  return {
    products: snapshot?.products || null,
    listings: snapshot?.listings || null,
    target_relations: snapshot?.target_relations || null,
    outbox: snapshot?.outbox || null,
  };
}

function assertSystemicDrift(decisions) {
  const drift = decisions.filter(row => row.action_result?.startsWith('DRIFT_BLOCKED'));
  const sourceUnavailable = decisions.filter(row => row.action_result === 'SOURCE_UNAVAILABLE');
  if (sourceUnavailable.length) throw new Error(`STOP_BATCH:source_unavailable:${sourceUnavailable.length}`);
  for (const batch of shared.chunks(decisions, 25)) {
    const batchDrift = batch.filter(row => row.action_result?.startsWith('DRIFT_BLOCKED'));
    const signatures = Map.groupBy(batchDrift, row => `${row.evidence.catalog_changed}:${row.evidence.seller_valid}:${row.reason_code}`);
    if (batchDrift.length / batch.length > 0.05 || [...signatures.values()].some(rows => rows.length >= 2)) {
      throw new Error(`STOP_BATCH:systemic_drift:${batch[0].ml_item_id}`);
    }
  }
  return drift;
}

async function acquireLocks(client, runId) {
  const ownerToken = resolveLockOwnerToken(runId);
  const acquired = [];
  try {
    for (const domain of LOCK_DOMAINS) {
      const result = await client.rpc('acquire_sync_domain_lock', {
        p_domain: domain,
        p_owner_task: 'BNT-ML-CATALOG-IDENTITY-01',
        p_owner_token: ownerToken,
        p_owner_job_id: null,
        p_ttl_seconds: LOCK_TTL_SECONDS,
        p_metadata: { run_id: runId, actor_id: ACTOR_ID, purpose: 'identity_gate_only' },
      });
      if (result.error || !result.data) throw new Error(`STOP_BATCH:domain_lock_unavailable:${domain}`);
      acquired.push(domain);
    }
    return { ownerToken, domains: acquired };
  } catch (error) {
    await releaseLocks(client, { ownerToken, domains: acquired });
    throw error;
  }
}

async function refreshLocks(client, lock) {
  for (const domain of lock.domains) {
    const result = await client.rpc('acquire_sync_domain_lock', {
      p_domain: domain,
      p_owner_task: 'BNT-ML-CATALOG-IDENTITY-01',
      p_owner_token: lock.ownerToken,
      p_owner_job_id: null,
      p_ttl_seconds: LOCK_TTL_SECONDS,
      p_metadata: { actor_id: ACTOR_ID, purpose: 'identity_gate_only', heartbeat: true },
    });
    if (result.error || !result.data) throw new Error(`STOP_BATCH:domain_lock_lost:${domain}`);
  }
}

async function releaseLocks(client, lock) {
  if (!lock) return;
  for (const domain of [...lock.domains].reverse()) {
    await client.rpc('release_sync_domain_lock', {
      p_domain: domain,
      p_owner_token: lock.ownerToken,
      p_force: false,
    });
  }
}

async function safetySnapshot(client, itemIds) {
  const result = await client.rpc('ml_catalog_identity_safety_snapshot', {
    p_seller_id: SELLER_ID,
    p_item_ids: itemIds,
  });
  if (result.error || !result.data) throw new Error(`safety_snapshot_failed:${result.error?.code || 'empty'}`);
  return result.data;
}

function csvRows(decisions) {
  return decisions.map(row => ({
    sku: row.sku,
    ml_item_id: row.ml_item_id,
    produto_id: row.produto_id,
    catalog_product_id: row.catalog_product_id,
    standard_item_id: row.standard_item_id,
    population_source: row.population_source,
    identity_state_before: row.previous_state,
    identity_state_after: row.identity_state,
    action: row.action,
    action_result: row.action_result,
    pricing_eligible_by_identity: row.pricing_eligible_by_identity,
    economic_state: row.pricing_eligible_by_identity ? 'PENDENTE_VALIDACAO_INDIVIDUAL' : 'NAO_APLICAVEL_IDENTIDADE_BLOQUEADA',
    material_fingerprint: row.material_fingerprint,
    approved_title_drift: row.evidence?.approved_title_drift || false,
    content_quality_flag: row.evidence?.content_quality_flag || '',
    audit_id: row.audit_id || '',
    error: row.error || '',
  }));
}

function writeFinalArtifacts(outputDir, input, manifest, phase, details = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of REQUIRED_EXECUTIVE_ARTIFACTS) {
    fs.copyFileSync(path.join(input.executiveDir, name), path.join(outputDir, name));
  }
  const columns = [
    'sku','ml_item_id','produto_id','catalog_product_id','standard_item_id','population_source',
    'identity_state_before','identity_state_after','action','action_result',
    'pricing_eligible_by_identity','economic_state','material_fingerprint','approved_title_drift',
    'content_quality_flag','audit_id','error',
  ];
  const rows = csvRows(manifest.decisions.map(row => ({ ...row, audit_id: details.application?.[row.ml_item_id]?.audit_id })));
  shared.writeAtomic(path.join(outputDir, '17_pricing_eligibility_after_identity.csv'), shared.csv(rows, columns));
  shared.writeAtomic(path.join(outputDir, '21_identity_release_before_after.csv'), shared.csv(rows, columns));
  const blocked = rows.filter(row => !bool(row.pricing_eligible_by_identity));
  shared.writeAtomic(path.join(outputDir, '23_blocked_24_final.csv'), shared.csv(blocked, columns));
  const counts = stateCounts(manifest.decisions);
  const released = manifest.decisions.filter(row => row.pricing_eligible_by_identity).length;
  const drift = manifest.decisions.filter(row => row.action_result?.startsWith('DRIFT_BLOCKED')).length;
  const appliedPhase = phase === 'applied' || phase === 'applied_partial';
  const status = phase === 'applied' && released === 1526 && blocked.length === 24 && drift === 0
    ? 'CONCLUIDA' : phase === 'blocked_credential' ? 'BLOCKED_CREDENTIAL' : 'NAO_CONCLUIDA';
  const summary = [
    '# BNT-ML-CATALOG-IDENTITY-01 — fechamento produtivo P0', '',
    `- Estado: **${status}**`,
    `- Fase do artefato: ${phase}`,
    `- SHA da release isolada: \`${manifest.release.sha}\``,
    `- Base produtiva: \`${manifest.release.base_sha}\``,
    `- Video Factory incluída: NÃO`,
    `- Mudanças independentes incluídas: NÃO`,
    `- Escopo da release: BNT-ML-CATALOG-IDENTITY-01`,
    `- Ator: ${ACTOR_NAME} — \`${ACTOR_ID}\``,
    `- Releases executivos previstos: 155`,
    `- Backfill canônico previsto: 1.371`,
    `- Projeções claras aplicadas: ${appliedPhase ? released : 0}`,
    `- Releases bloqueados por deriva: ${drift}`,
    `- CONFLITO_CONFIRMADO: ${counts.CONFLITO_CONFIRMADO || 0}`,
    `- PENDENCIA_VALIDACAO: ${counts.PENDENCIA_VALIDACAO || 0}`,
    `- INCONCLUSIVO: ${counts.INCONCLUSIVO || 0}`,
    `- Total liberado no universo: ${appliedPhase ? released : 0} (esperado 1.526)`,
    `- Total bloqueado no universo: ${appliedPhase ? blocked.length : 1550} (esperado 24 após aplicação)`,
    `- Preços alterados: 0`,
    `- custom_price alterados: 0`,
    `- Estoques alterados: 0`,
    `- produtos.ativo alterados: 0`,
    `- Relinks executados: 0`,
    `- Repricing executado: 0`,
    `- Reconciliação final: ${status === 'CONCLUIDA' ? '1.550 = 1.526 + 24' : 'NÃO EXECUTADA/ACEITA'}`,
    `- Safety stop: ${details.safety_stop || 'nenhum'}`, '',
    phase === 'blocked_credential'
      ? 'A execução produtiva foi interrompida antes da primeira escrita porque não havia SUPABASE_DB_URL nem acesso SSH autenticado à .162.'
      : 'O gate de identidade não autoriza alteração econômica; todos os itens claros permanecem pendentes de validação econômica individual.',
    '',
  ];
  shared.writeAtomic(path.join(outputDir, '18_p0_final_closeout.md'), summary.join('\n'));
  const safety = {
    phase,
    status,
    actor: manifest.actor,
    release: manifest.release,
    before: details.before_snapshot || null,
    after: details.after_snapshot || null,
    operational_invariants_equal: details.operational_invariants_equal ?? null,
    price_changes: 0,
    custom_price_changes: 0,
    stock_changes: 0,
    produtos_ativo_changes: 0,
    relinks: 0,
    repricing: 0,
    safety_stop: details.safety_stop || null,
    database_credential: details.database_credential || null,
  };
  shared.writeAtomic(path.join(outputDir, '22_production_safety_checks.json'), `${shared.stableJson(safety, 2)}\n`);
  const titleMicroaudit = manifest.decisions
    .filter(row => APPROVED_TITLE_DRIFTS[row.ml_item_id])
    .map(row => ({
      sku: row.sku,
      ml_item_id: row.ml_item_id,
      catalog_product_id: row.catalog_product_id,
      title_before: row.evidence?.approved_title_drift_titles?.ml_item_before || '',
      title_current: row.evidence?.approved_title_drift_titles?.ml_item_after || row.ml_readback?.title || '',
      seller_sku: row.ml_readback?.seller_sku || '',
      status: row.ml_readback?.status || '',
      evidence: shared.stableJson(row.evidence?.approved_title_drift_checks || {}),
      decision: row.identity_state,
      action_result: row.action_result,
      content_quality_flag: row.evidence?.content_quality_flag || '',
    }));
  shared.writeAtomic(path.join(outputDir, '25_title_drift_microaudit_3.csv'), shared.csv(titleMicroaudit, [
    'sku','ml_item_id','catalog_product_id','title_before','title_current','seller_sku','status','evidence',
    'decision','action_result','content_quality_flag',
  ]));
  const reconciliation = {
    expected: { total: 1550, sem_conflito: 1526, conflito_confirmado: 22, pendencia_validacao: 2, blocked: 24 },
    actual: { total: manifest.decisions.length, sem_conflito: counts.SEM_CONFLITO || 0,
      conflito_confirmado: counts.CONFLITO_CONFIRMADO || 0, pendencia_validacao: counts.PENDENCIA_VALIDACAO || 0,
      inconclusivo: counts.INCONCLUSIVO || 0, clear: appliedPhase ? released : 0,
      blocked: appliedPhase ? blocked.length : manifest.decisions.length, drift },
    equation: status === 'CONCLUIDA' ? '1550=1526+22+2' : null,
    status,
  };
  shared.writeAtomic(path.join(outputDir, '26_final_identity_reconciliation.json'), `${shared.stableJson(reconciliation, 2)}\n`);
  shared.writeAtomic(path.join(outputDir, '27_production_readback_final.csv'), shared.csv(rows, columns));
  const execution = {
    ...manifest,
    phase,
    status,
    expected: { total: 1550, clear: 1526, blocked: 24, executive_releases: 155, original_backfill: 1371 },
    actual: { clear: appliedPhase ? released : 0, blocked: appliedPhase ? blocked.length : 1550, drift },
    migrations: details.migrations || [],
    application: details.application || {},
    safety_checks: safety,
    secrets_included: false,
  };
  shared.writeAtomic(path.join(outputDir, '24_production_execution_manifest.json'), `${shared.stableJson(execution, 2)}\n`);
  const artifactNames = fs.readdirSync(outputDir).filter(name => name !== 'SHA256SUMS.txt').sort();
  const sums = artifactNames.map(name => `${shared.sha256(fs.readFileSync(path.join(outputDir, name)))}  ${name}`).join('\n');
  shared.writeAtomic(path.join(outputDir, 'SHA256SUMS.txt'), `${sums}\n`);
}

async function applyManifest(input, manifest, client, ml, outputDir) {
  const databaseCredential = assertDatabaseCredentialGate();
  if (process.env.P0_ACTOR_ID !== ACTOR_ID) throw new Error('p0_actor_rodrigo_required');
  const actor = await client.from('profiles').select('id,cargo').eq('id', ACTOR_ID).maybeSingle();
  if (actor.error || actor.data?.cargo !== 'admin') throw new Error('p0_actor_admin_required');
  if (Date.parse(manifest.expires_at) <= Date.now()) throw new Error('prepared_manifest_expired');
  let lock = null;
  let heartbeat = null;
  let heartbeatError = null;
  let beforeSnapshot = null;
  const application = {};
  try {
    lock = await acquireLocks(client, manifest.run_id);
    heartbeat = setInterval(() => refreshLocks(client, lock).catch(error => { heartbeatError = error; }), 5 * 60 * 1000);
    beforeSnapshot = await safetySnapshot(client, manifest.decisions.map(row => row.ml_item_id));
    const fresh = await buildManifest(input, client, ml, manifest.release, manifest);
    if (fresh.manifest_hash !== manifest.manifest_hash) throw new Error(`prepared_manifest_changed:${fresh.manifest_hash}`);
    const drift = assertSystemicDrift(fresh.decisions);
    const projectedClear = fresh.decisions.filter(row => row.pricing_eligible_by_identity).length;
    const projectedBlocked = fresh.decisions.length - projectedClear;
    if (projectedClear + projectedBlocked !== 1550) throw new Error('RECONCILIATION_PRECHECK_FAILED:scope');
    if (heartbeatError) throw heartbeatError;
    const runPayload = {
      id: manifest.run_id,
      state: 'applying',
      mode: 'apply',
      rule_version: manifest.version,
      baseline_filename: '01_catalog_identity_audit.csv+11_identity_reaudit_179.csv',
      baseline_sha256: manifest.source_sha256,
      baseline_count: 1550,
      delta_count: 179,
      total_count: 1550,
      manifest_hash: manifest.manifest_hash,
      approved_manifest_hash: manifest.manifest_hash,
      snapshot_at: manifest.generated_at,
      started_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      created_by: ACTOR_ID,
      approved_by: ACTOR_ID,
      summary: { source: RELEASE_SOURCE, original_backfill: 1371, executive_releases: 155, blocked: 24, drift: drift.length },
    };
    const existing = await client.from('ml_catalog_identity_runs').select('id,state,manifest_hash').eq('id', manifest.run_id).maybeSingle();
    if (existing.error) throw new Error(`run_read_failed:${existing.error.code}`);
    if (!existing.data) {
      const created = await client.from('ml_catalog_identity_runs').insert(runPayload);
      if (created.error) throw new Error(`run_create_failed:${created.error.code}`);
    } else if (existing.data.manifest_hash !== manifest.manifest_hash || !['applying','completed'].includes(existing.data.state)) {
      throw new Error('run_replay_conflict');
    }
    for (const batch of shared.chunks(fresh.decisions, 100)) {
      const seeded = await client.from('ml_catalog_identity_audits').upsert(batch.map(row => ({
        run_id: manifest.run_id,
        ml_item_id: row.ml_item_id,
        ordinal: fresh.decisions.indexOf(row),
        source_origin: row.population_source === ORIGINAL_SOURCE ? 'baseline' : 'ambos',
        processing_state: 'pending',
        attempts: 0,
        input_row: row,
      })), { onConflict: 'run_id,ml_item_id', ignoreDuplicates: true });
      if (seeded.error) throw new Error(`audit_seed_failed:${seeded.error.code}`);
    }
    for (const batch of shared.chunks(fresh.decisions, 25)) {
      if (heartbeatError) throw heartbeatError;
      const result = await client.rpc('apply_ml_catalog_identity_projection_batch', {
        p_run_id: manifest.run_id,
        p_actor_id: ACTOR_ID,
        p_manifest_hash: manifest.manifest_hash,
        p_payloads: batch.map(row => ({ ...row, action_reason: row.action_result })),
      });
      if (result.error) throw new Error(`projection_batch_failed:${batch[0].ml_item_id}:${result.error.code || result.error.message}`);
      for (const entry of result.data || []) application[entry.ml_item_id] = entry.result;
    }
    const postReadback = await buildManifest(input, client, ml, manifest.release, manifest);
    if (postReadback.manifest_hash !== manifest.manifest_hash) throw new Error(`post_readback_changed:${postReadback.manifest_hash}`);
    const afterSnapshot = await safetySnapshot(client, manifest.decisions.map(row => row.ml_item_id));
    const invariantsEqual = shared.stableJson(operationalSnapshot(beforeSnapshot)) === shared.stableJson(operationalSnapshot(afterSnapshot));
    if (!invariantsEqual) throw new Error('STOP_BATCH:operational_invariant_changed');
    const current = await shared.fetchByValues(client, 'ml_catalog_identity_current',
      'seller_id,ml_item_id,identity_state,block_price_write,block_buy_box_chase,ml_live_source_available,audit_id',
      'ml_item_id', manifest.decisions.map(row => row.ml_item_id));
    const clear = current.filter(row => row.seller_id === SELLER_ID && row.identity_state === 'SEM_CONFLITO' && !row.block_price_write).length;
    const blocked = current.filter(row => row.seller_id === SELLER_ID && row.block_price_write).length;
    if (current.length !== 1550 || clear !== 1526 || blocked !== 24 || drift.length !== 0) {
      const code = `RECONCILIATION_FAILED:${current.length}:${clear}:${blocked}:${drift.length}`;
      writeFinalArtifacts(outputDir, input, manifest, 'applied_partial', {
        application,
        before_snapshot: beforeSnapshot,
        after_snapshot: afterSnapshot,
        operational_invariants_equal: true,
        safety_stop: code,
        database_credential: databaseCredential,
        migrations: ['20260915050000_bnt_ml_catalog_identity_179_apply', '20260915110000_bnt_ml_catalog_identity_p0_closeout'],
      });
      throw new Error(code);
    }
    const completed = await client.from('ml_catalog_identity_runs').update({
      state: 'completed',
      finished_at: new Date().toISOString(),
      summary: { total: 1550, sem_conflito: 1526, conflito_confirmado: 22, pendencia_validacao: 2,
        clear, blocked, price_changes: 0, stock_changes: 0, produtos_ativo_changes: 0, relinks: 0 },
    }).eq('id', manifest.run_id).eq('state', 'applying').select('id').maybeSingle();
    if (completed.error || !completed.data) throw new Error(`run_complete_failed:${completed.error?.code || 'state_changed'}`);
    writeFinalArtifacts(outputDir, input, manifest, 'applied', {
      application,
      before_snapshot: beforeSnapshot,
      after_snapshot: afterSnapshot,
      operational_invariants_equal: true,
      migrations: ['20260915050000_bnt_ml_catalog_identity_179_apply', '20260915110000_bnt_ml_catalog_identity_p0_closeout'],
      database_credential: databaseCredential,
    });
  } catch (error) {
    await client.from('ml_catalog_identity_runs').update({
      state: 'paused',
      finished_at: new Date().toISOString(),
      safety_stop: { code: String(error?.message || error).slice(0, 500), source: RELEASE_SOURCE },
    }).eq('id', manifest.run_id).eq('state', 'applying');
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseLocks(client, lock);
  }
}

function parseArgs(argv) {
  const args = { mode: argv[0] };
  for (let index = 1; index < argv.length; index += 2) args[argv[index]?.replace(/^--/, '')] = argv[index + 1];
  const required = ['prior-dir','executive-dir','order','output-dir','release-sha','release-base'];
  if (!['prepare','apply'].includes(args.mode) || required.some(key => !args[key])) {
    throw new Error('usage: prepare|apply --prior-dir DIR --executive-dir DIR --order FILE --output-dir DIR --release-sha SHA --release-base SHA [--manifest FILE]');
  }
  if (!/^[0-9a-f]{40}$/.test(args['release-sha']) || !/^[0-9a-f]{40}$/.test(args['release-base'])) throw new Error('release_sha_invalid');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serviceUrl = process.env.SUPABASE_SERVICE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) throw new Error('supabase_service_environment_missing');
  const databaseTarget = await shared.assertProductionTarget(serviceUrl);
  const client = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const input = loadCanonicalInputs({
    priorDir: path.resolve(args['prior-dir']),
    executiveDir: path.resolve(args['executive-dir']),
    orderFile: path.resolve(args.order),
  });
  const token = await shared.loadToken(client);
  const ml = shared.readonlyMl(token);
  const release = {
    sha: args['release-sha'],
    base_sha: args['release-base'],
    scope: 'BNT-ML-CATALOG-IDENTITY-01',
    video_factory_included: false,
    independent_changes_included: false,
  };
  if (args.mode === 'prepare') {
    const manifest = await buildManifest(input, client, ml, release);
    manifest.database_target = databaseTarget;
    let databaseCredential = null;
    let phase = 'prepared';
    try {
      databaseCredential = assertDatabaseCredentialGate();
    } catch {
      phase = 'blocked_credential';
    }
    writeFinalArtifacts(path.resolve(args['output-dir']), input, manifest, phase, {
      safety_stop: phase === 'blocked_credential' ? 'BLOCKED_CREDENTIAL' : null,
      database_credential: databaseCredential,
    });
    console.log(shared.stableJson({ event: 'p0_production_closeout_prepared', phase, run_id: manifest.run_id,
      manifest_hash: manifest.manifest_hash, decisions: manifest.decisions.length, readonly_stats: manifest.readonly_stats }, 2));
    return;
  }
  const manifestPath = path.resolve(args.manifest || path.join(args['output-dir'], '24_production_execution_manifest.json'));
  const wrapper = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifest = { ...wrapper };
  for (const key of ['phase','status','expected','actual','migrations','application','safety_checks','secrets_included']) delete manifest[key];
  if (manifest.manifest_hash !== manifestHash(manifest)) throw new Error('prepared_manifest_hash_invalid');
  await applyManifest(input, manifest, client, ml, path.resolve(args['output-dir']));
  console.log(shared.stableJson({ event: 'p0_production_closeout_applied', run_id: manifest.run_id,
    manifest_hash: manifest.manifest_hash, reconciliation: '1550=1526+24' }, 2));
}

if (require.main === module) main().catch(error => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});

module.exports = {
  ACTOR_ID,
  APPROVED_TITLE_DRIFTS,
  LOCK_DOMAINS,
  approvedTitleDriftFor,
  assertDatabaseCredentialGate,
  decisionFromLive,
  loadCanonicalInputs,
  manifestHash,
  operationalSnapshot,
  parseArgs,
  resolveLockOwnerToken,
  stateCounts,
};
