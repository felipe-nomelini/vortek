import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { HAYAMAX_FORNECEDOR_ID, normalizeMoneyAmount } from '@/lib/supplier-balance';
import type { SupplierLedgerMovementType } from '@/lib/supplier-ledger';

type DbClient = SupabaseClient<Database>;
type SupplierLedgerMovementInsert = Omit<
  Database['public']['Tables']['supplier_balance_movements']['Insert'],
  'movement_type'
> & { movement_type: SupplierLedgerMovementType };

type CancellationCandidateResult = {
  created: boolean;
  skipped?: string;
  movementId?: string | null;
};

const RECONCILIATION_PAGE_SIZE = 500;
const INSERT_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function buildMovementKey(compraId: string): string {
  return `cancellation_credit:${compraId}`;
}

export async function createSupplierCancellationCreditCandidate(
  client: DbClient,
  pedidoId: string,
  source: 'ml_webhook' | 'ml_sync' = 'ml_sync',
): Promise<CancellationCandidateResult> {
  const { data: pedido, error: pedidoError } = await client
    .from('pedidos')
    .select('id,numero,ml_order_id,dslite_id,situacao')
    .eq('id', pedidoId)
    .maybeSingle();

  if (pedidoError) throw new Error(pedidoError.message);
  if (!pedido?.id || pedido.situacao !== 'cancelado') return { created: false, skipped: 'order_not_cancelled' };

  const dsid = String(pedido.dslite_id || '').trim();
  if (!dsid) return { created: false, skipped: 'purchase_not_linked' };

  const { data: compra, error: compraError } = await client
    .from('compras')
    .select('id,dsid,fornecedor_id,fornecedor_nome,supplier_payment_mode,supplier_payment_status,supplier_payment_amount')
    .eq('dsid', dsid)
    .maybeSingle();

  if (compraError) throw new Error(compraError.message);
  if (!compra?.id) return { created: false, skipped: 'purchase_not_found' };
  if (String(compra.fornecedor_id || '') === HAYAMAX_FORNECEDOR_ID) return { created: false, skipped: 'hayamax_excluded' };
  if (compra.supplier_payment_mode !== 'prepaid_pix' || compra.supplier_payment_status !== 'paid') {
    return { created: false, skipped: 'supplier_not_paid' };
  }

  const amount = normalizeMoneyAmount(compra.supplier_payment_amount);
  if (amount <= 0 || !compra.fornecedor_id) return { created: false, skipped: 'payment_amount_missing' };

  const movementKey = buildMovementKey(String(compra.id));
  const { data: existing, error: existingError } = await client
    .from('supplier_balance_movements')
    .select('id')
    .eq('movement_key', movementKey)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return { created: false, skipped: 'already_recorded', movementId: existing.id };

  const movement = {
    fornecedor_id: String(compra.fornecedor_id),
    fornecedor_nome: compra.fornecedor_nome || null,
    movement_type: 'cancellation_credit',
    amount,
    reference: `Venda ML #${pedido.ml_order_id || pedido.numero} · Pedido DSLite #${compra.dsid}`,
    compra_id: String(compra.id),
    notes: 'Detectado automaticamente: venda cancelada após pagamento ao fornecedor. Confirmar crédito com o fornecedor.',
    created_by: source,
    movement_key: movementKey,
    status: 'pending',
    source: 'ml_cancellation',
    pedido_id: String(pedido.id),
    ml_order_id: pedido.ml_order_id || null,
  } satisfies SupplierLedgerMovementInsert;

  const { data, error } = await client
    .from('supplier_balance_movements')
    .insert(movement)
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return { created: false, skipped: 'already_recorded' };
    throw new Error(error.message);
  }

  return { created: true, movementId: data?.id || null };
}

export async function reconcileSupplierCancellationCredits(client: DbClient) {
  let offset = 0;
  let scanned = 0;
  let created = 0;

  while (true) {
    const { data: pedidos, error: pedidosError } = await client
      .from('pedidos')
      .select('id,numero,ml_order_id,dslite_id,situacao')
      .eq('situacao', 'cancelado')
      .not('dslite_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + RECONCILIATION_PAGE_SIZE - 1);

    if (pedidosError) throw new Error(pedidosError.message);
    if (!pedidos?.length) break;
    scanned += pedidos.length;

    const pedidoByDslite = new Map<string, (typeof pedidos)[number]>();
    for (const pedido of pedidos) {
      const dsid = String(pedido.dslite_id || '').trim();
      if (dsid) pedidoByDslite.set(dsid, pedido);
    }
    const dsids = Array.from(pedidoByDslite.keys());
    const compras: Array<Database['public']['Tables']['compras']['Row']> = [];

    for (const dsidChunk of chunk(dsids, INSERT_CHUNK_SIZE)) {
      const { data, error } = await client
        .from('compras')
        .select('*')
        .in('dsid', dsidChunk)
        .eq('supplier_payment_mode', 'prepaid_pix')
        .eq('supplier_payment_status', 'paid')
        .gt('supplier_payment_amount', 0);
      if (error) throw new Error(error.message);
      compras.push(...(data || []));
    }

    const candidates: SupplierLedgerMovementInsert[] = compras.flatMap((compra) => {
      if (!compra.fornecedor_id || String(compra.fornecedor_id) === HAYAMAX_FORNECEDOR_ID) return [];
      const pedido = pedidoByDslite.get(String(compra.dsid));
      if (!pedido) return [];
      const movement = {
        fornecedor_id: String(compra.fornecedor_id),
        fornecedor_nome: compra.fornecedor_nome || null,
        movement_type: 'cancellation_credit',
        amount: normalizeMoneyAmount(compra.supplier_payment_amount),
        reference: `Venda ML #${pedido.ml_order_id || pedido.numero} · Pedido DSLite #${compra.dsid}`,
        compra_id: String(compra.id),
        notes: 'Detectado automaticamente: venda cancelada após pagamento ao fornecedor. Confirmar crédito com o fornecedor.',
        created_by: 'historical_reconciliation',
        movement_key: buildMovementKey(String(compra.id)),
        status: 'pending',
        source: 'ml_cancellation',
        pedido_id: String(pedido.id),
        ml_order_id: pedido.ml_order_id || null,
      } satisfies SupplierLedgerMovementInsert;
      return [movement];
    });

    const movementKeys = candidates.map((item) => String(item.movement_key));
    const existingKeys = new Set<string>();
    for (const keyChunk of chunk(movementKeys, INSERT_CHUNK_SIZE)) {
      const { data, error } = await client
        .from('supplier_balance_movements')
        .select('movement_key')
        .in('movement_key', keyChunk);
      if (error) throw new Error(error.message);
      for (const row of data || []) {
        if (row.movement_key) existingKeys.add(row.movement_key);
      }
    }

    const missing = candidates.filter((item) => !existingKeys.has(String(item.movement_key)));
    for (const insertChunk of chunk(missing, INSERT_CHUNK_SIZE)) {
      const { data, error } = await client
        .from('supplier_balance_movements')
        .insert(insertChunk)
        .select('id');
      if (error && error.code !== '23505') throw new Error(error.message);
      created += data?.length || 0;
    }

    if (pedidos.length < RECONCILIATION_PAGE_SIZE) break;
    offset += RECONCILIATION_PAGE_SIZE;
  }

  return { scanned, created };
}
