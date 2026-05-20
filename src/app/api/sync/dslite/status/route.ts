import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

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
      .select('id, tipo, status, progresso, processados, total, log, finished_at, created_by, created_at')
      .eq('id', jobId)
      .eq('tipo', 'sync_dslite')
      .eq('created_by', user.id)
      .single();
    job = result.data;
    error = result.error;
  } else {
    const result = await serviceClient
      .from('jobs')
      .select('id, tipo, status, progresso, processados, total, log, finished_at, created_by, created_at')
      .eq('tipo', 'sync_dslite')
      .eq('created_by', user.id)
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    job = result.data;
    error = result.error;
  }

  if (error) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
  }

  if (!job) {
    return NextResponse.json({
      success: true,
      job: null,
      failures: [],
    });
  }

  let logs: any[] = [];
  if (Array.isArray(job.log)) {
    logs = job.log as any[];
  } else if (typeof job.log === 'string') {
    try {
      logs = JSON.parse(job.log || '[]');
    } catch {
      logs = [];
    }
  }
  const failures = logs
    .filter((entry: any) => entry?.type === 'error')
    .map((entry: any) => entry?.message)
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
    failures,
  });
}
