import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { runMlSingleStageJob } from '@/services/sync-ml-job';
import { DEFAULT_STALE_JOB_THRESHOLD_MINUTES, isJobStale, markJobAsStale } from '@/lib/sync/stale-jobs';

export const maxDuration = 300;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  const { data: runningJob } = await serviceClient
    .from('jobs')
    .select('id, tipo, status, created_at, finished_at, log')
    .eq('tipo', 'sync_ml_listings_observed')
    .eq('created_by', user.id)
    .in('status', ['pendente', 'rodando'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runningJob?.id) {
    if (isJobStale(runningJob as any, DEFAULT_STALE_JOB_THRESHOLD_MINUTES)) {
      await markJobAsStale(runningJob as any);
    } else {
      return NextResponse.json({
        success: true,
        reused: true,
        jobId: runningJob.id,
        status: runningJob.status,
      });
    }
  }

  if (runningJob?.id) {
    return NextResponse.json({
      success: true,
      recoveredStale: true,
      staleThresholdMinutes: DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
      previousJobId: runningJob.id,
    });
  }
  const { data: insertedJob, error: jobInsertError } = await serviceClient
    .from('jobs')
    .insert({
      tipo: 'sync_ml_listings_observed',
      status: 'pendente',
      progresso: 0,
      total: 1,
      processados: 0,
      log: [],
      cancelado: false,
      created_by: user.id,
    })
    .select('id, status')
    .single();

  if (jobInsertError || !insertedJob?.id) {
    return NextResponse.json(
      { error: jobInsertError?.message || 'Falha ao criar job de sincronização de anúncios' },
      { status: 500 },
    );
  }

  setTimeout(() => {
    void runMlSingleStageJob({
      jobId: insertedJob.id,
      tipo: 'sync_ml_listings_observed',
      path: '/api/sync/anuncios',
      label: 'Sync ML Anúncios Observado',
    }).catch(async (err: any) => {
      console.error('[sync-anuncios-job] Falha ao iniciar processamento em background:', err?.message || err);
      const { data: currentJob } = await serviceClient
        .from('jobs')
        .select('status, finished_at')
        .eq('id', insertedJob.id)
        .maybeSingle();

      if (!currentJob?.status || currentJob.finished_at || !['pendente', 'rodando'].includes(currentJob.status)) {
        return;
      }

      await serviceClient
        .from('jobs')
        .update({
          status: 'erro',
          finished_at: new Date().toISOString(),
        })
        .eq('id', insertedJob.id)
        .in('status', ['pendente', 'rodando']);
    });
  }, 0);

  return NextResponse.json({
    success: true,
    reused: false,
    jobId: insertedJob.id,
    status: insertedJob.status,
    message: 'Sincronização de anúncios iniciada em background',
  });
}
