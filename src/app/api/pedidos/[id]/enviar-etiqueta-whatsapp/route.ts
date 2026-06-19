import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
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

    await client.from('jobs').insert({
      id: jobId,
      tipo: 'whatsapp_label_send',
      status: 'pendente',
      progresso: 0,
      total: steps.length,
      processados: 0,
      cancelado: false,
      log: JSON.parse(JSON.stringify([
        {
          event: 'progress_snapshot',
          at: new Date().toISOString(),
          state: 'running',
          steps,
          payload: {
            pedidoId: params.id,
            phone_suffix: normalizedPhone.slice(-8),
            usePlaceholderLabel: Boolean(usePlaceholderLabel),
          },
        },
      ])),
    });

    void runWhatsappLabelJob({
      jobId,
      pedidoId: params.id,
      phoneNumber: normalizedPhone,
      usePlaceholderLabel: Boolean(usePlaceholderLabel),
      appBaseUrl,
    });

    return NextResponse.json({ success: true, jobId, steps }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao iniciar envio de etiqueta por WhatsApp' }, { status: 500 });
  }
}
