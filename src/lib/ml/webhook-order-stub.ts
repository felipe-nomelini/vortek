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

export function shouldHydrateWebhookOrder(input: {
  order: {
    status?: string | null;
    payments?: Array<{ id?: string | number | null; status?: string | null }> | null;
  };
  existing?: {
    id?: string | number | null;
    situacao?: string | null;
    snapshot_incompleto?: boolean | null;
    sincronizado_em?: string | null;
  } | null;
}): boolean {
  const { order, existing } = input;
  if (!existing?.id || existing.snapshot_incompleto || !existing.sincronizado_em) return true;

  return existing.situacao === 'em_transito'
    && String(order.status || '').trim().toLowerCase() === 'paid'
    && Array.isArray(order.payments)
    && order.payments.some((payment) => (
      String(payment?.status || '').trim().toLowerCase() === 'approved'
      && Boolean(String(payment?.id || '').trim())
    ));
}
