import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getMLAuthDiagnostics } from '@/services/integration';
import { SYNC_TASKS, getIntervalMinutesForTask, getSaoPauloHour } from '@/lib/sync/registry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const serviceClient = createServiceClient();
  const hour = getSaoPauloHour();
  const mlAuth = await getMLAuthDiagnostics();
  const tasks = SYNC_TASKS.filter((task) => task.schedule);

  const rows = await Promise.all(tasks.map(async (task) => {
    const interval = getIntervalMinutesForTask(task, hour);
    const { data: running } = await serviceClient
      .from('jobs')
      .select('id, status, created_at')
      .eq('tipo', task.jobTipo)
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: last } = await serviceClient
      .from('jobs')
      .select('id, status, created_at, finished_at')
      .eq('tipo', task.jobTipo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextRunEstimate = interval && last?.finished_at
      ? new Date(new Date(last.finished_at).getTime() + interval * 60 * 1000).toISOString()
      : null;

    return {
      task: task.key,
      tipo: task.jobTipo,
      label: task.label,
      domain: task.domain,
      kind: task.kind,
      interval_minutes: interval,
      running: running || null,
      last: last || null,
      next_run_estimate: nextRunEstimate,
    };
  }));

  return NextResponse.json({
    success: true,
    timezone: 'America/Sao_Paulo',
    hour,
    ml_auth: mlAuth,
    tasks: rows,
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

