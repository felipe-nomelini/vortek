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

export const ORDER_STATUS_OPTIONS = [
  { value: 'aberto', label: 'Aberto' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'preparando', label: 'Preparando' },
  { value: 'pronto_envio', label: 'Pronto p/ envio' },
  { value: 'etiqueta_impressa', label: 'Etiqueta impressa' },
  { value: 'coletado', label: 'Coletado' },
  { value: 'em_transito', label: 'Em trânsito' },
  { value: 'saiu_entrega', label: 'Saiu para entrega' },
  { value: 'dest_ausente', label: 'Destinatário ausente' },
  { value: 'atendido', label: 'Atendido' },
  { value: 'faturado', label: 'Faturado' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'recusado', label: 'Recusado' },
  { value: 'devolvido', label: 'Devolvido' },
  { value: 'concretizada_ml', label: 'Concretizada pelo ML' },
  { value: 'cancelado', label: 'Cancelado' },
] as const;

export const ORDER_STATUS_LABELS = Object.fromEntries(
  ORDER_STATUS_OPTIONS.map((option) => [option.value, option.label]),
) as Record<(typeof ORDER_STATUS_OPTIONS)[number]['value'], string>;

export const ORDER_STATUS_COLORS: Record<(typeof ORDER_STATUS_OPTIONS)[number]['value'], string> = {
  aberto: 'blue',
  pendente: 'orange',
  preparando: 'processing',
  pronto_envio: 'cyan',
  etiqueta_impressa: 'blue',
  coletado: 'geekblue',
  em_transito: 'purple',
  saiu_entrega: 'cyan',
  dest_ausente: 'red',
  atendido: 'processing',
  faturado: 'purple',
  entregue: 'green',
  recusado: 'red',
  devolvido: 'magenta',
  concretizada_ml: 'gold',
  cancelado: 'default',
};

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
  'concretizada_ml',
] as const;

export const SALES_PROGRESS_STAGES = [
  'Venda',
  'Preparação',
  'Fiscal',
  'Etiqueta',
  'Envio',
  'Entrega',
] as const;

export type SalesProgressTone = 'normal' | 'error' | 'success';

export interface OrderSalesProgress {
  completedSteps: number;
  currentStep: number;
  currentLabel: (typeof SALES_PROGRESS_STAGES)[number];
  nextLabel: string;
  tone: SalesProgressTone;
}

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
  dslite_next_action_label?: string | null;
  dslite_label_operational_status?: DsliteLabelOperationalStatus | null;
  whatsapp_label_status?: WhatsappLabelOperationalStatus | null;
  fulfillment_source?: 'internal' | 'supplier' | null;
  has_split_fulfillment?: boolean | null;
  notaFiscal?: { emitida?: boolean | null } | null;
  nota_fiscal_emitida?: boolean | null;
  nfe_status?: string | null;
  ml_label_storage_path?: string | null;
  ml_thermal_label_storage_path?: string | null;
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

function isOperationDelayed(
  order: OperationalOrderLike,
  at: number,
  delayedAfterMinutes: number,
): boolean {
  const raw = String(order.data_venda || order.data || '').trim();
  if (!raw) return false;
  const createdAt = new Date(raw).getTime();
  return Number.isFinite(createdAt)
    && at - createdAt >= delayedAfterMinutes * 60 * 1000;
}

function isMlLabelReleased(order: OperationalOrderLike, at: number): boolean {
  const raw = String(order.ml_fiscal_release_at || '').trim();
  if (!raw) return true;
  const releaseAt = new Date(raw).getTime();
  return !Number.isFinite(releaseAt) || releaseAt <= at;
}

export function getOperationalUrgencyReasons(
  order: OperationalOrderLike,
  delayedAfterMinutes: number,
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

  if (isOperationDelayed(order, at, delayedAfterMinutes)) {
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

function isDsliteLabelConfirmed(order: OperationalOrderLike): boolean {
  const status = String(order.dslite_label_operational_status || '');
  if (status) {
    return status === 'real_sent'
      || status === 'generic_sent'
      || status === 'provider_shipping';
  }
  return Boolean(order.dslite_etiqueta_enviada);
}

function isPreparationComplete(order: OperationalOrderLike): boolean {
  const internal = order.fulfillment_source === 'internal'
    || Boolean(order.envio_interno_at)
    || order.dslite_next_action === 'internal_shipping';

  if (internal) return Boolean(order.envio_interno_at);

  const dsliteId = String(order.dslite_id || '').trim();
  const nextAction = String(order.dslite_next_action || '');
  const blockedActions = [
    'create_dslite_order',
    'confirm_supplier_payment',
    'send_supplier_receipt',
    'resume_dslite_flow',
    'blocked',
  ];

  return Boolean(dsliteId)
    && !blockedActions.includes(nextAction)
    && !String(order.dslite_status || '').toLowerCase().includes('rejeitado');
}

function isFiscalComplete(order: OperationalOrderLike, status: string): boolean {
  return status === 'faturado'
    || Boolean(order.notaFiscal?.emitida)
    || Boolean(order.nota_fiscal_emitida)
    || String(order.nfe_status || '').toLowerCase() === 'authorized';
}

function isLabelComplete(order: OperationalOrderLike, status: string): boolean {
  return status === 'etiqueta_impressa'
    || isDsliteLabelConfirmed(order)
    || Boolean(order.ml_label_storage_path)
    || Boolean(order.ml_thermal_label_storage_path);
}

function resolvePreparationNextLabel(order: OperationalOrderLike): string {
  const nextAction = String(order.dslite_next_action || '');
  const label = String(order.dslite_next_action_label || '').trim();

  if (nextAction === 'internal_shipping') return 'Processe o envio interno';
  if (nextAction === 'create_dslite_order') return 'Crie o pedido DSLite';
  if (nextAction === 'confirm_supplier_payment') return 'Confirme o PIX';
  if (nextAction === 'send_supplier_receipt') return 'Anexe o comprovante';
  if (nextAction === 'resume_dslite_flow') return 'Retome o fluxo DSLite';
  if (nextAction === 'blocked') return 'Revise o bloqueio do fulfillment';
  if (!nextAction && order.internal_stock_available) return 'Processe o envio interno';
  if (label && label !== 'OK') return label;
  return 'Crie o pedido DSLite';
}

function inferCompletedSalesSteps(order: OperationalOrderLike, status: string): number {
  if (status === 'entregue') return SALES_PROGRESS_STAGES.length;
  if (status === 'concretizada_ml') return 5;
  if (SHIPPING_ORDER_STATUSES.includes(status as any)) return 5;
  if (status === 'recusado' || status === 'devolvido') return 5;

  let completed = 1;
  if (!isPreparationComplete(order)) return completed;
  completed = 2;
  if (!isFiscalComplete(order, status)) return completed;
  completed = 3;
  if (!isLabelComplete(order, status)) return completed;
  return 4;
}

export function getOrderSalesProgress(
  order: OperationalOrderLike,
  _at = Date.now(),
): OrderSalesProgress {
  const status = normalizeOrderStatus(order);
  const completedSteps = inferCompletedSalesSteps(order, status);
  const currentStep = Math.min(completedSteps + 1, SALES_PROGRESS_STAGES.length);
  const rejected = String(order.dslite_status || '').toLowerCase().includes('rejeitado');
  const failed = order.dslite_label_operational_status === 'failed'
    || order.whatsapp_label_status === 'failed';
  const interrupted = status === 'cancelado' || status === 'recusado' || status === 'devolvido';
  const hasOperationalError = interrupted
    || Boolean(order.has_split_fulfillment)
    || Boolean(order.ml_claim_id)
    || rejected
    || failed;

  let nextLabel: string;
  if (status === 'entregue') nextLabel = 'Concluída';
  else if (status === 'concretizada_ml') nextLabel = 'Concretizada pelo ML, sem entrega confirmada';
  else if (status === 'cancelado') nextLabel = 'Fluxo encerrado: venda cancelada';
  else if (status === 'recusado') nextLabel = 'Entrega recusada';
  else if (status === 'devolvido') nextLabel = 'Venda devolvida';
  else if (order.has_split_fulfillment) nextLabel = 'Revise o fluxo dividido';
  else if (order.ml_claim_id) nextLabel = 'Trate a reclamação no Mercado Livre';
  else if (rejected) nextLabel = 'Desvincule a compra DSLite rejeitada';
  else if (order.dslite_label_operational_status === 'failed') nextLabel = 'Revise o envio da etiqueta para a DSLite';
  else if (order.whatsapp_label_status === 'failed') nextLabel = 'Revise o envio da etiqueta por WhatsApp';
  else if (order.whatsapp_label_status === 'on_hold') nextLabel = 'Aguarde a nova tentativa do WhatsApp';
  else {
    if (currentStep === 2) nextLabel = resolvePreparationNextLabel(order);
    else if (currentStep === 3) {
      nextLabel = order.dslite_next_action === 'complete_dslite_label'
        ? 'Emita a nota fiscal e complete a etiqueta'
        : 'Emita a nota fiscal';
    } else if (currentStep === 4) {
      nextLabel = order.dslite_next_action === 'wait_ml_label'
        ? 'Aguarde a liberação da etiqueta'
        : order.dslite_next_action === 'complete_dslite_label'
          ? 'Complete a etiqueta'
          : 'Gere a etiqueta de envio';
    } else if (currentStep === 5) nextLabel = 'Despache o pedido';
    else if (status === 'dest_ausente') nextLabel = 'Acompanhe a nova tentativa de entrega';
    else nextLabel = 'Acompanhe a entrega';
  }

  return {
    completedSteps,
    currentStep,
    currentLabel: SALES_PROGRESS_STAGES[currentStep - 1],
    nextLabel,
    tone: status === 'entregue' ? 'success' : hasOperationalError ? 'error' : 'normal',
  };
}

export function matchesOrdersOperationalView(
  order: OperationalOrderLike,
  view: OrdersOperationalView,
  delayedAfterMinutes: number,
): boolean {
  const status = normalizeOrderStatus(order);
  if (view === 'urgent') return getOperationalUrgencyReasons(order, delayedAfterMinutes).length > 0;
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
