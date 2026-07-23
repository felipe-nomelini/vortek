import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { runWhatsappLabelJob } from '@/services/whatsapp-label-job';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId é obrigatório' }, { status: 400 });

  const client = createServiceClient();
  const { data, error } = await client
    .from('jobs')
    .select('id,tipo,status,progresso,total,processados,log,finished_at')
    .eq('id', jobId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
  }

  const log = Array.isArray(data.log)
    ? data.log
    : typeof data.log === 'string'
      ? JSON.parse(data.log || '[]')
      : [];
  const snapshots = Array.isArray(log) ? log.filter((x: any) => x?.event === 'progress_snapshot') : [];
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;

  const dbStatus = String(data.status || '');
  if (dbStatus === 'pendente') {
    const requestEntry = Array.isArray(log)
      ? log.find((entry: any) => entry?.event === 'request_received')
      : null;
    const payload = requestEntry?.payload;
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
          : 'running');

  return NextResponse.json({
    success: true,
    jobId: data.id,
    state,
    steps: latest?.steps || [],
    data: latest?.result || null,
    progress: data.progresso ?? 0,
    total: data.total ?? 0,
    processed: data.processados ?? 0,
    finishedAt: data.finished_at,
  });
}
