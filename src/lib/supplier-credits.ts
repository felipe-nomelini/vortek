import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import { HAYAMAX_FORNECEDOR_ID } from '@/lib/supplier-balance';
import { fetchMLResult } from '@/services/integration';
import { classifySupplierDispatchHistory } from '@/lib/supplier-cancellation-dispatch.js';

type DbClient = SupabaseClient<Database>;
type Source = 'ml_webhook' | 'ml_sync' | 'dslite_sync' | 'evolusom_sync' | 'manual_reconcile';
type Result = { created: boolean; skipped?: string; movementId?: string | null;
  caseId?: string | null; classification?: string; status?: string };
type HistoryEvent = { status?: string; substatus?: string | null; date?: string };

async function dispatchEvidence(shipmentId: string | null): Promise<{
  dispatch: 'not_dispatched' | 'dispatched' | 'unknown'; evidence: Record<string, string>;
}> {
  if (!shipmentId) return { dispatch: 'unknown', evidence: { source: 'ml_history', proof: 'shipment_missing' } };
  const result = await fetchMLResult<HistoryEvent[]>(`/shipments/${encodeURIComponent(shipmentId)}/history`,
    { headers: { 'x-format-new': 'true' } });
  if (!result.ok) return { dispatch: 'unknown', evidence: {
    source: 'ml_history', shipmentId, proof: 'history_unavailable', status: String(result.status || 0),
  } };
  const classified = classifySupplierDispatchHistory(result.data, shipmentId);
  return { dispatch: classified.dispatch as 'not_dispatched' | 'dispatched' | 'unknown',
    evidence: classified.evidence };
}

/** Única entrada dos produtores ML/DSLite e da reconciliação administrativa. */
export async function createSupplierCancellationCreditCandidate(
  client: DbClient, pedidoId: string, source: Source = 'ml_sync',
): Promise<Result> {
  const { data: sale, error: saleError } = await client.from('pedidos')
    .select('id,dslite_id,evolusom_order_id,situacao,ml_shipment_id').eq('id', pedidoId).maybeSingle();
  if (saleError) throw new Error(saleError.message);
  if (!sale?.id || sale.situacao !== 'cancelado') return { created: false, skipped: 'order_not_cancelled' };
  if (!sale.dslite_id && !sale.evolusom_order_id) return { created: false, skipped: 'purchase_not_linked' };
  let purchaseQuery = client.from('compras')
    .select('id,fornecedor_id,supplier_payment_mode,supplier_payment_status');
  purchaseQuery = sale.evolusom_order_id
    ? purchaseQuery.eq('pedido_id', sale.id).eq('evolusom_order_id', sale.evolusom_order_id)
    : purchaseQuery.eq('dsid', sale.dslite_id!);
  const { data: purchase, error: purchaseError } = await purchaseQuery.maybeSingle();
  if (purchaseError) throw new Error(purchaseError.message);
  if (!purchase?.id) return { created: false, skipped: 'purchase_not_found' };
  if (purchase.fornecedor_id === HAYAMAX_FORNECEDOR_ID || purchase.supplier_payment_mode !== 'prepaid_pix') {
    return { created: false, skipped: 'supplier_not_applicable' };
  }
  const { data: historicalCredit, error: historicalError } = await client.from('supplier_balance_movements')
    .select('id').eq('movement_key', `cancellation_credit:${purchase.id}`).maybeSingle();
  if (historicalError) throw new Error(historicalError.message);
  const { data: currentCase, error: caseError } = await client.from('supplier_cancellation_cases')
    .select('id').eq('compra_id', purchase.id).maybeSingle();
  if (caseError) throw new Error(caseError.message);
  if (historicalCredit && !currentCase) {
    return { created: false, skipped: 'historical_credit', movementId: historicalCredit.id };
  }
  const dispatch = purchase.supplier_payment_status === 'paid'
    ? await dispatchEvidence(sale.ml_shipment_id)
    : { dispatch: 'unknown' as const, evidence: { source: 'payment_pending', proof: 'not_paid' } };
  const { data, error } = await client.rpc('supplier_oracle_record_cancellation', {
    p_compra_id: purchase.id, p_pedido_id: sale.id, p_source: source,
    p_dispatch: dispatch.dispatch, p_evidence: dispatch.evidence as Json, p_actor: source,
  });
  if (error) throw new Error(error.message);
  const result = data as { caseId?: string; classification?: string; status?: string;
    movementId?: string | null; skipped?: string; replayed?: boolean };
  return { created: Boolean(result.movementId && !result.replayed && !result.skipped),
    skipped: result.skipped, movementId: result.movementId || null,
    caseId: result.caseId || null, classification: result.classification, status: result.status };
}

export async function recordSupplierPurchaseCancellation(
  client: DbClient, purchaseId: string, source: 'dslite_sync' | 'evolusom_sync' = 'dslite_sync',
): Promise<Result> {
  const { data: purchase, error: purchaseError } = await client.from('compras')
    .select('id,dsid,evolusom_order_id,pedido_id,fornecedor_id,supplier_payment_mode,status,status_dslite')
    .eq('id', purchaseId).maybeSingle();
  if (purchaseError) throw new Error(purchaseError.message);
  const cancelled = source === 'evolusom_sync'
    ? Boolean(purchase?.evolusom_order_id && String(purchase.status || '').toLowerCase().includes('cancelado'))
    : Boolean(purchase?.dsid && String(purchase.status_dslite || '').toLowerCase().includes('cancelado'));
  if (!purchase?.id || !cancelled) {
    return { created: false, skipped: 'purchase_not_cancelled' };
  }
  if (purchase.fornecedor_id === HAYAMAX_FORNECEDOR_ID || purchase.supplier_payment_mode !== 'prepaid_pix') {
    return { created: false, skipped: 'supplier_not_applicable' };
  }
  let sales: Array<{ id: string }> = [];
  let saleError = null;
  if (source !== 'evolusom_sync' || purchase.pedido_id) {
    let saleQuery = client.from('pedidos').select('id');
    saleQuery = source === 'evolusom_sync'
      ? saleQuery.eq('id', purchase.pedido_id!).eq('evolusom_order_id', purchase.evolusom_order_id!)
      : saleQuery.eq('dslite_id', purchase.dsid!).or('ml_bundle_primary.eq.true,ml_bundle_primary.is.null');
    const result = await saleQuery.limit(2);
    sales = result.data || [];
    saleError = result.error;
  }
  if (saleError) throw new Error(saleError.message);
  const { data, error } = await client.rpc('supplier_oracle_record_cancellation', {
    p_compra_id: purchase.id, p_pedido_id: sales?.length === 1 ? sales[0].id : null,
    p_source: source, p_dispatch: 'unknown',
    p_evidence: { source: source === 'dslite_sync' ? 'dslite_purchase' : 'evolusom_purchase', proof: 'purchase_cancelled' }, p_actor: source,
  });
  if (error) throw new Error(error.message);
  const result = data as { caseId?: string; classification?: string; status?: string;
    movementId?: string | null; skipped?: string };
  return { created: false, skipped: result.skipped, caseId: result.caseId || null,
    classification: result.classification, status: result.status, movementId: result.movementId || null };
}

export const recordDslitePurchaseCancellation = recordSupplierPurchaseCancellation;

export async function reconcileSupplierCancellationCredits(client: DbClient) {
  const pageSize = 200;
  let lastId = '';
  let scanned = 0;
  let created = 0;
  let reviews = 0;
  while (true) {
    let query = client.from('supplier_cancellation_cases').select('id,pedido_id,compra_id')
      .eq('status', 'open').order('id', { ascending: true }).limit(pageSize);
    if (lastId) query = query.gt('id', lastId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const item of data) {
      let result = item.pedido_id
        ? await createSupplierCancellationCreditCandidate(client, item.pedido_id, 'manual_reconcile')
        : { created: false, skipped: 'purchase_not_linked' } as Result;
      if (result.skipped === 'order_not_cancelled' || result.skipped === 'purchase_not_linked') {
        result = await recordDslitePurchaseCancellation(client, item.compra_id);
      }
      scanned += 1;
      if (result.created) created += 1;
      if (result.status === 'open') reviews += 1;
    }
    if (data.length < pageSize) break;
    lastId = data[data.length - 1].id;
  }
  return { scanned, created, reviews };
}
