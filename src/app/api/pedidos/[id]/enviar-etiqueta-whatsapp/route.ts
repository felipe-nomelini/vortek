import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { initWhatsappLabelJobSteps, runWhatsappLabelJob } from '@/services/whatsapp-label-job';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 90;

function resolveAppBaseUrl(request: Request): string {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { phoneNumber, usePlaceholderLabel } = await request.json().catch(() => ({}));
    const normalizedPhone = String(phoneNumber || '').replace(/\D/g, '');
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Informe o número de WhatsApp do destinatário' }, { status: 400 });
    }

    const client = createServiceClient();
    const jobId = crypto.randomUUID();
    const steps = initWhatsappLabelJobSteps();
    const appBaseUrl = resolveAppBaseUrl(request);
    const requestedAt = new Date().toISOString();
    const requestPayload = {
      pedidoId: params.id,
      phoneNumber: normalizedPhone,
      phone_suffix: normalizedPhone.slice(-8),
      usePlaceholderLabel: Boolean(usePlaceholderLabel),
      appBaseUrl,
    };

    const { data: insertedJob, error: jobInsertError } = await client
      .from('jobs')
      .insert({
        id: jobId,
        tipo: 'whatsapp_label_send',
        status: 'pendente',
        progresso: 0,
        total: steps.length,
        processados: 0,
        cancelado: false,
        log: JSON.parse(JSON.stringify([
          {
            event: 'request_received',
            at: requestedAt,
            payload: requestPayload,
          },
          {
            event: 'progress_snapshot',
            at: requestedAt,
            state: 'running',
            steps,
            result: null,
          },
        ])),
      })
      .select('id')
      .single();

    if (jobInsertError || !insertedJob?.id) {
      return NextResponse.json(
        { error: jobInsertError?.message || 'Falha ao registrar tentativa de envio por WhatsApp' },
        { status: 500 },
      );
    }

    await registrarEventoNfAuditoria({
      pedidoId: params.id,
      evento: 'whatsapp_label_send_requested',
      payloadEnviado: {
        job_id: jobId,
        phone_suffix: normalizedPhone.slice(-8),
        test_placeholder_label: Boolean(usePlaceholderLabel),
      },
      statusResultante: 'requested',
    });

    void runWhatsappLabelJob({
      jobId,
      pedidoId: params.id,
      phoneNumber: normalizedPhone,
      usePlaceholderLabel: Boolean(usePlaceholderLabel),
      appBaseUrl,
    }).catch((err: any) => {
      console.error('[whatsapp-label-job] Falha não tratada:', err?.message || err);
    });

    return NextResponse.json({ success: true, jobId, steps }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao iniciar envio de etiqueta por WhatsApp' }, { status: 500 });
  }
}
