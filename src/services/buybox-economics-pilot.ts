import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase';
import { choosePreferredOffer } from '@/lib/preferred-offer';
import { fetchMLResult } from '@/services/integration';
import { loadPricingDetail } from '@/services/pricing-detail';
import { loadPricingOverrides } from '@/services/pricing-overrides';
import { persistProductMlGroups, resolveProductMlLinks } from '@/services/ml-listing-links';
import { enqueueApprovedPricingDecision, dispatchApprovedPricingOperation } from '@/services/pricing-dispatch';

export const BUYBOX_PILOT_CODE = 'BNT-ML-BUYBOX-ECONOMICS-01';
export const BUYBOX_PILOT_ACTOR_ID = '3e56ce48-f461-4784-848b-097d1e482a43';
export const BUYBOX_PILOT_MANIFEST_SHA256 = '891559359ee5c63cc7e05d1279ccfbd20ec64ea49f7ab57275cbc2c529140b60';
export const BUYBOX_PILOT_SCREENING_SHA256 = '9251741d53768fc84aca337115d2bcc2f6878967db88461ab4dd7f8f0f110199';

const finalStates = [
  'SKIP_ALREADY_WINNING', 'BUY_BOX_ECONOMICAMENTE_ATACAVEL', 'BUY_BOX_ATACAVEL_COM_OTIMIZACAO',
  'CONFLITO_ECONOMICO_DE_BUY_BOX', 'BLOQUEADO_DADO_ECONOMICO', 'DRIFT_BLOCKED',
  'UPDATED_OK', 'FAILED_WRITE', 'FAILED_READBACK', 'ROLLED_BACK',
] as const;
export type BuyBoxPilotState = typeof finalStates[number];

const manifestRowSchema = z.object({
  sku: z.string().regex(/^VTK\d{6}$/),
  ml_item_id: z.string().regex(/^MLB\d+$/),
  current_price_snapshot: z.number().positive(),
  price_to_win_snapshot: z.number().positive(),
  cmv_snapshot: z.number().positive(),
  ml_fee_rate_snapshot: z.number().min(0).max(1),
  ml_shipping_snapshot: z.number().min(0),
  stock_snapshot: z.number().int().min(0),
  qty_sold_90d: z.number().int().min(0),
  canonical_floor_rate: z.union([z.literal(0.05), z.literal(0.07), z.literal(0.1)]),
  pretax_margin_at_ptw: z.number(),
  max_tax_rate_at_floor: z.number(),
  recommended_price_if_all_live_gates_pass: z.number().positive(),
  state: z.literal('PREQUALIFIED_PENDING_LIVE_TAX_AND_REFRESH'),
}).strict();

type ManifestRow = z.infer<typeof manifestRowSchema>;
type Client = ReturnType<typeof createServiceClient>;

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function cents(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const result = Math.round(parsed * 100);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function sellerSku(item: any): string {
  return String(item?.seller_custom_field
    || item?.attributes?.find((attribute: any) => attribute?.id === 'SELLER_SKU')?.value_name
    || '').trim();
}

function forbiddenSnapshot(product: any, listing: any, snapshot: any) {
  return {
    produtoId: product?.id ?? null,
    ativo: product?.ativo ?? null,
    estoque: product?.estoque ?? null,
    customPrice: product?.custom_price ?? null,
    preferredOfferId: product?.oferta_preferencial_id ?? null,
    preferredManual: product?.fornecedor_preferencial_manual ?? null,
    listingProductId: listing?.produto_id ?? null,
    listingStatus: listing?.status ?? null,
    listingCatalog: listing?.catalogo ?? null,
    catalogProductId: snapshot?.catalog_product_id ?? null,
  };
}

function stable(value: unknown) {
  return JSON.stringify(value, Object.keys((value && typeof value === 'object' ? value : {}) as object).sort());
}

async function getBatchItem(client: Client, runId: string, itemId: string) {
  const found = await (client as any).from('pricing_batch_items').select('*,run:pricing_batch_runs(*)')
    .eq('run_id', runId).eq('ml_item_id', itemId).maybeSingle();
  if (found.error || !found.data) throw new Error('buybox_pilot_item_not_found');
  if (found.data.run?.code !== BUYBOX_PILOT_CODE
    || found.data.run?.manifest_sha256 !== BUYBOX_PILOT_MANIFEST_SHA256
    || found.data.run?.actor_id !== BUYBOX_PILOT_ACTOR_ID) throw new Error('buybox_pilot_scope_invalid');
  return found.data as any;
}

async function updateBatchItem(client: Client, id: string, values: Record<string, unknown>) {
  const saved = await (client as any).from('pricing_batch_items').update({
    ...values, updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (saved.error) throw new Error('buybox_pilot_item_persist_failed');
}

function screeningPairs(buffer: Buffer) {
  const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length !== 16) throw new Error('buybox_pilot_screening_row_count_invalid');
  const headers = lines[0].split(',');
  const skuIndex = headers.indexOf('sku');
  const itemIndex = headers.indexOf('ml_item_id');
  if (skuIndex < 0 || itemIndex < 0) throw new Error('buybox_pilot_screening_header_invalid');
  return new Set(lines.slice(1).map(line => {
    const cells = line.split(',');
    return `${cells[skuIndex]}:${cells[itemIndex]}`;
  }));
}

export async function initializeBuyBoxPilot(input: {
  actorId: string;
  manifestBase64: string;
  screeningBase64: string;
}) {
  if (input.actorId !== BUYBOX_PILOT_ACTOR_ID) throw new Error('buybox_pilot_actor_invalid');
  const manifestBuffer = Buffer.from(input.manifestBase64, 'base64');
  const screeningBuffer = Buffer.from(input.screeningBase64, 'base64');
  if (sha256(manifestBuffer) !== BUYBOX_PILOT_MANIFEST_SHA256
    || sha256(screeningBuffer) !== BUYBOX_PILOT_SCREENING_SHA256) throw new Error('buybox_pilot_checksum_invalid');
  const manifest = z.array(manifestRowSchema).length(15).parse(JSON.parse(manifestBuffer.toString('utf8')));
  const pairs = screeningPairs(screeningBuffer);
  if (new Set(manifest.map(row => row.ml_item_id)).size !== 15
    || new Set(manifest.map(row => row.sku)).size !== 15
    || manifest.some(row => !pairs.has(`${row.sku}:${row.ml_item_id}`))) throw new Error('buybox_pilot_manifest_scope_invalid');

  const client = createServiceClient();
  const actor = await client.from('profiles').select('id,nome,cargo').eq('id', input.actorId).maybeSingle();
  if (actor.error || !actor.data || actor.data.cargo !== 'admin' || actor.data.nome !== 'Rodrigo') {
    throw new Error('buybox_pilot_actor_invalid');
  }
  const existing = await (client as any).from('pricing_batch_runs').select('id,state')
    .eq('code', BUYBOX_PILOT_CODE).eq('manifest_sha256', BUYBOX_PILOT_MANIFEST_SHA256).maybeSingle();
  if (existing.error) throw new Error('buybox_pilot_run_read_failed');
  if (existing.data) return { runId: existing.data.id, state: existing.data.state, replayed: true };
  const created = await (client as any).from('pricing_batch_runs').insert({
    code: BUYBOX_PILOT_CODE,
    manifest_sha256: BUYBOX_PILOT_MANIFEST_SHA256,
    screening_sha256: BUYBOX_PILOT_SCREENING_SHA256,
    actor_id: input.actorId,
    state: 'prepared',
    manifest,
  }).select('id,state').single();
  if (created.error || !created.data) throw new Error('buybox_pilot_run_create_failed');
  const items = await (client as any).from('pricing_batch_items').insert(manifest.map((row, index) => ({
    run_id: created.data.id,
    sku: row.sku,
    ml_item_id: row.ml_item_id,
    sequence: index + 1,
  })));
  if (items.error) throw new Error('buybox_pilot_items_create_failed');
  return { runId: created.data.id, state: created.data.state, replayed: false };
}

async function liveLocalContext(client: Client, row: ManifestRow) {
  const product = await client.from('produtos').select('*').eq('sku', row.sku).maybeSingle();
  const listing = await client.from('anuncios_ml').select('*').eq('ml_item_id', row.ml_item_id).maybeSingle();
  const snapshot = await client.from('catalogo_ml_snapshot').select('*').eq('ml_item_id', row.ml_item_id).maybeSingle();
  const identity = await (client as any).from('ml_catalog_identity_current').select('*')
    .eq('ml_item_id', row.ml_item_id).maybeSingle();
  if (product.error || listing.error || snapshot.error || identity.error) throw new Error('buybox_pilot_local_read_failed');
  return { product: product.data, listing: listing.data, snapshot: snapshot.data, identity: identity.data };
}

async function ensureGroup(client: Client, product: any, sellerId: number, itemId: string) {
  let protection = await loadPricingOverrides(client, product.id);
  let group = protection.groups.find(candidate => candidate.state === 'verified'
    && candidate.members.some(member => member.itemId === itemId)) || null;
  if (!group) {
    const resolved = await resolveProductMlLinks(client as any, product, sellerId);
    if (resolved.coverage === 'complete') {
      await persistProductMlGroups(client as any, product.id, sellerId, resolved, new Date().toISOString());
      protection = await loadPricingOverrides(client, product.id);
      group = protection.groups.find(candidate => candidate.state === 'verified'
        && candidate.members.some(member => member.itemId === itemId)) || null;
    }
  }
  return { protection, group };
}

export async function evaluateBuyBoxPilotItem(runId: string, itemId: string) {
  const client = createServiceClient();
  const batchItem = await getBatchItem(client, runId, itemId);
  const manifestRow = manifestRowSchema.parse(batchItem.run.manifest.find((row: any) => row.ml_item_id === itemId));
  const local = await liveLocalContext(client, manifestRow);
  const before = forbiddenSnapshot(local.product, local.listing, local.snapshot);
  const finish = async (state: BuyBoxPilotState, decision: Record<string, unknown>, evaluationId?: string | null) => {
    await updateBatchItem(client, batchItem.id, {
      final_state: state, decision, before_snapshot: before, evaluation_id: evaluationId ?? null,
      evaluated_at: new Date().toISOString(), error: null,
    });
    return { runId, batchItemId: batchItem.id, sku: batchItem.sku, mlItemId: itemId,
      qtySold90d: manifestRow.qty_sold_90d, stock: Number(local.product?.estoque || 0), state, decision, before, evaluationId: evaluationId ?? null };
  };
  if (!local.product || !local.listing || !local.snapshot || !local.identity
    || local.listing.produto_id !== local.product.id || local.snapshot.produto_id !== local.product.id
    || local.identity.produto_id !== local.product.id || local.identity.identity_state !== 'SEM_CONFLITO'
    || local.identity.block_price_write === true || local.product.ativo !== true) {
    return finish('DRIFT_BLOCKED', { reason: 'IDENTIDADE_LOCAL_DIVERGENTE' });
  }
  const product = local.product;
  const [remote, competition, account, offers] = await Promise.all([
    fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}?include_attributes=all`),
    fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}/price_to_win?siteId=MLB&version=v2`),
    fetchMLResult<any>('/users/me'),
    client.from('produto_fornecedor_ofertas').select('*').eq('produto_id', product.id),
  ]);
  if (!remote.ok || !competition.ok || !account.ok || offers.error) {
    return finish('BLOQUEADO_DADO_ECONOMICO', { reason: 'FONTE_VIVA_INDISPONIVEL' });
  }
  const currentPriceCents = cents(remote.data?.price);
  const priceToWinCents = cents(competition.data?.price_to_win);
  const remoteCatalogId = String(remote.data?.catalog_product_id || '');
  const expectedCatalogId = String(local.snapshot.catalog_product_id || '');
  if (remote.data?.id !== itemId || sellerSku(remote.data) !== manifestRow.sku
    || remoteCatalogId !== expectedCatalogId || String(competition.data?.item_id || '') !== itemId
    || competition.data?.consistent !== true || cents(competition.data?.current_price) !== currentPriceCents) {
    return finish('DRIFT_BLOCKED', { reason: 'READBACK_MATERIAL_DIVERGENTE' });
  }
  const status = String(competition.data?.status || '');
  const winning = status === 'winning' || (status === 'sharing_first_place'
    && (competition.data?.buy_box_winning === true
      || competition.data?.winner?.item_id === itemId || competition.data?.winner?.id === itemId));
  if (winning) return finish('SKIP_ALREADY_WINNING', { reason: 'ANUNCIO_JA_VENCEDOR', currentPriceCents, priceToWinCents, status });
  if (status !== 'competing' || !currentPriceCents || !priceToWinCents) {
    return finish('BLOQUEADO_DADO_ECONOMICO', { reason: 'COMPETICAO_NAO_ELEGIVEL', currentPriceCents, priceToWinCents, status });
  }
  if (priceToWinCents >= currentPriceCents) {
    return finish('BUY_BOX_ECONOMICAMENTE_ATACAVEL', { reason: 'PRECO_JA_NO_LIMITE', currentPriceCents, priceToWinCents, status, writeApproved: false });
  }
  const eligibleOffers = (offers.data || []).filter((offer: any) => offer.ativo !== false
    && Number(offer.estoque || 0) > 0 && Number(offer.custo || 0) > 0);
  const selected = choosePreferredOffer(eligibleOffers);
  const preferred = eligibleOffers.find((offer: any) => offer.id === product.oferta_preferencial_id) || null;
  if (!selected) return finish('BLOQUEADO_DADO_ECONOMICO', { reason: 'OFERTA_ATIVA_COM_ESTOQUE_AUSENTE', currentPriceCents, priceToWinCents, status });
  if (!preferred || selected.id !== preferred.id) {
    return finish('BUY_BOX_ATACAVEL_COM_OTIMIZACAO', { reason: 'MELHOR_OFERTA_EXIGE_REVISAO_DE_PREFERENCIA',
      currentPriceCents, priceToWinCents, status, supplierBefore: preferred?.dslite_fornecedor_id ?? null,
      supplierSelected: selected.dslite_fornecedor_id ?? null, costBefore: preferred?.custo ?? null, costSelected: selected.custo });
  }
  const sellerId = Number(account.data?.id);
  if (!Number.isSafeInteger(sellerId) || sellerId <= 0 || Number(remote.data?.seller_id) !== sellerId) {
    return finish('DRIFT_BLOCKED', { reason: 'CONTA_ML_DIVERGENTE' });
  }
  let groupResult: Awaited<ReturnType<typeof ensureGroup>>;
  try { groupResult = await ensureGroup(client, product, sellerId, itemId); }
  catch { return finish('BLOQUEADO_DADO_ECONOMICO', { reason: 'GRUPO_PRICING_INCONCLUSIVO', currentPriceCents, priceToWinCents, status }); }
  if (!groupResult.group || groupResult.group.protection || groupResult.group.inFlight) {
    return finish('BLOQUEADO_DADO_ECONOMICO', { reason: groupResult.group?.protection ? 'OVERRIDE_MANUAL_ATIVO' : 'GRUPO_PRICING_INCONCLUSIVO',
      currentPriceCents, priceToWinCents, status });
  }
  const response = await loadPricingDetail({
    produtoId: product.id,
    mlItemId: itemId,
    priceCents: priceToWinCents,
  }, {
    actorId: BUYBOX_PILOT_ACTOR_ID,
    competitionItemId: itemId,
    targetOrigin: 'price_to_win',
    strictEconomicGates: true,
  });
  const detail = await response.json();
  if (!response.ok || !detail?.decisionContext || !detail?.pricing) {
    return finish('BLOQUEADO_DADO_ECONOMICO', { reason: detail?.code || 'AVALIACAO_ECONOMICA_INDISPONIVEL', currentPriceCents, priceToWinCents, status });
  }
  const memory = detail.pricing.current?.memory;
  const floor = detail.pricing.floor;
  const tax = memory?.tax;
  const liveSources = memory?.fee?.source === 'ml_live' && memory?.shipping?.source === 'ml_live';
  const taxUsable = tax?.context?.appliedRate != null && ['estimated', 'confirmed'].includes(tax?.status)
    && tax?.context?.manualRequired !== true;
  const marginBelowFloor = memory && memory.margin < memory.band.floor;
  const economicDecision = {
    currentPriceCents,
    priceToWinCents,
    status,
    supplierBefore: preferred.dslite_fornecedor_id ?? null,
    supplierSelected: selected.dslite_fornecedor_id ?? null,
    costBefore: Number(preferred.custo),
    costSelected: Number(selected.custo),
    stockSupplier: Number(selected.estoque),
    paymentMode: selected.payment_mode,
    lastSyncAt: selected.last_sync_at,
    offerId: selected.id,
    groupId: groupResult.group.id,
    groupVersion: groupResult.group.version,
    costCents: memory?.cost?.amountCents ?? null,
    feeCents: memory?.fee?.amountCents ?? null,
    feeRate: memory ? memory.fee.amountCents / priceToWinCents : null,
    shippingCents: memory?.shipping?.amountCents ?? null,
    taxRate: tax?.context?.appliedRate ?? null,
    taxSource: tax?.context?.source ?? null,
    taxStatus: tax?.status ?? null,
    rbt12Reference: tax?.context?.rbt12 ?? null,
    calculatedAt: memory?.evaluatedAt ?? null,
    floorRate: memory?.band?.floor ?? null,
    floorPriceCents: floor?.ok ? floor.priceCents : null,
    resultAtPriceToWinCents: memory?.resultCents ?? null,
    marginAtPriceToWin: memory?.margin ?? null,
    marginBefore: detail.pricing.comparisons?.actual?.memory?.margin ?? null,
    decisionReasons: detail.decisionContext.reasons || [],
    writeApproved: detail.decisionContext.executable === true && liveSources && taxUsable && !marginBelowFloor,
  };
  if (marginBelowFloor || detail.competitiveAssessment?.buyBoxConflict === true) {
    return finish('CONFLITO_ECONOMICO_DE_BUY_BOX', { ...economicDecision, reason: 'PRECO_VIVO_ABAIXO_DO_PISO' }, detail.evaluationId);
  }
  if (!economicDecision.writeApproved) {
    return finish('BLOQUEADO_DADO_ECONOMICO', { ...economicDecision, reason: !liveSources ? 'TARIFA_OU_FRETE_NAO_VIVO'
      : !taxUsable ? 'TRIBUTO_INDISPONIVEL' : 'GATE_ECONOMICO_NAO_APROVADO' }, detail.evaluationId);
  }
  return finish('BUY_BOX_ECONOMICAMENTE_ATACAVEL', economicDecision, detail.evaluationId);
}

async function createExperiment(client: Client, batchItem: any, operation: any, evaluation: any, readback: any) {
  const memory = evaluation.result?.current?.memory;
  const actual = evaluation.result?.current?.memory?.revenueCents === operation.previous_price_cents
    ? evaluation.result.current.memory : evaluation.result?.competitiveAssessment?.current?.memory;
  const baseline = {
    sku: batchItem.sku,
    priceBeforeCents: operation.previous_price_cents,
    priceAfterCents: operation.new_price_cents,
    priceToWinCents: operation.new_price_cents,
    marginBefore: actual?.margin ?? null,
    marginAfter: memory?.margin ?? null,
    taxRate: memory?.tax?.context?.appliedRate ?? null,
    taxStatus: memory?.tax?.status ?? null,
    costCents: memory?.cost?.amountCents ?? null,
    feeCents: memory?.fee?.amountCents ?? null,
    shippingCents: memory?.shipping?.amountCents ?? null,
    buyBoxBefore: batchItem.decision?.status ?? null,
    buyBoxAfterInitialReadback: readback.buyBoxStatus ?? null,
  };
  const created = await (client as any).from('pricing_experiments').insert({
    code: BUYBOX_PILOT_CODE,
    batch_item_id: batchItem.id,
    operation_id: operation.id,
    evaluation_id: evaluation.id,
    produto_id: operation.produto_id,
    seller_id: operation.seller_id,
    ml_item_id: operation.item_id,
    group_id: operation.group_id,
    group_version: operation.group_version,
    actor_id: BUYBOX_PILOT_ACTOR_ID,
    baseline,
  }).select('id,started_at').single();
  if (created.error || !created.data) throw new Error('buybox_pilot_experiment_create_failed');
  const started = Date.parse(created.data.started_at);
  const checkpoints = await (client as any).from('pricing_experiment_checkpoints').insert([
    { experiment_id: created.data.id, checkpoint: 'D1', due_at: new Date(started + 24 * 60 * 60_000).toISOString() },
    { experiment_id: created.data.id, checkpoint: 'D3', due_at: new Date(started + 72 * 60 * 60_000).toISOString() },
    { experiment_id: created.data.id, checkpoint: 'D7', due_at: new Date(started + 168 * 60 * 60_000).toISOString() },
  ]);
  if (checkpoints.error) throw new Error('buybox_pilot_checkpoints_create_failed');
  await updateBatchItem(client, batchItem.id, { experiment_id: created.data.id });
  return { id: created.data.id, startedAt: created.data.started_at, baseline };
}

export async function executeBuyBoxPilotItem(runId: string, itemId: string) {
  const client = createServiceClient();
  const assessed = await evaluateBuyBoxPilotItem(runId, itemId);
  const batchItem = await getBatchItem(client, runId, itemId);
  if (assessed.state !== 'BUY_BOX_ECONOMICAMENTE_ATACAVEL' || assessed.decision.writeApproved !== true) return assessed;
  const reason = `${BUYBOX_PILOT_CODE}: piloto autorizado por Rodrigo`;
  const commandId = randomUUID();
  const prepared = await client.rpc('prepare_pricing_decision' as any, {
    p_command_id: commandId,
    p_evaluation_id: assessed.evaluationId,
    p_actor_id: BUYBOX_PILOT_ACTOR_ID,
    p_reason: reason,
  });
  if (prepared.error || !prepared.data) throw new Error('buybox_pilot_decision_prepare_failed');
  const fresh = await evaluateBuyBoxPilotItem(runId, itemId);
  if (fresh.state !== 'BUY_BOX_ECONOMICAMENTE_ATACAVEL' || fresh.decision.writeApproved !== true) {
    return fresh;
  }
  const approval = await client.rpc('manage_pricing_decision' as any, {
    p_id: prepared.data,
    p_command_id: randomUUID(),
    p_actor_id: BUYBOX_PILOT_ACTOR_ID,
    p_action: 'approve',
    p_reason: reason,
    p_fresh_evaluation_id: fresh.evaluationId,
    p_deferred_until: null,
  });
  if (approval.error || approval.data?.state !== 'approved') throw new Error('buybox_pilot_decision_approval_failed');
  const operationId = randomUUID();
  const queued = await enqueueApprovedPricingDecision(prepared.data, operationId, BUYBOX_PILOT_ACTOR_ID);
  let dispatchState: string;
  try { dispatchState = await dispatchApprovedPricingOperation(client, queued.outboxId, operationId); }
  catch (error) {
    await updateBatchItem(client, batchItem.id, { final_state: 'FAILED_WRITE', decision_id: prepared.data,
      operation_id: operationId, error: { code: error instanceof Error ? error.message : 'buybox_pilot_dispatch_failed' }, executed_at: new Date().toISOString() });
    return { ...fresh, state: 'FAILED_WRITE' as const, decisionId: prepared.data, operationId };
  }
  const [operation, evaluation, localAfter, remoteAfter, competitionAfter] = await Promise.all([
    client.from('pricing_operations').select('*').eq('id', operationId).single(),
    client.from('pricing_evaluations').select('*').eq('id', fresh.evaluationId!).single(),
    liveLocalContext(client, manifestRowSchema.parse(batchItem.run.manifest.find((row: any) => row.ml_item_id === itemId))),
    fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}`),
    fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}/price_to_win?siteId=MLB&version=v2`),
  ]);
  if (operation.error || evaluation.error) throw new Error('buybox_pilot_operation_read_failed');
  const after = forbiddenSnapshot(localAfter.product, localAfter.listing, localAfter.snapshot);
  const invariantsOk = stable(batchItem.before_snapshot || fresh.before) === stable(after);
  const readback = {
    dispatchState,
    operationState: operation.data.state,
    priceCents: cents(remoteAfter.data?.price),
    buyBoxStatus: String(competitionAfter.data?.status || ''),
    buyBoxWinning: competitionAfter.data?.winner?.item_id === itemId || competitionAfter.data?.winner?.id === itemId,
    observedAt: new Date().toISOString(),
    invariantsOk,
  };
  let state: BuyBoxPilotState = operation.data.state === 'confirmed' && readback.priceCents === operation.data.new_price_cents && invariantsOk
    ? 'UPDATED_OK' : operation.data.state === 'failed' ? 'FAILED_WRITE' : 'FAILED_READBACK';
  let experiment = null;
  if (state === 'UPDATED_OK') experiment = await createExperiment(client, { ...batchItem, decision: fresh.decision }, operation.data, evaluation.data, readback);
  await updateBatchItem(client, batchItem.id, {
    final_state: state,
    decision_id: prepared.data,
    operation_id: operationId,
    evaluation_id: fresh.evaluationId,
    after_snapshot: after,
    readback,
    executed_at: new Date().toISOString(),
    error: state === 'UPDATED_OK' ? null : { code: `pricing_${operation.data.state}` },
  });
  return { ...fresh, state, decisionId: prepared.data, operationId, after, readback, experiment };
}

export async function summarizeBuyBoxPilot(runId: string) {
  const client = createServiceClient();
  const run = await (client as any).from('pricing_batch_runs').select('*').eq('id', runId).single();
  const items = await (client as any).from('pricing_batch_items').select('*').eq('run_id', runId).order('sequence');
  if (run.error || items.error || !run.data) throw new Error('buybox_pilot_summary_failed');
  const itemIds = (items.data || []).map((row: any) => row.id);
  const experiments = itemIds.length ? await (client as any).from('pricing_experiments').select('*').in('batch_item_id', itemIds) : { data: [], error: null };
  const experimentIds = (experiments.data || []).map((row: any) => row.id);
  const checkpoints = experimentIds.length ? await (client as any).from('pricing_experiment_checkpoints').select('*').in('experiment_id', experimentIds) : { data: [], error: null };
  if (experiments.error || checkpoints.error) throw new Error('buybox_pilot_summary_failed');
  return { run: run.data, items: items.data || [], experiments: experiments.data || [], checkpoints: checkpoints.data || [] };
}

export async function finishBuyBoxPilot(runId: string, stopped: boolean, errorCode?: string | null) {
  const client = createServiceClient();
  const summary = await summarizeBuyBoxPilot(runId);
  if (summary.items.length !== 15 || summary.items.some((row: any) => !finalStates.includes(row.final_state))) {
    throw new Error('buybox_pilot_reconciliation_failed');
  }
  const now = new Date().toISOString();
  const saved = await (client as any).from('pricing_batch_runs').update({
    state: stopped ? 'stopped' : 'completed',
    error_code: errorCode || null,
    started_at: summary.run.started_at || summary.run.created_at,
    finished_at: now,
    updated_at: now,
  }).eq('id', runId).eq('manifest_sha256', BUYBOX_PILOT_MANIFEST_SHA256);
  if (saved.error) throw new Error('buybox_pilot_finish_failed');
  return summarizeBuyBoxPilot(runId);
}
