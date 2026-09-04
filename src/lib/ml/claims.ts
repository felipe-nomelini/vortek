import { BUSINESS_TIME_ZONE } from '@/lib/timezone';

export type ClaimStatus = 'opened' | 'closed' | string;
export type ClaimStage = 'claim' | 'dispute' | 'recontact' | 'none' | 'stale' | string;
export type ClaimType =
  | 'mediations'
  | 'return'
  | 'fulfillment'
  | 'ml_case'
  | 'cancel_sale'
  | 'cancel_purchase'
  | 'change'
  | 'service'
  | string;
export type ClaimResponsible = 'seller' | 'buyer' | 'mediator' | null;
export type ClaimPriority = 'overdue' | 'due_today' | 'seller_action' | 'waiting' | 'closed' | 'unknown';

export type ClaimAvailableAction = {
  action: string;
  mandatory: boolean;
  due_date: string | null;
};

export function normalizeClaimAvailableActions(value: unknown): ClaimAvailableAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ClaimAvailableAction[] => {
    if (!raw || typeof raw !== 'object') return [];
    const source = raw as Record<string, unknown>;
    const action = source.action === null || source.action === undefined ? '' : String(source.action).trim();
    if (!action) return [];
    return [{
      action,
      mandatory: source.mandatory === true,
      due_date: source.due_date ? String(source.due_date) : null,
    }];
  });
}

export type ClaimListItem = {
  id: string;
  order_id: string;
  customer_name: string | null;
  buyer_id: string | null;
  item_id: string | null;
  item_title: string | null;
  item_count: number;
  type: ClaimType | null;
  type_label: string;
  stage: ClaimStage | null;
  stage_label: string;
  status: ClaimStatus | null;
  status_label: string;
  reason_id: string | null;
  problem: string | null;
  detail_title: string | null;
  detail_description: string | null;
  action_responsible: ClaimResponsible;
  responsible_label: string;
  due_date: string | null;
  priority: ClaimPriority;
  available_actions: ClaimAvailableAction[];
  related_entities: string[];
  resolution: Record<string, unknown> | null;
  claimed_quantity: number | null;
  date_created: string | null;
  last_updated: string | null;
  context_available: boolean;
  is_homologation_fixture: boolean;
};

export type ClaimSummary = {
  opened: number;
  due_on_page: number;
  dispute: number;
  updated_today: number;
};

export type ClaimsListResponse = {
  conectado: boolean;
  precisaReconectar: boolean;
  items: ClaimListItem[];
  paging: { total: number; page: number; page_size: number };
  summary: ClaimSummary;
  updated_at: string;
  erro?: string;
  partial?: { order_context?: boolean; claim_details?: boolean; summary?: boolean };
  visual_review?: {
    enabled: true;
    source: 'official-contract-synthetic';
    captured_at: string;
    expires_at: string;
  };
};

export type ClaimMessage = {
  hash: string | null;
  sender_role: string | null;
  receiver_role: string | null;
  message: string | null;
  date_created: string | null;
  status: string | null;
  stage: string | null;
  attachments: Array<{
    filename: string;
    original_filename: string | null;
    type: string | null;
    size: number | null;
  }>;
};

export type ClaimActionHistory = {
  action_name: string | null;
  player_role: string | null;
  claim_stage: string | null;
  claim_status: string | null;
  date_created: string | null;
};

export type ClaimStatusHistory = {
  stage: string | null;
  status: string | null;
  date: string | null;
  change_by: string | null;
};

export type ClaimDetailResponse = {
  claim: ClaimListItem;
  reason: { id: string; name: string | null; detail: string | null; flow: string | null } | null;
  messages: ClaimMessage[];
  actions_history: ClaimActionHistory[];
  status_history: ClaimStatusHistory[];
  affects_reputation: {
    affects_reputation: 'affected' | 'not_affected' | 'not_applies' | string | null;
    has_incentive: boolean | null;
    due_date: string | null;
  } | null;
  unavailable_sections: string[];
  visual_review?: ClaimsListResponse['visual_review'];
};

export function claimTypeLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    mediations: 'Reclamação',
    return: 'Devolução',
    fulfillment: 'Envio Full',
    ml_case: 'Caso Mercado Livre',
    cancel_sale: 'Cancelamento pelo vendedor',
    cancel_purchase: 'Cancelamento pelo comprador',
    change: 'Troca',
    service: 'Serviço',
  };
  return value ? labels[value] || value : 'Não informado';
}

export function claimStageLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    claim: 'Negociação',
    dispute: 'Mediação',
    recontact: 'Recontato',
    none: 'Não se aplica',
    stale: 'Tratativa Mercado Livre',
  };
  return value ? labels[value] || value : 'Não informado';
}

export function claimStatusLabel(value: string | null | undefined): string {
  if (value === 'opened') return 'Aberta';
  if (value === 'closed') return 'Encerrada';
  return value || 'Não informado';
}

export function claimResponsibleLabel(value: ClaimResponsible): string {
  if (value === 'seller') return 'Você';
  if (value === 'buyer') return 'Comprador';
  if (value === 'mediator') return 'Mercado Livre';
  return 'Não informado';
}

function dateKey(value: string | Date): string | null {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function classifyClaimPriority(input: {
  status: string | null | undefined;
  responsible: ClaimResponsible;
  dueDate: string | null | undefined;
  now?: Date;
}): ClaimPriority {
  if (input.status === 'closed') return 'closed';
  if (input.status !== 'opened') return 'unknown';
  if (input.responsible !== 'seller') return 'waiting';
  if (!input.dueDate) return 'seller_action';

  const due = new Date(input.dueDate);
  const now = input.now || new Date();
  if (Number.isNaN(due.getTime())) return 'seller_action';
  if (due.getTime() < now.getTime()) return 'overdue';
  if (dateKey(due) === dateKey(now)) return 'due_today';
  return 'seller_action';
}

const PRIORITY_WEIGHT: Record<ClaimPriority, number> = {
  overdue: 0,
  due_today: 1,
  seller_action: 2,
  waiting: 3,
  unknown: 4,
  closed: 5,
};

export function compareClaimPriority(left: ClaimListItem, right: ClaimListItem): number {
  const priorityDifference = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
  if (priorityDifference !== 0) return priorityDifference;

  const leftDue = left.due_date ? Date.parse(left.due_date) : Number.POSITIVE_INFINITY;
  const rightDue = right.due_date ? Date.parse(right.due_date) : Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;

  return Date.parse(right.last_updated || right.date_created || '1970-01-01')
    - Date.parse(left.last_updated || left.date_created || '1970-01-01');
}

export function claimActionLabel(value: string): string {
  const labels: Record<string, string> = {
    send_message_to_complainant: 'Responder ao comprador',
    send_message_to_mediator: 'Responder ao Mercado Livre',
    refund: 'Reembolsar comprador',
    open_dispute: 'Pedir mediação',
    send_potential_shipping: 'Informar previsão de envio',
    add_shipping_evidence: 'Enviar comprovante de envio',
    send_attachments: 'Enviar anexos',
    allow_return: 'Autorizar devolução',
    allow_return_label: 'Gerar etiqueta de devolução',
    allow_partial_refund: 'Oferecer reembolso parcial',
    send_tracking_number: 'Informar rastreamento',
    return_review: 'Revisar produto devolvido',
    return_review_ok: 'Aprovar produto devolvido',
    return_review_fail: 'Contestar produto devolvido',
  };
  return labels[value] || value.replaceAll('_', ' ');
}

export function claimRoleLabel(value: string | null | undefined): string {
  if (value === 'respondent' || value === 'seller') return 'Você';
  if (value === 'complainant' || value === 'buyer') return 'Comprador';
  if (value === 'mediator') return 'Mercado Livre';
  return value || 'Não informado';
}
