import { createServiceClient } from '@/lib/supabase';

type AuditEvent = 'pre_validacao' | 'envio' | 'retorno_ml' | 'download_xml' | 'download_danfe';

export async function registrarEventoNfAuditoria(input: {
  pedidoId?: string | null;
  mlOrderId?: string | null;
  mlPackId?: string | null;
  evento: AuditEvent;
  payloadEnviado?: Record<string, any> | null;
  respostaMl?: Record<string, any> | null;
  statusResultante?: string | null;
}) {
  try {
    const client = createServiceClient();
    await client.from('nf_auditoria_eventos').insert({
      pedido_id: input.pedidoId || null,
      ml_order_id: input.mlOrderId || null,
      ml_pack_id: input.mlPackId || null,
      evento: input.evento,
      payload_enviado: input.payloadEnviado || null,
      resposta_ml: input.respostaMl || null,
      status_resultante: input.statusResultante || null,
    } as any);
  } catch (err: any) {
    console.error('[nf_auditoria] Falha ao registrar evento:', err?.message || err);
  }
}
