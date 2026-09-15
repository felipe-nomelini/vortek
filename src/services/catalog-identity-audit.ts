import { createHash, randomUUID } from 'node:crypto';
import { buildMlItemsBulkPath, getMlItemsBulkBody } from '@/lib/ml/items-bulk';
import { assessCatalogIdentity, catalogIdentityFingerprint, CATALOG_IDENTITY_RULE_VERSION } from '@/lib/catalog-identity';
import { parseCatalogIdentityBaseline } from '@/lib/catalog-identity-import';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';

const JOB_TYPE = 'ml_catalog_identity_audit';
const BATCH_SIZE = 20;
const WRITE_BATCH_SIZE = 200;
const catalogProductCache = new Map<string, { ok: boolean; data: any | null; error: string | null }>();

type ServiceClient = ReturnType<typeof createServiceClient>;
type AuditRow = {
  id: number;
  run_id: string;
  ml_item_id: string;
  ordinal: number;
  source_origin: 'baseline' | 'delta_vivo' | 'ambos';
  seller_id: number | null;
  produto_id: string | null;
  sku: string | null;
  ml_item_id_related: string | null;
  catalog_product_id: string | null;
  input_row: Record<string, unknown>;
  old_relation: Record<string, unknown>;
  old_price: number | null;
};

const now = () => new Date().toISOString();
const chunks = <T>(rows: T[], size: number) => Array.from(
  { length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size),
);

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'unknown_error');
  return message.replace(/(?:token|secret|authorization|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]').slice(0, 500);
}

async function loadAllCatalogSnapshots(client: ServiceClient) {
  const all: any[] = [];
  let cursor = '';
  for (;;) {
    let query: any = client.from('catalogo_ml_snapshot').select(
      'ml_item_id,seller_id,produto_id,sku_local,seller_sku,related_item_id,catalog_product_id,status,price,price_to_win,buy_box_status,title,last_updated_ml,synced_at',
    ).eq('catalog_listing', true).eq('status', 'active').order('ml_item_id', { ascending: true }).limit(500);
    if (cursor) query = query.gt('ml_item_id', cursor);
    const result = await query;
    if (result.error) throw new Error('catalog_identity_snapshot_read_failed');
    const rows = result.data || [];
    all.push(...rows);
    if (rows.length < 500) break;
    cursor = String(rows.at(-1).ml_item_id);
  }
  return all;
}

async function loadRunRows(client: ServiceClient, runId: string) {
  const all: any[] = [];
  let from = 0;
  for (;;) {
    const result = await (client.from('ml_catalog_identity_audits' as any) as any)
      .select('id,ml_item_id,ordinal,input_row,source_origin')
      .eq('run_id', runId).order('ordinal', { ascending: true }).range(from, from + 499);
    if (result.error) throw new Error('catalog_identity_manifest_read_failed');
    const rows = result.data || [];
    all.push(...rows);
    if (rows.length < 500) break;
    from += rows.length;
  }
  return all;
}

export async function createCatalogIdentityRun(input: {
  actorId: string;
  fileName: string;
  bytes: Uint8Array;
}) {
  const client = createServiceClient();
  const buffer = Buffer.from(input.bytes);
  const baseline = await parseCatalogIdentityBaseline(input.fileName, buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const inserted = await (client.from('ml_catalog_identity_runs' as any) as any).insert({
    state: 'imported', mode: 'dry_run', rule_version: CATALOG_IDENTITY_RULE_VERSION,
    baseline_filename: input.fileName.slice(0, 240), baseline_sha256: sha256,
    baseline_count: baseline.length, total_count: baseline.length, created_by: input.actorId,
  }).select('id,state,baseline_count,baseline_sha256,created_at').single();
  if (inserted.error || !inserted.data?.id) throw new Error('catalog_identity_run_create_failed');
  try {
    for (const batch of chunks(baseline, WRITE_BATCH_SIZE)) {
      const offset = baseline.indexOf(batch[0]);
      const result = await (client.from('ml_catalog_identity_audits' as any) as any).insert(batch.map((row, index) => ({
        run_id: inserted.data.id, ml_item_id: row.mlItemId, ordinal: offset + index,
        source_origin: 'baseline', input_row: row.inputRow,
      })));
      if (result.error) throw new Error('catalog_identity_manifest_write_failed');
    }
  } catch (error) {
    await (client.from('ml_catalog_identity_runs' as any) as any).update({
      state: 'failed', finished_at: now(), summary: { error: safeError(error) },
    }).eq('id', inserted.data.id);
    throw error;
  }
  return inserted.data;
}

export async function startCatalogIdentityDryRun(input: { runId: string; actorId: string }) {
  const client = createServiceClient();
  const existing = await (client.from('ml_catalog_identity_runs' as any) as any)
    .select('*').eq('id', input.runId).single();
  if (existing.error || !existing.data) throw new Error('catalog_identity_run_missing');
  if (!['imported','paused','failed'].includes(existing.data.state)) throw new Error('catalog_identity_run_state_invalid');
  if (existing.data.baseline_count !== 1_550) throw new Error('catalog_identity_baseline_invalid');

  if (existing.data.state === 'paused' && existing.data.job_id) {
    await (client.from('ml_catalog_identity_audits' as any) as any).update({
      processing_state: 'pending', error: null, finished_at: null, updated_at: now(),
    }).eq('run_id', input.runId).in('processing_state', ['processing','failed']).lt('attempts', 3);
    await (client.from('ml_catalog_identity_runs' as any) as any).update({
      state: 'queued', safety_stop: null, updated_at: now(),
    }).eq('id', input.runId).eq('state', 'paused');
    await (client.from('jobs') as any).update({ status: 'pendente', finished_at: null })
      .eq('id', existing.data.job_id).eq('tipo', JOB_TYPE);
    setTimeout(() => {
      void runCatalogIdentityAuditBatch(input.runId).catch(error => {
        void markCatalogIdentityRunFailure(input.runId, error);
      });
    }, 0);
    return { runId: input.runId, jobId: existing.data.job_id,
      total: existing.data.total_count, delta: existing.data.delta_count, resumed: true };
  }

  const [manifest, snapshots] = await Promise.all([loadRunRows(client, input.runId), loadAllCatalogSnapshots(client)]);
  const baseline = new Map(manifest.map(row => [String(row.ml_item_id), row]));
  const snapshot = new Map(snapshots.map(row => [String(row.ml_item_id), row]));
  const union = [...new Set([...baseline.keys(), ...snapshot.keys()])].sort();
  const prepared = union.map((mlItemId, ordinal) => {
    const base = baseline.get(mlItemId);
    const live = snapshot.get(mlItemId);
    return {
      run_id: input.runId,
      ml_item_id: mlItemId,
      ordinal,
      source_origin: base && live ? 'ambos' : base ? 'baseline' : 'delta_vivo',
      input_row: base?.input_row || {},
      processing_state: 'pending', attempts: 0, error: null, identity_state: null,
      seller_id: live?.seller_id || null, produto_id: live?.produto_id || null,
      sku: live?.sku_local || live?.seller_sku || null,
      ml_item_id_related: live?.related_item_id || null,
      catalog_product_id: live?.catalog_product_id || null,
      old_relation: { produto_id: live?.produto_id || null, sku: live?.sku_local || null,
        related_item_id: live?.related_item_id || null, catalog_product_id: live?.catalog_product_id || null },
      old_price: live?.price == null ? null : Number(live.price),
      pricing_source: 'mercado_livre',
    };
  });
  for (const batch of chunks(prepared, WRITE_BATCH_SIZE)) {
    const result = await (client.from('ml_catalog_identity_audits' as any) as any)
      .upsert(batch, { onConflict: 'run_id,ml_item_id' });
    if (result.error) throw new Error('catalog_identity_manifest_prepare_failed');
  }
  const job = await (client.from('jobs') as any).insert({
    tipo: JOB_TYPE, status: 'pendente', progresso: 0, total: union.length, processados: 0,
    unidade_progresso: 'itens', log: [], created_by: input.actorId, dedupe_key: input.runId,
  }).select('id').single();
  if (job.error || !job.data?.id) throw new Error('catalog_identity_job_create_failed');
  const updated = await (client.from('ml_catalog_identity_runs' as any) as any).update({
    job_id: job.data.id, state: 'queued', snapshot_at: now(), started_at: null, finished_at: null,
    approved_at: null, approved_by: null, approved_manifest_hash: null, manifest_hash: null,
    delta_count: union.length - baseline.size, total_count: union.length, safety_stop: null,
    summary: { baseline: baseline.size, delta_vivo: union.length - baseline.size, total: union.length },
    updated_at: now(),
  }).eq('id', input.runId);
  if (updated.error) throw new Error('catalog_identity_run_start_failed');
  setTimeout(() => {
    void runCatalogIdentityAuditBatch(input.runId).catch(error => {
      void markCatalogIdentityRunFailure(input.runId, error);
    });
  }, 0);
  return { runId: input.runId, jobId: job.data.id, total: union.length, delta: union.length - baseline.size };
}

async function fetchCatalogProduct(catalogProductId: string) {
  const existing = catalogProductCache.get(catalogProductId);
  if (existing) return existing;
  const response = await fetchMLResult<any>(`/products/${encodeURIComponent(catalogProductId)}`);
  const value = response.ok && String(response.data?.id || '') === catalogProductId
    ? { ok: true, data: response.data, error: null }
    : { ok: false, data: null, error: response.error?.code || 'catalog_product_unavailable' };
  catalogProductCache.set(catalogProductId, value);
  return value;
}

function sanitizedItem(item: any) {
  if (!item) return null;
  return {
    id: item.id, name: item.name, seller_id: item.seller_id, title: item.title, status: item.status,
    catalog_listing: item.catalog_listing, catalog_product_id: item.catalog_product_id,
    category_id: item.category_id, domain_id: item.domain_id,
    seller_custom_field: item.seller_custom_field, item_relations: item.item_relations,
    attributes: Array.isArray(item.attributes) ? item.attributes.map((attribute: any) => ({
      id: attribute.id, value_id: attribute.value_id, value_name: attribute.value_name,
      values: attribute.values,
    })) : [],
    price: item.price, last_updated: item.last_updated,
  };
}

async function finalizeRun(client: ServiceClient, run: any) {
  const rows = await loadRunRows(client, run.id);
  const full = await (client.from('ml_catalog_identity_audits' as any) as any)
    .select('ml_item_id,identity_state,risk_tier,action,proposed_relation,material_fingerprint,error')
    .eq('run_id', run.id).order('ordinal', { ascending: true }).limit(10_000);
  if (full.error) throw new Error('catalog_identity_summary_read_failed');
  const audited = full.data || [];
  const count = (state: string) => audited.filter((row: any) => row.identity_state === state).length;
  const failures = audited.filter((row: any) => row.error).length;
  const manifestHash = catalogIdentityFingerprint(audited.map((row: any) => ({
    ml_item_id: row.ml_item_id, identity_state: row.identity_state, risk_tier: row.risk_tier,
    action: row.action, proposed_relation: row.proposed_relation, material_fingerprint: row.material_fingerprint,
  })));
  const summary = {
    total: rows.length,
    sem_conflito: count('SEM_CONFLITO'),
    conflito_confirmado: count('CONFLITO_CONFIRMADO'),
    pendencia_validacao: count('PENDENCIA_VALIDACAO'),
    inconclusivo: count('INCONCLUSIVO'),
    liberados_pricing: count('SEM_CONFLITO'),
    bloqueados_pricing: rows.length - count('SEM_CONFLITO'),
    errors: failures,
    price_changes: 0,
    produtos_ativo_changes: 0,
  };
  await (client.from('ml_catalog_identity_runs' as any) as any).update({
    state: 'awaiting_approval', manifest_hash: manifestHash, summary,
    finished_at: now(), updated_at: now(),
  }).eq('id', run.id);
  if (run.job_id) await (client.from('jobs') as any).update({
    status: failures ? 'completo_parcial' : 'completo', progresso: 100,
    processados: rows.length, total: rows.length,
    log: [{ event_type: 'catalog_identity_audit_completed', timestamp: now(), summary }],
    finished_at: now(),
  }).eq('id', run.job_id);
  return summary;
}

async function stopRun(client: ServiceClient, run: any, safetyStop: Record<string, unknown>) {
  await (client.from('ml_catalog_identity_runs' as any) as any).update({
    state: 'paused', safety_stop: safetyStop, updated_at: now(),
  }).eq('id', run.id);
  if (run.job_id) await (client.from('jobs') as any).update({
    status: 'on_hold',
    log: [{ event_type: 'catalog_identity_safety_stop', timestamp: now(), safety_stop: safetyStop }],
    finished_at: null,
  }).eq('id', run.job_id);
}

export async function runCatalogIdentityAuditBatch(runId: string) {
  const client = createServiceClient();
  const runResult = await (client.from('ml_catalog_identity_runs' as any) as any)
    .select('*').eq('id', runId).single();
  if (runResult.error || !runResult.data) throw new Error('catalog_identity_run_missing');
  const run = runResult.data;
  if (!['queued','running'].includes(run.state)) return { state: run.state };
  if (run.state === 'queued') await (client.from('ml_catalog_identity_runs' as any) as any)
    .update({ state: 'running', started_at: now(), updated_at: now() }).eq('id', runId).eq('state', 'queued');

  const claimed = await client.rpc('claim_ml_catalog_identity_audit_batch' as any, { p_run_id: runId, p_limit: BATCH_SIZE });
  if (claimed.error) throw new Error('catalog_identity_batch_claim_failed');
  const audits = (claimed.data || []) as unknown as AuditRow[];
  if (!audits.length) return { state: 'awaiting_approval', summary: await finalizeRun(client, run) };

  const itemIds = audits.map(row => row.ml_item_id);
  const itemResult = await fetchMLResult<any[]>(buildMlItemsBulkPath(itemIds, [
    'seller_id','title','status','price','catalog_listing','catalog_product_id','category_id','domain_id',
    'item_relations','attributes','seller_custom_field','last_updated',
  ]));
  const itemById = new Map<string, any>();
  if (itemResult.ok && Array.isArray(itemResult.data)) {
    for (const row of itemResult.data) {
      const item = getMlItemsBulkBody<any>(row);
      if (item) itemById.set(item.id, item);
    }
  }
  const relatedIds = uniqueStrings(audits.flatMap(audit => {
    const item = itemById.get(audit.ml_item_id);
    return [audit.ml_item_id_related, ...(Array.isArray(item?.item_relations) ? item.item_relations.map((relation: any) => relation?.id) : [])];
  }));
  const listingIds = uniqueStrings([...itemIds, ...relatedIds]);
  const listings = listingIds.length ? await (client.from('anuncios_ml') as any)
    .select('ml_item_id,produto_id,sku,status').in('ml_item_id', listingIds) : { data: [], error: null };
  if (listings.error) throw new Error('catalog_identity_local_listing_read_failed');
  const groupMembers = itemIds.length ? await (client.from('ml_pricing_group_members') as any)
    .select('ml_item_id,group_id').in('ml_item_id', itemIds).eq('is_current', true) : { data: [], error: null };
  if (groupMembers.error) throw new Error('catalog_identity_pricing_group_read_failed');
  const listingById = new Map<string, any>((listings.data || []).map((row: any) => [String(row.ml_item_id), row]));
  const groupByItemId = new Map<string, string>((groupMembers.data || [])
    .map((row: any) => [String(row.ml_item_id), String(row.group_id)]));
  const ownerIds = uniqueStrings(audits.flatMap(audit => [
    audit.produto_id, listingById.get(audit.ml_item_id)?.produto_id,
    listingById.get(audit.ml_item_id_related || '')?.produto_id,
  ]));
  const candidateSkus = uniqueStrings(audits.flatMap(audit => {
    const item = itemById.get(audit.ml_item_id);
    const related = listingById.get(audit.ml_item_id_related || '');
    return [audit.sku, related?.sku, item?.seller_custom_field];
  })).map(value => value.toUpperCase());
  const [productsByIdResult, productsBySkuResult] = await Promise.all([
    ownerIds.length ? (client.from('produtos') as any).select('id,sku,nome,descricao,marca,gtin,ativo,updated_at').in('id', ownerIds) : Promise.resolve({ data: [], error: null }),
    candidateSkus.length ? (client.from('produtos') as any).select('id,sku,nome,descricao,marca,gtin,ativo,updated_at').in('sku', candidateSkus) : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsByIdResult.error || productsBySkuResult.error) throw new Error('catalog_identity_product_read_failed');
  const products = new Map<string, any>();
  const productBySku = new Map<string, any>();
  for (const product of [...(productsByIdResult.data || []), ...(productsBySkuResult.data || [])]) {
    products.set(String(product.id), product);
    productBySku.set(String(product.sku || '').trim().toUpperCase(), product);
  }

  const priceResults = new Map<string, any>();
  for (const group of chunks(itemIds, 5)) {
    const results = await Promise.all(group.map(async itemId => [itemId,
      await fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}/price_to_win?version=v2`)] as const));
    results.forEach(([itemId, result]) => priceResults.set(itemId, result));
  }
  const updates: any[] = [];
  const currentRows: any[] = [];
  let mlErrors = 0;
  let authFatal = false;
  for (const audit of audits) {
    const item = itemById.get(audit.ml_item_id) || null;
    const priceResult = priceResults.get(audit.ml_item_id);
    const catalogProductId = String(item?.catalog_product_id || audit.catalog_product_id || '').trim();
    const catalogResult = catalogProductId ? await fetchCatalogProduct(catalogProductId) : { ok: false, data: null, error: 'catalog_product_id_missing' };
    const priceStatus = String(priceResult?.data?.status || priceResult?.data?.buy_box_status || '').trim();
    const liveAvailable = Boolean(item && catalogProductId && catalogResult.ok && priceResult?.ok && priceStatus);
    if (!liveAvailable) mlErrors += 1;
    if ([itemResult.error?.category, priceResult?.error?.category].includes('auth_fatal')) authFatal = true;
    const direct = listingById.get(audit.ml_item_id);
    const relatedId = String(item?.item_relations?.[0]?.id || audit.ml_item_id_related || '').trim();
    const related = listingById.get(relatedId);
    const owners = uniqueStrings([audit.produto_id, direct?.produto_id, related?.produto_id]);
    const currentProduct = products.get(String(audit.produto_id || direct?.produto_id || related?.produto_id || '')) || null;
    const candidateSku = String(related?.sku || item?.seller_custom_field || audit.sku || '').trim().toUpperCase();
    const skuCandidate = productBySku.get(candidateSku) || null;
    const baseAssessment = assessCatalogIdentity({
      item, catalogProduct: catalogResult.data, localProduct: currentProduct, relatedListing: related || direct,
      localOwners: owners, priceToWin: priceResult?.data?.price_to_win ?? null,
      currentPrice: item?.price ?? audit.old_price, liveAvailable,
    });
    const candidateAssessment = skuCandidate && skuCandidate.id !== currentProduct?.id && owners.length <= 1
      ? assessCatalogIdentity({ item, catalogProduct: catalogResult.data, localProduct: skuCandidate,
          relatedListing: related || direct, localOwners: [skuCandidate.id],
          priceToWin: priceResult?.data?.price_to_win ?? null, currentPrice: item?.price ?? audit.old_price, liveAvailable })
      : null;
    const selectedAssessment = candidateAssessment?.identityState === 'SEM_CONFLITO' ? candidateAssessment : baseAssessment;
    const selectedProduct = candidateAssessment?.identityState === 'SEM_CONFLITO' ? skuCandidate : currentProduct;
    const pricingGroupId = groupByItemId.get(audit.ml_item_id) || null;
    const action = candidateAssessment?.identityState === 'SEM_CONFLITO' ? 'FIX_LOCAL_LINK'
      : selectedAssessment.identityState === 'SEM_CONFLITO' ? 'NO_ACTION' : 'MANUAL_REVIEW';
    const fingerprint = catalogIdentityFingerprint({ item: sanitizedItem(item), catalogProduct: sanitizedItem(catalogResult.data),
      product: selectedProduct, owners, related, pricing_group_id: pricingGroupId, price_status: priceStatus });
    const observedAt = now();
    const error = liveAvailable ? null : [itemResult.error?.code, catalogResult.error, priceResult?.error?.code,
      priceStatus ? null : 'competition_state_unavailable'].filter(Boolean).join(',');
    const sellerId = Number(item?.seller_id || audit.seller_id || 0) || null;
    updates.push({
      id: audit.id, seller_id: sellerId, produto_id: selectedProduct?.id || currentProduct?.id || null,
      sku: selectedProduct?.sku || candidateSku || audit.sku || null, ml_item_id_related: relatedId || null,
      catalog_product_id: catalogProductId || null, pricing_group_id: pricingGroupId,
      identity_state: selectedAssessment.identityState,
      reason_code: selectedAssessment.reasonCode, conflict_type: selectedAssessment.conflictType,
      risk_tier: selectedAssessment.riskTier, gap_pct: selectedAssessment.gapPct,
      material_fingerprint: fingerprint, ml_live_source_available: liveAvailable,
      block_price_write: selectedAssessment.blockPriceWrite, block_buy_box_chase: selectedAssessment.blockBuyBoxChase,
      produtos_ativo_before: currentProduct?.ativo ?? selectedProduct?.ativo ?? null,
      produtos_ativo_after: currentProduct?.ativo ?? selectedProduct?.ativo ?? null,
      proposed_relation: action === 'FIX_LOCAL_LINK' ? { produto_id: skuCandidate.id, sku: skuCandidate.sku,
        proof: 'seller_sku_and_material_identity' } : {},
      evidence: { source: 'ml_live', observed_at: observedAt, item: sanitizedItem(item),
        catalog_product: sanitizedItem(catalogResult.data), competition: priceResult?.ok ? priceResult.data : null,
        local_owners: owners, selected_product_id: selectedProduct?.id || null,
        pricing_group_id: pricingGroupId },
      comparisons: selectedAssessment.comparisons, old_price: item?.price ?? audit.old_price,
      new_price: item?.price ?? audit.old_price, action,
      action_result: action === 'MANUAL_REVIEW' ? 'REQUIRES_CONFIRMATION' : action === 'FIX_LOCAL_LINK' ? 'PLANNED' : 'NO_CHANGE',
      ml_readback: item ? { item_id: item.id, seller_id: item.seller_id, catalog_product_id: item.catalog_product_id,
        status: item.status, price: item.price, observed_at: observedAt } : null,
      processing_state: 'processed', error: error || null, finished_at: observedAt, updated_at: observedAt,
    });
    if (sellerId) currentRows.push({
      seller_id: sellerId, ml_item_id: audit.ml_item_id, audit_id: audit.id,
      identity_state: selectedAssessment.identityState, reason_code: selectedAssessment.reasonCode,
      material_fingerprint: fingerprint, ml_live_source_available: liveAvailable,
      block_price_write: selectedAssessment.blockPriceWrite, block_buy_box_chase: selectedAssessment.blockBuyBoxChase,
      observed_at: observedAt, updated_at: observedAt,
    });
  }
  const auditWrite = await (client.from('ml_catalog_identity_audits' as any) as any).upsert(updates, { onConflict: 'id' });
  if (auditWrite.error) throw new Error('catalog_identity_audit_write_failed');
  if (currentRows.length) {
    const currentWrite = await (client.from('ml_catalog_identity_current' as any) as any)
      .upsert(currentRows, { onConflict: 'seller_id,ml_item_id' });
    if (currentWrite.error) throw new Error('catalog_identity_current_write_failed');
  }
  const errorRate = audits.length ? mlErrors / audits.length : 0;
  if (authFatal || errorRate > 0.05) {
    const safetyStop = { code: authFatal ? 'ML_AUTHENTICATION_FAILURE' : 'ML_ERROR_RATE_EXCEEDED',
      batch_size: audits.length, ml_errors: mlErrors, error_rate: errorRate, stopped_at: now() };
    await stopRun(client, run, safetyStop);
    return { state: 'paused', safetyStop };
  }
  const processed = await (client.from('ml_catalog_identity_audits' as any) as any)
    .select('id', { count: 'exact', head: true }).eq('run_id', runId).eq('processing_state', 'processed');
  const processedCount = Number(processed.count || 0);
  if (run.job_id) await (client.from('jobs') as any).update({
    status: 'on_hold', processados: processedCount, total: run.total_count,
    progresso: Math.floor((processedCount / Math.max(1, run.total_count)) * 100),
  }).eq('id', run.job_id);
  setTimeout(() => {
    void runCatalogIdentityAuditBatch(runId).catch(error => {
      void markCatalogIdentityRunFailure(runId, error);
    });
  }, 250);
  return { state: 'running', processed: processedCount, total: run.total_count };
}

export async function markCatalogIdentityRunFailure(runId: string, error: unknown) {
  const client = createServiceClient();
  const message = safeError(error);
  await (client.from('ml_catalog_identity_audits' as any) as any).update({
    processing_state: 'failed', error: message, finished_at: now(), updated_at: now(),
  }).eq('run_id', runId).eq('processing_state', 'processing');
  const run = await (client.from('ml_catalog_identity_runs' as any) as any)
    .select('job_id').eq('id', runId).maybeSingle();
  await (client.from('ml_catalog_identity_runs' as any) as any).update({
    state: 'paused', safety_stop: { code: 'INTERNAL_BATCH_FAILURE', error: message, stopped_at: now() },
    updated_at: now(),
  }).eq('id', runId).in('state', ['queued','running']);
  if (run.data?.job_id) await (client.from('jobs') as any).update({
    status: 'on_hold',
    log: [{ event_type: 'catalog_identity_internal_failure', timestamp: now(), error: message }],
    finished_at: null,
  }).eq('id', run.data.job_id);
  console.error('[catalog-identity-audit] Lote pausado:', message);
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

export async function approveCatalogIdentityRun(input: {
  runId: string;
  actorId: string;
  manifestHash: string;
  reason: string;
}) {
  const client = createServiceClient();
  const run = await (client.from('ml_catalog_identity_runs' as any) as any)
    .select('id,state,manifest_hash,summary').eq('id', input.runId).single();
  if (run.error || !run.data) throw new Error('catalog_identity_run_missing');
  if (run.data.state !== 'awaiting_approval' || run.data.manifest_hash !== input.manifestHash)
    throw new Error('catalog_identity_manifest_changed');
  const result = await (client.from('ml_catalog_identity_runs' as any) as any).update({
    state: 'approved', approved_manifest_hash: input.manifestHash, approved_by: input.actorId,
    approved_at: now(), updated_at: now(), summary: { ...(run.data.summary || {}), approval_reason: input.reason },
  }).eq('id', input.runId).eq('state', 'awaiting_approval').eq('manifest_hash', input.manifestHash);
  if (result.error) throw new Error('catalog_identity_approval_failed');
  return { runId: input.runId, state: 'approved', manifestHash: input.manifestHash };
}

export async function recordCatalogIdentityManualDecision(input: {
  auditId: number;
  actorId: string;
  commandId?: string;
  actionType: 'NO_ACTION' | 'FIX_LOCAL_LINK' | 'CREATE_CORRECT_CATALOG_LISTING' | 'PAUSE_WRONG_CATALOG_LISTING' | 'MANUAL_REVIEW';
  reason: string;
}) {
  const client = createServiceClient();
  const audit = await (client.from('ml_catalog_identity_audits' as any) as any)
    .select('id,run_id,material_fingerprint,old_relation,proposed_relation').eq('id', input.auditId).single();
  if (audit.error || !audit.data?.material_fingerprint) throw new Error('catalog_identity_audit_missing');
  const run = await (client.from('ml_catalog_identity_runs' as any) as any)
    .select('state,manifest_hash,approved_manifest_hash').eq('id', audit.data.run_id).single();
  if (run.error || run.data?.state !== 'approved'
    || !run.data.manifest_hash || run.data.manifest_hash !== run.data.approved_manifest_hash) {
    throw new Error('catalog_identity_run_not_approved');
  }
  const remote = ['CREATE_CORRECT_CATALOG_LISTING','PAUSE_WRONG_CATALOG_LISTING'].includes(input.actionType);
  if (remote) {
    const profile = await client.from('profiles').select('cargo').eq('id', input.actorId).single();
    if (profile.error || profile.data?.cargo !== 'admin') throw new Error('catalog_identity_remote_admin_required');
  }
  const commandId = input.commandId || randomUUID();
  const result = await (client.from('ml_catalog_identity_actions' as any) as any).insert({
    audit_id: input.auditId, command_id: commandId, action_type: input.actionType,
    state: remote ? 'requires_confirmation' : 'planned', expected_fingerprint: audit.data.material_fingerprint,
    actor_id: input.actorId, reason: input.reason,
    before_state: audit.data.old_relation || {}, after_state: audit.data.proposed_relation || {},
    rollback_plan: remote ? { strategy: 'manual_forward_repair_after_readback' }
      : { strategy: 'restore_before_state', relation: audit.data.old_relation || {} },
  }).select('id,state').single();
  if (result.error?.code === '23505') {
    const replay = await (client.from('ml_catalog_identity_actions' as any) as any)
      .select('id,state,audit_id,action_type,reason').eq('command_id', commandId).single();
    if (!replay.error && replay.data?.audit_id === input.auditId && replay.data?.action_type === input.actionType
      && replay.data?.reason === input.reason) return { id: replay.data.id, state: replay.data.state, replayed: true };
    throw new Error('catalog_identity_decision_idempotency_conflict');
  }
  if (result.error) throw new Error('catalog_identity_decision_write_failed');
  return result.data;
}
