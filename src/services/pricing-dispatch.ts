import 'server-only';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from './integration';
import { loadPricingDetail } from './pricing-detail';
import { persistPricingObservations, transitionPricingOperation } from './pricing-audit';
import { consumePricingDecision } from './pricing-decisions';
import { requirePricingExecutionAccount, pricingExecutionTransport } from './pricing-execution-access';
import { pricingReadbackMatches } from '@/lib/ml/pricing-execution';

type Client = ReturnType<typeof createServiceClient>;

async function revalidate(client: Client, decision: any, productId: string, actorId: string) {
  await requirePricingExecutionAccount(decision.context.sellerId, decision.context.operationKind || 'price_change');
  if (decision.context.operationKind === 'listing_create') {
    const { preparePublication } = await import('./publication-preparation');
    const fresh = await preparePublication(decision.context.preparation.input, actorId);
    if (fresh.decisionContext.fingerprint !== decision.fingerprint) throw new Error('decision_evaluation_changed');
    return fresh.evaluationId;
  }
  const response = await loadPricingDetail({ produtoId: productId,
    mlItemId: decision.context.itemId, priceCents: decision.context.priceCents,
    ...(decision.context.clearance ? { clearance: decision.context.clearance } : {}),
  }, { actorId });
  if (!response.ok) throw new Error('decision_revalidation_unavailable');
  const fresh = await response.json();
  if (!fresh.decisionContext?.executable || fresh.decisionContext.fingerprint !== decision.fingerprint)
    throw new Error('decision_evaluation_changed');
  return fresh.evaluationId as string;
}

/** Authenticated command only enqueues the stored approval. It accepts no new price/payload. */
export async function enqueueApprovedPricingDecision(decisionId: string, operationId: string, actorId: string) {
  await requirePricingExecutionAccount();
  const client = createServiceClient();
  const found = await client.from('pricing_decisions').select('*,alert:pricing_alerts!pricing_decisions_alert_id_fkey(produto_id)')
    .eq('id', decisionId).single();
  if (found.error || !found.data) throw new Error('decision_missing');
  const decision = found.data as any;
  await requirePricingExecutionAccount(decision.context.sellerId, decision.context.operationKind || 'price_change');
  const outboxId = await consumePricingDecision(client, { decisionId, operationId, actorId }, async () => {
    // Consumption is idempotent in SQL; no stale-price comparison after a completed operation.
    if (decision.operation_id) return decision.evaluation_id;
    return revalidate(client, decision, decision.alert.produto_id, actorId);
  });
  if (decision.operation_id) {
    const operation = await client.from('pricing_operations').select('state').eq('id', operationId).single();
    if (operation.error) throw new Error('decision_operation_unavailable');
    if (['requested', 'inconclusive'].includes(operation.data.state)) {
      // An explicit request only requeues reconciliation; dispatch can never claim these states again.
      const queued = await client.from('anuncios_ml_outbox').update({ status: 'retry', available_at: new Date().toISOString() })
        .eq('pricing_operation_id', operationId).in('status', ['failed', 'retry']);
      if (queued.error) throw new Error('decision_reconciliation_queue_failed');
    }
  }
  return { operationId, outboxId, state: 'queued' };
}

/** Existing publish worker owns delivery. Requested/inconclusive operations are read-only on redelivery. */
export async function dispatchApprovedPricingOperation(client: Client, outboxId: string, operationId: string) {
  const result = await client.from('pricing_operations').select('*').eq('id', operationId).single();
  const approval = await client.from('pricing_decisions').select('*').eq('operation_id', operationId).single();
  if (result.error || approval.error || !result.data || !approval.data) throw new Error('decision_operation_missing');
  let operation = result.data;
  const decision = approval.data as any;
  const { sellerId } = await requirePricingExecutionAccount(decision.context.sellerId, decision.context.operationKind || 'price_change');
  const finish = async (state: string) => {
    const terminal = state === 'confirmed' ? 'done' : 'failed';
    const saved = await client.from('anuncios_ml_outbox').update({ status: terminal,
      last_error: state === 'confirmed' ? null : `pricing_${state}: não reenviar; conferir operação`,
      updated_at: new Date().toISOString(), processed_at: new Date().toISOString(),
    }).eq('id', outboxId).eq('pricing_operation_id', operationId);
    if (saved.error) throw new Error('decision_delivery_persistence_failed');
    return state;
  };
  if (['confirmed', 'failed'].includes(operation.state)) return finish(operation.state);
  if (operation.state === 'prepared') {
    if (Date.parse(decision.expires_at) <= Date.now()) {
      await transitionPricingOperation(client, operationId, 'failed');
      return finish('failed');
    }
    let evaluationId: string;
    try { evaluationId = await revalidate(client, decision, operation.produto_id, operation.actor_id!); }
    catch (error) {
      if (error instanceof Error && error.message === 'decision_evaluation_changed') {
        await transitionPricingOperation(client, operationId, 'failed');
        return finish('failed');
      }
      // An unavailable source is not evidence of loss and does not authorize a remote action.
      // Leave the approval untouched for inspection; no price is sent.
      throw error;
    }
    const transport = pricingExecutionTransport(sellerId, async () => {
      const claimed = await client.rpc('claim_pricing_decision_dispatch' as any, {
        p_operation_id: operationId, p_fresh_evaluation_id: evaluationId,
      });
      if (claimed.error || claimed.data !== true) throw new Error('decision_dispatch_not_claimed');
    });
    // One origin item only; a 2xx is not proof that ML accepted/propagated the price.
    const creation = decision.context.operationKind === 'listing_create';
    const relist = creation && decision.context.preparation.action === 'relist';
    const mutationPath = relist
      ? '/items/' + encodeURIComponent(decision.context.preparation.sourceItemId) + '/relist'
      : creation ? '/items' : '/items/' + encodeURIComponent(operation.item_id!);
    const sent = await fetchMLResult<any>(mutationPath, {
      method: creation ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creation ? decision.context.preparation.payload : { price: operation.new_price_cents / 100 }),
    }, transport).catch(() => null);
    if (creation && sent?.data?.id && /^MLB\d+$/.test(sent.data.id) && String(sent.data.seller_id) === sellerId) {
      const captured = await client.rpc('capture_pricing_created_item' as any, {
        p_operation_id: operationId, p_item_id: sent.data.id, p_seller_id: sellerId,
      });
      if (captured.error) throw new Error('publication_remote_capture_failed');
      // Remote identity already durable. A failure here can never cause another POST /items.
      if (relist) await fetchMLResult('/items/' + encodeURIComponent(sent.data.id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale_terms: decision.context.preparation.expected.sale_terms }),
      }, pricingExecutionTransport(sellerId)).catch(() => null);
      await fetchMLResult('/items/' + encodeURIComponent(sent.data.id) + '/description', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plain_text: decision.context.preparation.description }),
      }, pricingExecutionTransport(sellerId)).catch(() => null);
    }
    const freshOperation = await client.from('pricing_operations').select('*').eq('id', operationId).single();
    if (freshOperation.error || !freshOperation.data) throw new Error('decision_operation_unavailable');
    operation = freshOperation.data;
    if (operation.state === 'prepared') throw new Error('decision_dispatch_not_claimed');
    if (['confirmed', 'failed'].includes(operation.state)) return finish(operation.state);
  }
  if (decision.context.operationKind === 'listing_create') {
    const { verifyCreatedPublication } = await import('./publication-readback');
    const verified = operation.item_id && await verifyCreatedPublication(client, operation, decision.context.preparation, sellerId);
    if (verified) {
      const confirmed = await client.rpc('transition_pricing_operation', { p_id: operationId, p_state: 'confirmed',
        p_evidence: { item_id: operation.item_id!, seller_id: sellerId, price_cents: operation.new_price_cents,
          observed_at: new Date().toISOString(), outcome: 'readback_verified', listing_verified: true } });
      if (confirmed.error) throw new Error('publication_confirmation_persistence_failed');
      return finish('confirmed');
    }
    if (operation.state === 'requested') await transitionPricingOperation(client, operationId, 'inconclusive');
    return finish('inconclusive');
  }
  if (!operation.item_id || !operation.group_id || !operation.group_version) throw new Error('decision_price_target_invalid');
  const members = await client.from('ml_pricing_group_members').select('ml_item_id,variation_id')
    .eq('group_id', operation.group_id).eq('version', operation.group_version);
  if (members.error || !members.data?.length) throw new Error('decision_members_unavailable');
  const items = new Map<string, any>();
  for (const id of new Set(members.data.map(m => m.ml_item_id))) {
    const read = await fetchMLResult<any>('/items/' + encodeURIComponent(id));
    if (read.ok && read.data?.id === id) items.set(id, read.data);
  }
  const observedAt = new Date().toISOString();
  const evidenceMembers = members.data.map(m => ({ item: items.get(m.ml_item_id), variationId: m.variation_id }));
  if (pricingReadbackMatches(items.get(operation.item_id), sellerId, operation.new_price_cents, evidenceMembers)) {
    const proof = { reference: 'items/' + operation.item_id, outcome: 'readback_verified' as const,
      item_id: operation.item_id, price_cents: operation.new_price_cents, observed_at: observedAt,
      members: members.data.map(m => ({ item_id: m.ml_item_id, variation_id: m.variation_id, price_cents: operation.new_price_cents })) };
    // Persist observed prices with their actual origin, never custom_price as evidence of manual action.
    const persisted = await persistPricingObservations(client, 'anuncios_ml', members.data.map(m => ({
      ml_item_id: m.ml_item_id, produto_id: operation.produto_id, preco_ml: operation.new_price_cents / 100,
    })), observedAt);
    if (persisted.error) throw new Error('decision_readback_persistence_failed');
    await transitionPricingOperation(client, operationId, 'confirmed', proof);
    return finish('confirmed');
  }
  // Even a baseline read after a timeout may precede a delayed remote application.
  // Do not infer "no effect", release the group, or automatically resend.
  if (operation.state === 'requested') await transitionPricingOperation(client, operationId, 'inconclusive');
  return finish('inconclusive');
}
