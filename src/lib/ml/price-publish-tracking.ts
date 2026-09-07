import type { ProgressStep } from '@/components/modals/ProgressModal';

export type MlPublishStatusResponse = {
  success: boolean;
  status?: 'pending' | 'processing' | 'retry' | 'failed' | 'done' | 'cancelled';
  phase?: 'enfileirado' | 'processando' | 'erro' | 'concluido' | 'cancelado';
  last_error?: string | null;
  outboxId?: string;
  result?: {
    item_price?: number | null;
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
  if (normalized === 'quantity_pricing' || normalized === 'quantity_pricing_retired') return 'Desconto por quantidade aposentado (histórico)';
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
  if (currentStatus === 'cancelled') return [{
    label: 'Publicação cancelada', status: 'warning',
    detail: lastError === 'quantity_pricing_retired'
      ? 'Desconto por quantidade aposentado. Nenhum desconto foi publicado.'
      : (lastError || 'Operação encerrada sem publicação.'),
  }];

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
        ? 'Operações permitidas processadas pelo worker.'
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
        ? `Preço atual no ML: ${result?.item_price !== null && result?.item_price !== undefined ? currency.format(Number(result.item_price)) : 'não disponível'}${result?.warnings?.length ? ` · ${result.warnings.join(' | ')}` : ''}`
        : 'Aguardando confirmação final do ML.',
    },
  ];
}
