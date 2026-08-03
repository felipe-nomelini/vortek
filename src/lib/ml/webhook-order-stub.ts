import type { Database } from '@/types/database';

type PedidoSituation = Database['public']['Enums']['pedido_status'];

export function resolveWebhookOrderSituation(input: {
  orderStatus?: string | null;
  existingSituation?: string | null;
}): PedidoSituation {
  const orderStatus = String(input.orderStatus || '').trim().toLowerCase();
  if (orderStatus === 'cancelled') return 'cancelado';

  const existingSituation = String(input.existingSituation || '').trim();
  if (existingSituation) return existingSituation as PedidoSituation;

  return orderStatus === 'paid' ? 'aberto' : 'atendido';
}
