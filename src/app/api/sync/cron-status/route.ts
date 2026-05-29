import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getMLAuthDiagnostics } from '@/services/integration';
import { SYNC_TASKS, getIntervalMinutesForTask, getSaoPauloHour } from '@/lib/sync/registry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

function extractLastErrorSummary(lastJob: any): {
  message: string | null;
  code: string | null;
  category: string | null;
  upstream_status: number | null;
  at: string | null;
} | null {
  if (!lastJob) return null;
  const logs = parseLog(lastJob.log);
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i] || {};
    if (entry?.type !== 'error') continue;
    const nested = Array.isArray(entry?.errors) && entry.errors.length > 0 ? entry.errors[0] : null;
    return {
      message: entry?.message || entry?.erro || entry?.error || nested?.message || null,
      code: entry?.code || entry?.error_code || nested?.code || null,
      category: entry?.category || entry?.error_category || nested?.category || null,
      upstream_status: Number(entry?.upstream_status ?? nested?.upstream_status ?? entry?.http_status) || null,
      at: entry?.timestamp || null,
    };
  }
  return null;
}

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
      .select('id, status, created_at, finished_at, log')
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
      last: last ? {
        id: last.id,
        status: last.status,
        created_at: last.created_at,
        finished_at: last.finished_at,
      } : null,
      last_error_summary: extractLastErrorSummary(last),
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
