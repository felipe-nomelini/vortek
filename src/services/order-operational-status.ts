import type { createServiceClient } from '@/lib/supabase';
import type {
  DsliteLabelOperationalStatus,
  WhatsappLabelOperationalStatus,
} from '@/lib/orders/operational-view';

const WHATSAPP_AUDIT_EVENTS = [
  'whatsapp_label_send_requested',
  'whatsapp_label_send_success',
  'whatsapp_label_send_failed',
] as const;

const DSLITE_LABEL_AUDIT_EVENTS = [
  'placeholder_label_send_success',
  'placeholder_label_send_failed',
  'ml_label_send_success',
  'ml_label_send_failed',
] as const;

const OPERATIONAL_AUDIT_EVENTS = [
  ...WHATSAPP_AUDIT_EVENTS,
  ...DSLITE_LABEL_AUDIT_EVENTS,
] as const;

type ServiceClient = ReturnType<typeof createServiceClient>;

type OperationalAuditRow = {
  pedido_id: string | null;
  evento: string;
  status_resultante: string | null;
  resposta_ml: Record<string, unknown> | null;
  created_at: string;
};

function mapWhatsappStatus(event: OperationalAuditRow): WhatsappLabelOperationalStatus {
  if (event.evento === 'whatsapp_label_send_success') {
    return event.resposta_ml?.test_placeholder_label === true ? 'test_sent' : 'sent';
  }
  if (event.evento === 'whatsapp_label_send_requested') return 'pending';
  if (event.status_resultante === 'on_hold') return 'on_hold';
  return 'failed';
}

function mapDsliteLabelStatus(event: OperationalAuditRow): DsliteLabelOperationalStatus {
  if (event.evento === 'ml_label_send_success') return 'real_sent';
  if (event.evento === 'placeholder_label_send_success') return 'generic_sent';
  return 'failed';
}

export async function enrichOrdersWithWhatsappStatus<T extends {
  id?: string | null;
  dslite_etiqueta_enviada?: boolean | null;
  dslite_label_source?: string | null;
}>(
  rows: T[],
  serviceClient: ServiceClient,
): Promise<Array<T & {
  dslite_label_operational_status: DsliteLabelOperationalStatus;
  dslite_label_operational_updated_at: string | null;
  dslite_label_operational_error: string | null;
  whatsapp_label_status: WhatsappLabelOperationalStatus;
  whatsapp_label_updated_at: string | null;
  whatsapp_label_error: string | null;
  whatsapp_label_next_retry_at: string | null;
}>> {
  const pedidoIds = Array.from(new Set(
    rows.map((row) => String(row.id || '').trim()).filter(Boolean),
  ));
  if (!pedidoIds.length) {
    return rows.map((row) => ({
      ...row,
      dslite_label_operational_status:
        row.dslite_label_source === 'dslite_paid_shipping'
          ? 'provider_shipping' as const
          : row.dslite_etiqueta_enviada
            ? 'sent_unverified' as const
            : 'pending' as const,
      dslite_label_operational_updated_at: null,
      dslite_label_operational_error: null,
      whatsapp_label_status: 'not_sent' as const,
      whatsapp_label_updated_at: null,
      whatsapp_label_error: null,
      whatsapp_label_next_retry_at: null,
    }));
  }

  const latestWhatsappByPedido = new Map<string, OperationalAuditRow>();
  const latestDsliteLabelByPedido = new Map<string, OperationalAuditRow>();
  let auditReadFailed = false;

  for (let index = 0; index < pedidoIds.length; index += 100) {
    const chunk = pedidoIds.slice(index, index + 100);
    const { data, error } = await serviceClient
      .from('nf_auditoria_eventos')
      .select('pedido_id,evento,status_resultante,resposta_ml,created_at')
      .in('pedido_id', chunk)
      .in('evento', [...OPERATIONAL_AUDIT_EVENTS])
      .order('created_at', { ascending: false });

    if (error) {
      auditReadFailed = true;
      console.error('[order-operational-status] Falha ao consultar auditoria WhatsApp:', error.message);
      continue;
    }

    for (const raw of data || []) {
      const event = raw as unknown as OperationalAuditRow;
      const pedidoId = String(event.pedido_id || '');
      if (!pedidoId) continue;
      if (
        WHATSAPP_AUDIT_EVENTS.includes(event.evento as any)
        && !latestWhatsappByPedido.has(pedidoId)
      ) {
        latestWhatsappByPedido.set(pedidoId, event);
      }
      if (
        DSLITE_LABEL_AUDIT_EVENTS.includes(event.evento as any)
        && !latestDsliteLabelByPedido.has(pedidoId)
      ) {
        latestDsliteLabelByPedido.set(pedidoId, event);
      }
    }
  }

  return rows.map((row) => {
    const pedidoId = String(row.id || '');
    const whatsappEvent = latestWhatsappByPedido.get(pedidoId);
    const dsliteLabelEvent = latestDsliteLabelByPedido.get(pedidoId);
    const whatsappResponse = whatsappEvent?.resposta_ml || {};
    const dsliteLabelResponse = dsliteLabelEvent?.resposta_ml || {};
    const usesProviderShipping = row.dslite_label_source === 'dslite_paid_shipping';
    return {
      ...row,
      dslite_label_operational_status: usesProviderShipping
        ? 'provider_shipping'
        : dsliteLabelEvent
          ? mapDsliteLabelStatus(dsliteLabelEvent)
          : auditReadFailed
            ? 'unknown'
            : row.dslite_etiqueta_enviada
              ? 'sent_unverified'
              : 'pending',
      dslite_label_operational_updated_at: dsliteLabelEvent?.created_at || null,
      dslite_label_operational_error: String(dsliteLabelResponse.error || '').trim() || null,
      whatsapp_label_status: whatsappEvent
        ? mapWhatsappStatus(whatsappEvent)
        : auditReadFailed
          ? 'unknown'
          : 'not_sent',
      whatsapp_label_updated_at: whatsappEvent?.created_at || null,
      whatsapp_label_error: String(whatsappResponse.error || '').trim() || null,
      whatsapp_label_next_retry_at: String(whatsappResponse.next_retry_at || '').trim() || null,
    };
  });
}
