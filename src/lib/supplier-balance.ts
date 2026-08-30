export const HAYAMAX_FORNECEDOR_ID = '2';
export const VANRAL_FORNECEDOR_ID = '97';
export const BKR1_FORNECEDOR_ID = '108';
export const EVOLUSOM_FORNECEDOR_ID = '133';
export const HAYAMAX_MIN_TOPUP_AMOUNT = 1000;

export function isBalanceAccountSupplier(fornecedorId: string | number | null | undefined) {
  return String(fornecedorId || '').trim() === HAYAMAX_FORNECEDOR_ID;
}

export function isVanralSupplier(
  fornecedorId: string | number | null | undefined,
  fornecedorNome?: string | null,
) {
  const id = String(fornecedorId || '').trim();
  if (id === VANRAL_FORNECEDOR_ID) return true;
  return String(fornecedorNome || '').trim().toLowerCase().includes('vanral');
}

export function isBkr1Supplier(
  fornecedorId: string | number | null | undefined,
  fornecedorNome?: string | null,
) {
  const id = String(fornecedorId || '').trim();
  if (id === BKR1_FORNECEDOR_ID) return true;
  const normalized = String(fornecedorNome || '').trim().toLowerCase();
  return normalized.includes('bkr1') || normalized.includes('bkr 1');
}

export function isEvolusomSupplier(
  fornecedorId: string | number | null | undefined,
  fornecedorNome?: string | null,
) {
  const id = String(fornecedorId || '').trim();
  if (id === EVOLUSOM_FORNECEDOR_ID) return true;
  return String(fornecedorNome || '').trim().toLowerCase().includes('evolusom');
}

export function allowsDslitePlaceholderLabel(
  fornecedorId: string | number | null | undefined,
  fornecedorNome?: string | null,
) {
  return isBalanceAccountSupplier(fornecedorId)
    || isVanralSupplier(fornecedorId, fornecedorNome)
    || isBkr1Supplier(fornecedorId, fornecedorNome)
    || isEvolusomSupplier(fornecedorId, fornecedorNome);
}

export function usesThermalMlLabelSupplier(
  fornecedorId: string | number | null | undefined,
  fornecedorNome?: string | null,
) {
  return isVanralSupplier(fornecedorId, fornecedorNome) || isBkr1Supplier(fornecedorId, fornecedorNome);
}

export function normalizeMoneyAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

function skuLookupVariants(value: unknown) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/\s+/g, '');
  const withoutKnownPrefix = compact.replace(/^(HYX|VTK|FJ)/i, '');
  return Array.from(new Set([raw, compact, withoutKnownPrefix].filter(Boolean)));
}

export async function resolveSupplierPurchasePaymentAmount(params: {
  client: any;
  fornecedorId: string | number | null | undefined;
  offerId?: string | null;
  dsliteProdutoId?: string | number | null;
  sku?: string | null;
  quantity?: number | null;
}) {
  const fornecedorId = String(params.fornecedorId || '').trim();
  const quantity = Math.max(1, Number(params.quantity || 1) || 1);
  const offerId = String(params.offerId || '').trim();
  const dsliteProdutoIdVariants = skuLookupVariants(params.dsliteProdutoId);
  const skuVariants = skuLookupVariants(params.sku);

  let query = params.client
    .from('produto_fornecedor_ofertas')
    .select('id,custo,dslite_fornecedor_id,dslite_produto_id,sku_oferta,sku_fornecedor')
    .eq('dslite_fornecedor_id', fornecedorId)
    .limit(1);

  if (offerId) {
    query = query.eq('id', offerId);
  } else if (dsliteProdutoIdVariants.length > 0) {
    query = query.in('dslite_produto_id', dsliteProdutoIdVariants);
  } else if (skuVariants.length > 0) {
    query = query.or(`sku_oferta.in.(${skuVariants.join(',')}),sku_fornecedor.in.(${skuVariants.join(',')})`);
  } else {
    return { amount: null, offerId: null, reason: 'missing_lookup' as const };
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);

  const unitCost = Number(data?.custo || 0);
  if (!data?.id || !Number.isFinite(unitCost) || unitCost <= 0) {
    return { amount: null, offerId: data?.id || null, reason: 'missing_cost' as const };
  }

  return {
    amount: normalizeMoneyAmount(unitCost * quantity),
    offerId: String(data.id),
    reason: 'offer_cost' as const,
  };
}
