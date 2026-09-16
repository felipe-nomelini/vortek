export type SupplyStatus = 'unknown' | 'ready' | 'blocked' | 'cancelled';

export const ORACLE_EXCLUSION_LABELS = {
  invalid_account: 'Cadastro financeiro do fornecedor inválido ou ambíguo',
  supplier_mismatch: 'Compra não pertence ao fornecedor selecionado',
  payment_not_pending: 'PIX pré-pago não está pendente',
  amount_invalid: 'Valor do fornecedor ausente ou inválido',
  purchase_cancelled: 'Compra cancelada',
  purchase_review: 'Compra requer revisão operacional',
  sale_missing: 'Venda vinculada não encontrada',
  sale_ambiguous: 'Mais de uma venda vinculada à compra',
  sale_inactive: 'Venda encerrada ou com situação desconhecida',
  sale_divergence: 'Venda com pendência, reclamação ou dados operacionais incompletos',
  label_not_real: 'Etiqueta real ainda não comprovada',
  label_not_delivered: 'Entrega da etiqueta real não comprovada',
  supply_not_ready: 'Abastecimento ainda não confirmado como pronto',
  allocated: 'Compra já alocada a uma liquidação',
} as const;

export type OracleExclusionCode = keyof typeof ORACLE_EXCLUSION_LABELS;

type Purchase = {
  fornecedor_id: string | null;
  supplier_payment_mode: string | null;
  supplier_payment_status: string | null;
  supplier_payment_amount: number | null;
  status: string;
  status_dslite: string;
  supply_status: string;
  supplier_settlement_id: string | null;
};

type Sale = {
  situacao: string | null;
  ml_claim_id: string | null;
  snapshot_incompleto: boolean | null;
  snapshot_pendencias: unknown;
  label_type: string | null;
  label_delivery_channel: string | null;
  label_delivered_at: string | null;
};

const ACTIVE_SALE_STATUSES = new Set([
  'aberto', 'pendente', 'preparando', 'pronto_envio', 'etiqueta_impressa',
  'coletado', 'em_transito', 'saiu_entrega', 'dest_ausente', 'atendido',
  'faturado', 'entregue',
]);

function hasPendingSnapshot(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(String(value || '').trim());
}

export function evaluateSupplierOracleEligibility(input: {
  purchase: Purchase;
  sales: Sale[];
  selectedSupplierDsliteId: string;
  accountValid: boolean;
  hasActiveAllocation: boolean;
}): OracleExclusionCode[] {
  const { purchase, sales } = input;
  const reasons: OracleExclusionCode[] = [];
  if (!input.accountValid) reasons.push('invalid_account');
  if (String(purchase.fornecedor_id || '').trim() !== input.selectedSupplierDsliteId) reasons.push('supplier_mismatch');
  if (purchase.supplier_payment_mode !== 'prepaid_pix' || purchase.supplier_payment_status !== 'pending') reasons.push('payment_not_pending');
  if (!Number.isFinite(Number(purchase.supplier_payment_amount)) || !(Number(purchase.supplier_payment_amount) > 0)) reasons.push('amount_invalid');
  if (String(purchase.status || '').toLowerCase() === 'cancelado' || String(purchase.status_dslite || '').toLowerCase() === 'cancelado') reasons.push('purchase_cancelled');
  if (['revisão', 'revisao', 'aguardando informações', 'aguardando informacoes'].includes(String(purchase.status_dslite || '').toLowerCase())) reasons.push('purchase_review');
  if (sales.length === 0) reasons.push('sale_missing');
  if (sales.length > 1) reasons.push('sale_ambiguous');
  if (sales.length === 1) {
    const sale = sales[0];
    if (!ACTIVE_SALE_STATUSES.has(String(sale.situacao || ''))) reasons.push('sale_inactive');
    if (sale.snapshot_incompleto === true || hasPendingSnapshot(sale.snapshot_pendencias) || sale.ml_claim_id) reasons.push('sale_divergence');
    if (sale.label_type !== 'real') reasons.push('label_not_real');
    if (!['dslite', 'whatsapp'].includes(String(sale.label_delivery_channel || '')) || !sale.label_delivered_at) reasons.push('label_not_delivered');
  }
  if (purchase.supply_status !== 'ready') reasons.push('supply_not_ready');
  if (purchase.supplier_settlement_id || input.hasActiveAllocation) reasons.push('allocated');
  return reasons;
}

export function oracleExclusionLabels(codes: OracleExclusionCode[]): string[] {
  return codes.map((code) => ORACLE_EXCLUSION_LABELS[code]);
}
