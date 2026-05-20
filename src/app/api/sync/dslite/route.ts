import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { runDsliteJob } from '@/services/sync-dslite-job';

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
    .select('id, status')
    .eq('tipo', 'sync_dslite')
    .eq('created_by', user.id)
    .in('status', ['pendente', 'rodando'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runningJob?.id) {
    return NextResponse.json({
      success: true,
      reused: true,
      jobId: runningJob.id,
      status: runningJob.status,
    });
  }

  const { data: insertedJob, error: jobInsertError } = await serviceClient
    .from('jobs')
    .insert({
      tipo: 'sync_dslite',
      status: 'pendente',
      progresso: 0,
      total: 4,
      processados: 0,
      log: [],
      cancelado: false,
      created_by: user.id,
    })
    .select('id, status')
    .single();

  if (jobInsertError || !insertedJob?.id) {
    return NextResponse.json(
      { error: jobInsertError?.message || 'Falha ao criar job de sincronização' },
      { status: 500 }
    );
  }

  setTimeout(() => {
    void runDsliteJob(insertedJob.id).catch(async (err: any) => {
      console.error('[sync-dslite] Falha real ao iniciar processamento em background:', err?.message || err);
      const { data: currentJob } = await serviceClient
        .from('jobs')
        .select('status, finished_at, log')
        .eq('id', insertedJob.id)
        .maybeSingle();

      if (!currentJob?.status || currentJob.finished_at || !['pendente', 'rodando'].includes(currentJob.status)) {
        return;
      }

      const currentLog = Array.isArray(currentJob.log)
        ? currentJob.log
        : typeof currentJob.log === 'string'
          ? (() => {
              try {
                return JSON.parse(currentJob.log || '[]');
              } catch {
                return [];
              }
            })()
          : [];

      await serviceClient
        .from('jobs')
        .update({
          status: 'erro',
          finished_at: new Date().toISOString(),
          log: [
            ...currentLog,
            {
              event_type: 'job_start_failed',
              type: 'error',
              message: `Falha real ao iniciar processamento: ${err?.message || 'erro desconhecido'}`,
              timestamp: new Date().toISOString(),
            },
          ],
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
    message: 'Sincronização DSLite iniciada em background',
  });
}
