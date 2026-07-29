export type OrdersOperationalView =
  | 'urgent'
  | 'preparation'
  | 'shipping'
  | 'delivered'
  | 'all';

export type WhatsappLabelOperationalStatus =
  | 'sent'
  | 'test_sent'
  | 'pending'
  | 'on_hold'
  | 'failed'
  | 'not_applicable'
  | 'not_sent'
  | 'unknown';

export type DsliteLabelOperationalStatus =
  | 'real_sent'
  | 'generic_sent'
  | 'provider_shipping'
  | 'sent_unverified'
  | 'pending'
  | 'failed'
  | 'unknown';

export const PREPARATION_ORDER_STATUSES = [
  'aberto',
  'pendente',
  'preparando',
  'pronto_envio',
  'etiqueta_impressa',
  'faturado',
] as const;

export const SHIPPING_ORDER_STATUSES = [
  'coletado',
  'em_transito',
  'saiu_entrega',
  'dest_ausente',
  'atendido',
] as const;

export const POST_DISPATCH_ORDER_STATUSES = [
  'coletado',
  'em_transito',
  'saiu_entrega',
  'dest_ausente',
  'entregue',
  'recusado',
  'devolvido',
] as const;

const OPERATION_DELAY_MS = 60 * 60 * 1000;

export interface OperationalOrderLike {
  data?: string | null;
  data_venda?: string | null;
  situacao?: string | { valor?: string | null } | null;
  dslite_id?: string | null;
  dslite_status?: string | null;
  dslite_etiqueta_enviada?: boolean | null;
  ml_fiscal_release_at?: string | null;
  ml_claim_id?: string | null;
  internal_stock_available?: boolean | null;
  envio_interno_at?: string | null;
  dslite_next_action?: string | null;
  dslite_label_operational_status?: DsliteLabelOperationalStatus | null;
  whatsapp_label_status?: WhatsappLabelOperationalStatus | null;
}

function normalizeOrderStatus(order: OperationalOrderLike): string {
  if (typeof order.situacao === 'object' && order.situacao) {
    return String(order.situacao.valor || '').trim().toLowerCase();
  }
  return String(order.situacao || '').trim().toLowerCase();
}

export function isPostDispatchOrder(order: OperationalOrderLike): boolean {
  return POST_DISPATCH_ORDER_STATUSES.includes(normalizeOrderStatus(order) as any);
}

function isOperationDelayed(order: OperationalOrderLike, at: number): boolean {
  const raw = String(order.data_venda || order.data || '').trim();
  if (!raw) return false;
  const createdAt = new Date(raw).getTime();
  return Number.isFinite(createdAt) && at - createdAt >= OPERATION_DELAY_MS;
}

function isMlLabelReleased(order: OperationalOrderLike, at: number): boolean {
  const raw = String(order.ml_fiscal_release_at || '').trim();
  if (!raw) return true;
  const releaseAt = new Date(raw).getTime();
  return !Number.isFinite(releaseAt) || releaseAt <= at;
}

export function getOperationalUrgencyReasons(
  order: OperationalOrderLike,
  at = Date.now(),
): string[] {
  const status = normalizeOrderStatus(order);
  if (!PREPARATION_ORDER_STATUSES.includes(status as any)) return [];

  const reasons: string[] = [];
  const isInternalShipping = Boolean(
    order.envio_interno_at || order.dslite_next_action === 'internal_shipping',
  );
  const dsliteId = String(order.dslite_id || '').trim();
  const whatsappStatus = String(order.whatsapp_label_status || '');
  const dsliteLabelStatus = String(order.dslite_label_operational_status || '');
  const dsliteLabelConfirmed = dsliteLabelStatus
    ? dsliteLabelStatus === 'real_sent'
      || dsliteLabelStatus === 'generic_sent'
      || dsliteLabelStatus === 'provider_shipping'
    : Boolean(order.dslite_etiqueta_enviada);

  if (order.ml_claim_id) reasons.push('Reclamação no Mercado Livre');
  if (isInternalShipping) return reasons;

  if (String(order.dslite_status || '').toLowerCase().includes('rejeitado')) {
    reasons.push('Pedido DSLite rejeitado');
  }
  if (whatsappStatus === 'on_hold') reasons.push('WhatsApp aguardando nova tentativa');
  if (whatsappStatus === 'failed') reasons.push('Falha no envio por WhatsApp');
  if (dsliteLabelStatus === 'failed') reasons.push('Falha no envio da etiqueta para DSLite');

  if (isOperationDelayed(order, at)) {
    if (!dsliteId) {
      reasons.push(order.internal_stock_available
        ? 'Envio interno ainda não processado'
        : 'Pedido de compra DSLite não criado');
    } else if (!dsliteLabelConfirmed && isMlLabelReleased(order, at)) {
      if (order.dslite_next_action === 'confirm_supplier_payment') {
        reasons.push('Pagamento PIX do fornecedor pendente');
      } else if (order.dslite_next_action === 'send_supplier_receipt') {
        reasons.push('Comprovante PIX ainda não anexado');
      } else if (order.dslite_next_action === 'resume_dslite_flow') {
        reasons.push('Fluxo DSLite precisa ser retomado');
      } else {
        reasons.push('Etiqueta ainda não confirmada na DSLite');
      }
    }
  }

  return Array.from(new Set(reasons));
}

export function matchesOrdersOperationalView(
  order: OperationalOrderLike,
  view: OrdersOperationalView,
): boolean {
  const status = normalizeOrderStatus(order);
  if (view === 'urgent') return getOperationalUrgencyReasons(order).length > 0;
  if (view === 'preparation') return PREPARATION_ORDER_STATUSES.includes(status as any);
  if (view === 'shipping') return SHIPPING_ORDER_STATUSES.includes(status as any);
  if (view === 'delivered') return status === 'entregue';
  return true;
}

export function parseOrdersOperationalView(value: unknown): OrdersOperationalView {
  const normalized = String(value || '').trim();
  if (
    normalized === 'urgent'
    || normalized === 'preparation'
    || normalized === 'shipping'
    || normalized === 'delivered'
    || normalized === 'all'
  ) {
    return normalized;
  }
  return 'all';
}
