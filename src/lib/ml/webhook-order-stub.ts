import type { Database } from '@/types/database';

type PedidoSituation = Database['public']['Enums']['pedido_status'];

type WebhookOrderPersistenceAction = 'inserted' | 'updated' | null | undefined;

export function shouldAlertNewSaleFromWebhook(input: {
  orderStatus?: string | null;
  persistenceAction?: WebhookOrderPersistenceAction;
}): boolean {
  return input.persistenceAction === 'inserted'
    && String(input.orderStatus || '').trim().toLowerCase() === 'paid';
}

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
