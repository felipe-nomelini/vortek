export const ORACLE_EXCLUSION_LABELS = {
  invalid_account: 'Confira o PIX do fornecedor',
  supplier_mismatch: 'Fornecedor diferente do selecionado',
  payment_not_pending: 'Pagamento não está pendente',
  amount_invalid: 'Informe o valor da compra',
  purchase_cancelled: 'Compra cancelada',
  sale_missing: 'Venda da compra não encontrada',
  sale_ambiguous: 'Compra vinculada a mais de uma venda',
  sale_cancelled: 'Venda cancelada',
  allocated: 'Compra já incluída em outro fechamento',
  cancellation_review: 'Cancelamento da compra em aberto',
} as const;

export type OracleExclusionCode = keyof typeof ORACLE_EXCLUSION_LABELS;

type Purchase = {
  fornecedor_id: string | null;
  supplier_payment_mode: string | null;
  supplier_payment_status: string | null;
  supplier_payment_amount: number | null;
  status: string;
  status_dslite: string;
  supplier_settlement_id: string | null;
};

type Sale = {
  situacao: string | null;
};

export function evaluateSupplierOracleEligibility(input: {
  purchase: Purchase;
  sales: Sale[];
  selectedSupplierDsliteId: string;
  accountValid: boolean;
  hasActiveAllocation: boolean;
  hasOpenDivergence?: boolean;
}): OracleExclusionCode[] {
  const { purchase, sales } = input;
  const reasons: OracleExclusionCode[] = [];
  if (!input.accountValid) reasons.push('invalid_account');
  if (String(purchase.fornecedor_id || '').trim() !== input.selectedSupplierDsliteId) reasons.push('supplier_mismatch');
  if (purchase.supplier_payment_mode !== 'prepaid_pix' || purchase.supplier_payment_status !== 'pending') reasons.push('payment_not_pending');
  const amount = Number(purchase.supplier_payment_amount);
  if (purchase.supplier_payment_amount === null || !Number.isFinite(amount)
    || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) reasons.push('amount_invalid');
  if (String(purchase.status || '').toLowerCase() === 'cancelado' || String(purchase.status_dslite || '').toLowerCase() === 'cancelado') reasons.push('purchase_cancelled');
  if (sales.length === 0) reasons.push('sale_missing');
  if (sales.length > 1) reasons.push('sale_ambiguous');
  if (sales.length === 1 && String(sales[0].situacao || '').toLowerCase() === 'cancelado') reasons.push('sale_cancelled');
  if (purchase.supplier_settlement_id || input.hasActiveAllocation) reasons.push('allocated');
  if (input.hasOpenDivergence) reasons.push('cancellation_review');
  return reasons;
}

export function oracleExclusionLabels(codes: OracleExclusionCode[]): string[] {
  return codes.map((code) => ORACLE_EXCLUSION_LABELS[code]);
}
