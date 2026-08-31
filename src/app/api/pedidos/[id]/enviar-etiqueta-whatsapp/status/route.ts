import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  getWhatsappLabelJobRequest,
  getWhatsappLabelRetry,
  isWhatsappLabelJobDue,
  parseWhatsappLabelJobLog,
  runWhatsappLabelJob,
} from '@/services/whatsapp-label-job';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId é obrigatório' }, { status: 400 });

  const client = createServiceClient();
  const { data, error } = await client
    .from('jobs')
    .select('id,tipo,status,progresso,total,processados,unidade_progresso,log,finished_at')
    .eq('id', jobId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
  }

  const log = parseWhatsappLabelJobLog(data.log);
  const snapshots = Array.isArray(log) ? log.filter((x: any) => x?.event === 'progress_snapshot') : [];
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;

  const dbStatus = String(data.status || '');
  if (dbStatus === 'pendente' || (dbStatus === 'on_hold' && isWhatsappLabelJobDue(log))) {
    const payload = getWhatsappLabelJobRequest(log);
    if (
      payload?.pedidoId === params.id
      && payload?.phoneNumber
      && payload?.appBaseUrl
    ) {
      void runWhatsappLabelJob({
        jobId: data.id,
        pedidoId: payload.pedidoId,
        phoneNumber: payload.phoneNumber,
        usePlaceholderLabel: Boolean(payload.usePlaceholderLabel),
        appBaseUrl: payload.appBaseUrl,
      }).catch((err: any) => {
        console.error('[whatsapp-label-job] Falha ao retomar job pendente:', err?.message || err);
      });
    }
  }

  const state = latest?.state
    || (dbStatus === 'completo' ? 'success'
      : dbStatus === 'completo_parcial' ? 'warning'
        : dbStatus === 'erro' ? 'error'
          : dbStatus === 'on_hold' ? 'on_hold'
          : 'running');
  const retry = getWhatsappLabelRetry(log);

  return NextResponse.json({
    success: true,
    jobId: data.id,
    state,
    steps: latest?.steps || [],
    data: latest?.result || null,
    progress: data.progresso ?? 0,
    total: data.total ?? 0,
    processed: data.processados ?? 0,
    progressUnit: data.unidade_progresso,
    finishedAt: data.finished_at,
    nextRetryAt: retry.nextRetryAt,
    retryAttempt: retry.attempt,
  });
}
