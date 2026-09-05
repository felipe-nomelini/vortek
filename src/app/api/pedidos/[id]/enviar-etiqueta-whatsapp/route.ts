import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { initWhatsappLabelJobSteps, runWhatsappLabelJob } from '@/services/whatsapp-label-job';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  findReusableJob,
  getLatestJobSnapshot,
  isJobUniqueViolation,
  normalizeIdempotencyKey,
} from '@/services/job-idempotency';
import {
  HOMOLOGATION_FIXTURE_READ_ONLY_ERROR,
  isHomologationFixtureSource,
} from '@/lib/homologation-fixture';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 90;

function resolveAppBaseUrl(request: Request): string {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await authorizeApiRequest(request, 'sales.whatsapp_label.send');
    if (!auth.ok) return auth.response;

    const { phoneNumber, usePlaceholderLabel, idempotencyKey: bodyIdempotencyKey } = await request.json().catch(() => ({}));
    const normalizedPhone = String(phoneNumber || '').replace(/\D/g, '');
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Informe o número de WhatsApp do destinatário' }, { status: 400 });
    }

    const suppliedIdempotencyKey = request.headers.get('idempotency-key') || bodyIdempotencyKey;
    const idempotencyKey = suppliedIdempotencyKey
      ? normalizeIdempotencyKey(suppliedIdempotencyKey)
      : `web-${crypto.randomUUID()}`;
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Chave de idempotência inválida' }, { status: 400 });
    }

    const client = createServiceClient();
    const { data: pedido, error: pedidoError } = await client
      .from('pedidos')
      .select('snapshot_source,situacao')
      .eq('id', params.id)
      .maybeSingle();
    if (pedidoError) {
      return NextResponse.json({ error: 'Falha ao validar o pedido' }, { status: 500 });
    }
    if (!pedido) {
      return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
    }
    if (isHomologationFixtureSource((pedido as any)?.snapshot_source)) {
      return NextResponse.json(HOMOLOGATION_FIXTURE_READ_ONLY_ERROR, { status: 409 });
    }
    if ((pedido as any).situacao === 'concretizada_ml') {
      return NextResponse.json(
        { error: 'Venda já concretizada pelo Mercado Livre. Etiqueta não será reenviada.' },
        { status: 409 },
      );
    }
    const dedupeKey = `pedido:${params.id}`;
    const reusable = await findReusableJob({
      client,
      type: 'whatsapp_label_send',
      dedupeKey,
      idempotencyKey,
    });
    if (reusable) {
      const latest = getLatestJobSnapshot(reusable.job.log);
      return NextResponse.json({
        success: true,
        jobId: reusable.job.id,
        steps: latest?.steps || [],
        deduplicated: true,
        dedupeReason: reusable.reason,
      }, { status: 202 });
    }

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
      idempotencyKey,
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
        unidade_progresso: 'etapas',
        created_by: auth.userId,
        dedupe_key: dedupeKey,
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

    if (jobInsertError && isJobUniqueViolation(jobInsertError)) {
      const conflicted = await findReusableJob({
        client,
        type: 'whatsapp_label_send',
        dedupeKey,
        idempotencyKey,
      });
      if (conflicted) {
        const latest = getLatestJobSnapshot(conflicted.job.log);
        return NextResponse.json({
          success: true,
          jobId: conflicted.job.id,
          steps: latest?.steps || [],
          deduplicated: true,
          dedupeReason: conflicted.reason,
        }, { status: 202 });
      }
    }
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

    return NextResponse.json({ success: true, jobId, steps, deduplicated: false }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao iniciar envio de etiqueta por WhatsApp' }, { status: 500 });
  }
}
