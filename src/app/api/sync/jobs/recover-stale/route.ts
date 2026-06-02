import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { DEFAULT_STALE_JOB_THRESHOLD_MINUTES, isJobStale, markJobAsStale } from '@/lib/sync/stale-jobs';

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tipoFilter = String(body?.tipo || '').trim();

  const serviceClient = createServiceClient();
  let query = serviceClient
    .from('jobs')
    .select('id, tipo, status, created_at, finished_at, log')
    .in('status', ['pendente', 'rodando'])
    .order('created_at', { ascending: true });

  if (tipoFilter) {
    query = query.eq('tipo', tipoFilter);
  }

  const { data: jobs, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recovered = [];
  const skipped = [];

  for (const job of jobs || []) {
    if (!isJobStale(job as any, DEFAULT_STALE_JOB_THRESHOLD_MINUTES)) {
      skipped.push({
        id: job.id,
        tipo: job.tipo,
        status: job.status,
        reason: 'fresh_job',
      });
      continue;
    }

    const result = await markJobAsStale(job as any);
    recovered.push(result);
  }

  return NextResponse.json({
    success: true,
    stale_threshold_minutes: DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
    recovered_count: recovered.length,
    skipped_count: skipped.length,
    recovered,
    skipped,
  });
}
