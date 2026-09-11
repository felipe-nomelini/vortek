export type EstadoOperacionalDevolucao =
  | 'em_transito'
  | 'entrega_informada'
  | 'aguardando_inspecao'
  | 'apto'
  | 'nao_apto'
  | 'encerrada_sem_recebimento';

const CLOSED_RETURN_STATUSES = new Set([
  'cancelled',
  'canceled',
  'expired',
  'failed',
  'not_delivered',
  'return_to_buyer',
]);

export function estadoOperacionalPorStatusMl(
  status: unknown,
): EstadoOperacionalDevolucao {
  const normalized = String(status || '').trim().toLowerCase();
  if (CLOSED_RETURN_STATUSES.has(normalized)) return 'encerrada_sem_recebimento';
  if (['delivered', 'returned'].includes(normalized)) return 'entrega_informada';
  return 'em_transito';
}

export function devolucaoPodeReceber(estado: EstadoOperacionalDevolucao) {
  return estado === 'em_transito' || estado === 'entrega_informada';
}

export function devolucaoEstaFinalizada(estado: EstadoOperacionalDevolucao) {
  return ['apto', 'nao_apto', 'encerrada_sem_recebimento'].includes(estado);
}
