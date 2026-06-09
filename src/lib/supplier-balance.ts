export const HAYAMAX_FORNECEDOR_ID = '2';
export const HAYAMAX_MIN_TOPUP_AMOUNT = 1000;

export type SupplierBalanceMovementType = 'topup' | 'purchase_debit' | 'adjustment';

export function isBalanceAccountSupplier(fornecedorId: string | number | null | undefined) {
  return String(fornecedorId || '').trim() === HAYAMAX_FORNECEDOR_ID;
}

export function normalizeMoneyAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

export async function getSupplierBalance(client: any, fornecedorId = HAYAMAX_FORNECEDOR_ID) {
  const { data, error } = await client
    .from('supplier_balance_movements')
    .select('amount')
    .eq('fornecedor_id', fornecedorId);

  if (error) throw new Error(error.message);
  return (data || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
}

export async function recordSupplierPurchaseDebit(params: {
  client: any;
  fornecedorId: string | number | null | undefined;
  fornecedorNome?: string | null;
  compraId?: string | null;
  dsid?: string | number | null;
  amount: number;
  reference?: string | null;
  notes?: string | null;
}) {
  const fornecedorId = String(params.fornecedorId || '').trim();
  if (!isBalanceAccountSupplier(fornecedorId)) return { skipped: true, reason: 'not_balance_supplier' };

  const amount = normalizeMoneyAmount(params.amount);
  if (amount <= 0) return { skipped: true, reason: 'invalid_amount' };

  const dsid = String(params.dsid || '').trim();
  const movementKey = dsid ? `purchase:${dsid}` : null;

  if (movementKey) {
    const { data: existing, error: existingError } = await params.client
      .from('supplier_balance_movements')
      .select('id')
      .eq('movement_key', movementKey)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (existing?.id) return { skipped: true, reason: 'already_recorded', movementId: existing.id };
  }

  const { data, error } = await params.client
    .from('supplier_balance_movements')
    .insert({
      fornecedor_id: fornecedorId,
      fornecedor_nome: params.fornecedorNome || null,
      movement_type: 'purchase_debit',
      amount: -amount,
      reference: params.reference || (dsid ? `Compra DSLite ${dsid}` : null),
      compra_id: params.compraId || null,
      notes: params.notes || null,
      movement_key: movementKey,
    })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return { skipped: false, movementId: data?.id || null };
}
