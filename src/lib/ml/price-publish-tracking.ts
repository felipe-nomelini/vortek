import type { ProgressStep } from '@/components/modals/ProgressModal';

export type MlPublishStatusResponse = {
  success: boolean;
  status?: 'pending' | 'processing' | 'retry' | 'failed' | 'done';
  phase?: 'enfileirado' | 'processando' | 'erro' | 'concluido';
  last_error?: string | null;
  outboxId?: string;
  result?: {
    item_price?: number | null;
    has_quantity_pricing?: boolean;
    quantity_pricing_state?: 'active' | 'absent' | 'failed_validation' | 'provider_rejected';
    quantity_pricing_last_error?: string | null;
    quantity_pricing?: Array<{
      min_purchase_unit: number;
      discount_percent: number;
      amount: number;
      currency_id: string;
      pricing_model: 'percentage' | 'absolute';
    }>;
    suggested_quantity_pricing?: Array<{
      min_purchase_unit: number;
      discount_percent: number;
      amount: number;
      currency_id: string;
      pricing_model: 'percentage' | 'absolute';
    }>;
    warnings?: string[];
  } | null;
  progress?: {
    last_operation?: string | null;
  } | null;
  error?: string;
};

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function parseMlPublishOperationLabel(operation: string | null | undefined): string {
  const normalized = String(operation || '').trim().toLowerCase();
  if (!normalized) return 'Aguardando worker';
  if (normalized === 'processing_start') return 'Iniciando publicação';
  if (normalized === 'validate') return 'Validando item no outbox';
  if (normalized === 'price') return 'Publicando preço base';
  if (normalized === 'quantity_pricing') return 'Publicando preços de atacado';
  if (normalized === 'quantity') return 'Publicando estoque';
  if (normalized === 'status') return 'Publicando status do anúncio';
  return normalized;
}

export function buildMlPublishSteps(statusPayload: MlPublishStatusResponse | null): ProgressStep[] {
  const currentStatus = statusPayload?.status || 'pending';
  const lastError = statusPayload?.last_error || null;
  const phase = statusPayload?.phase || 'enfileirado';
  const lastOperation = statusPayload?.progress?.last_operation || null;
  const result = statusPayload?.result || null;
  const quantityPricing = Array.isArray(result?.quantity_pricing) ? result.quantity_pricing : [];
  const hasQuantityPricing = quantityPricing.length > 0;
  const quantityPricingState = String(result?.quantity_pricing_state || (hasQuantityPricing ? 'active' : 'absent'));
  const quantityPricingLastError = String(result?.quantity_pricing_last_error || '').trim();
  const suggestedQuantityPricing = Array.isArray(result?.suggested_quantity_pricing) ? result.suggested_quantity_pricing : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];

  const activeWholesaleDetail = quantityPricing.length > 0
    ? quantityPricing.map((tier) => tier.pricing_model === 'percentage'
      ? `${tier.min_purchase_unit}+ (-${tier.discount_percent}%)`
      : `${tier.min_purchase_unit}+ = ${currency.format(Number(tier.amount || 0))} (legado)`).join(' | ')
    : 'Sem preços de atacado ativos no anúncio.';
  const suggestedWholesaleDetail = suggestedQuantityPricing.length > 0
    ? `Sugestão: ${suggestedQuantityPricing.map((tier) => `${tier.min_purchase_unit}+ (-${tier.discount_percent}%) = ${currency.format(Number(tier.amount || 0))}`).join(' | ')}`
    : 'Sem sugestões disponíveis.';
  const diagnosticReason = quantityPricingState === 'failed_validation'
    ? 'Diagnóstico: o ML aceitou a chamada, mas as faixas não ficaram ativas.'
    : quantityPricingState === 'provider_rejected'
      ? 'Diagnóstico: o ML rejeitou a aplicação de atacado para este anúncio.'
      : quantityPricingState === 'absent' && !hasQuantityPricing
        ? 'Diagnóstico: anúncio sem faixas de atacado ativas no momento.'
        : '';
  const technicalReason = quantityPricingLastError ? ` Detalhe técnico: ${quantityPricingLastError}` : '';

  return [
    {
      label: 'Enfileirado',
      status: phase === 'enfileirado' ? 'loading' : 'success',
      detail: currentStatus === 'pending' ? 'Aguardando início do processamento no worker.' : 'Publicação recebida na fila.',
    },
    {
      label: 'Processando publicação no ML',
      status: currentStatus === 'failed'
        ? 'error'
        : currentStatus === 'done'
          ? 'success'
          : 'loading',
      detail: currentStatus === 'done'
        ? 'Preço base e atacado processados pelo worker.'
        : parseMlPublishOperationLabel(lastOperation),
      error: currentStatus === 'failed' ? (lastError || 'Falha ao processar publicação no ML.') : undefined,
    },
    {
      label: 'Preço final do anúncio',
      status: currentStatus === 'done'
        ? 'success'
        : currentStatus === 'failed'
          ? 'warning'
          : 'pending',
      detail: currentStatus === 'done'
        ? `Preço atual no ML: ${result?.item_price !== null && result?.item_price !== undefined ? currency.format(Number(result.item_price)) : 'não disponível'}`
        : 'Aguardando confirmação final do ML.',
    },
    {
      label: 'Preços de atacado',
      status: currentStatus === 'done'
        ? (hasQuantityPricing ? 'success' : 'warning')
        : currentStatus === 'failed'
          ? 'warning'
          : 'pending',
      detail: currentStatus === 'done'
        ? `${activeWholesaleDetail} ${suggestedWholesaleDetail}${diagnosticReason ? ` ${diagnosticReason}` : ''}${technicalReason}${warnings.length > 0 ? ` | Aviso: ${warnings.join(' | ')}` : ''}`
        : 'Aguardando confirmação final do ML.',
    },
  ];
}
