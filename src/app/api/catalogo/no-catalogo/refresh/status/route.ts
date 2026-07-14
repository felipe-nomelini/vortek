import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

const JOB_TIPO = 'catalogo_no_catalogo_refresh';

function parseLog(log: unknown): any[] {
  if (Array.isArray(log)) return log;
  if (typeof log === 'string') {
    try {
      return JSON.parse(log || '[]');
    } catch {
      return [];
    }
  }
  return [];
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  const serviceClient = createServiceClient();

  let job: any = null;
  let error: any = null;

  if (jobId) {
    const result = await serviceClient
      .from('jobs')
      .select('id, tipo, status, progresso, processados, total, log, finished_at, created_at')
      .eq('id', jobId)
      .eq('tipo', JOB_TIPO)
      .single();

    job = result.data;
    error = result.error;
  } else {
    const runningResult = await serviceClient
      .from('jobs')
      .select('id, tipo, status, progresso, processados, total, log, finished_at, created_at')
      .eq('tipo', JOB_TIPO)
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runningResult.data?.id) {
      job = runningResult.data;
      error = runningResult.error;
    } else {
      const lastResult = await serviceClient
        .from('jobs')
        .select('id, tipo, status, progresso, processados, total, log, finished_at, created_at')
        .eq('tipo', JOB_TIPO)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      job = lastResult.data;
      error = lastResult.error;
    }
  }

  if (error) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
  }

  if (!job) {
    return NextResponse.json({ success: true, job: null, failures: [] });
  }

  const logs = parseLog(job.log);

  const failures = logs
    .filter((entry: any) => entry?.type === 'error')
    .map((entry: any) => entry?.message || entry?.erro || entry?.error)
    .filter(Boolean);

  const lastEvent = logs.length > 0 ? logs[logs.length - 1] : null;
  const updatedAt = lastEvent?.timestamp || job.finished_at || job.created_at || null;

  return NextResponse.json({
    success: true,
    job: {
      id: job.id,
      status: job.status,
      progresso: job.progresso ?? 0,
      processados: job.processados ?? 0,
      total: job.total ?? 0,
      finished_at: job.finished_at,
      last_event: lastEvent ? {
        event_type: lastEvent.event_type || null,
        message: lastEvent.message || null,
        timestamp: lastEvent.timestamp || null,
      } : null,
      updated_at: updatedAt,
    },
    events: logs
      .filter((entry: any) => String(entry?.event_type || '').startsWith('catalog_refresh_'))
      .slice(-40)
      .map((entry: any) => ({
        stage: entry.stage || null,
        message: entry.message || null,
        processed: entry.processed ?? null,
        total: entry.total ?? null,
        progress: entry.progress ?? null,
        timestamp: entry.timestamp || null,
      })),
    failures,
  });
}
