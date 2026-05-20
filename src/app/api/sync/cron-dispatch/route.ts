import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { runMlSingleStageJob } from '@/services/sync-ml-job';

export const maxDuration = 300;

type CronTask = {
  key: 'dslite_stock' | 'dslite_catalog' | 'ml_anuncios' | 'ml_pedidos';
  jobTipo: string;
  path: string;
  label: string;
  intervalMinutes: (hour: number) => number;
  progressiveOffset?: boolean;
};

const TASKS: CronTask[] = [
  {
    key: 'dslite_stock',
    jobTipo: 'sync_dslite_stock',
    path: '/api/sync/preco-estoque',
    label: 'DSLite Preço/Estoque',
    intervalMinutes: (hour) => (hour >= 0 && hour < 7 ? 20 : 10),
  },
  {
    key: 'dslite_catalog',
    jobTipo: 'sync_dslite_catalog',
    path: '/api/sync/catalogo',
    label: 'DSLite Catálogo',
    intervalMinutes: (hour) => (hour >= 8 && hour < 22 ? 120 : 240),
  },
  {
    key: 'ml_anuncios',
    jobTipo: 'sync_anuncios_ml',
    path: '/api/sync/anuncios',
    label: 'ML Anúncios',
    intervalMinutes: () => 30,
    progressiveOffset: true,
  },
  {
    key: 'ml_pedidos',
    jobTipo: 'sync_pedidos_ml',
    path: '/api/sync/pedidos',
    label: 'ML Pedidos',
    intervalMinutes: (hour) => (hour >= 8 && hour < 23 ? 15 : 30),
    progressiveOffset: true,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function getSaoPauloHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  return Number(hour);
}

function parseLog(log: any): any[] {
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOffsetFromJobLog(log: any): number {
  const logs = parseLog(log);
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i] || {};
    if (entry.event_type === 'job_stage_done') {
      if (entry.acabou === true || entry.proximo === null) {
        return 0;
      }
      const proximo = Number(entry.proximo);
      if (Number.isFinite(proximo) && proximo >= 0) {
        return proximo;
      }
    }
  }
  return 0;
}

function consecutiveFailures(statuses: string[]): number {
  let count = 0;
  for (const s of statuses) {
    if (s === 'completo') break;
    count++;
  }
  return count;
}

function shouldApplyBackoff(lastStatuses: string[]): boolean {
  const firstTwo = lastStatuses.slice(0, 2);
  if (firstTwo.length < 2) return true;
  return !(firstTwo[0] === 'completo' && firstTwo[1] === 'completo');
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  const jitterMs = 10_000 + Math.floor(Math.random() * 20_000);
  await sleep(jitterMs);

  const serviceClient = createServiceClient();
  const hour = getSaoPauloHour();

  const results: any[] = [];

  for (const task of TASKS) {
    const intervalMinutes = task.intervalMinutes(hour);

    const { data: running } = await serviceClient
      .from('jobs')
      .select('id, status')
      .eq('tipo', task.jobTipo)
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (running?.id) {
      results.push({
        task: task.key,
        action: 'skipped_running',
        jobId: running.id,
        status: running.status,
      });
      continue;
    }

    const { data: recentJobs } = await serviceClient
      .from('jobs')
      .select('id, status, finished_at, created_at, log')
      .eq('tipo', task.jobTipo)
      .order('created_at', { ascending: false })
      .limit(6);

    const recent = recentJobs || [];
    const statuses = recent.map((j: any) => String(j.status || ''));
    const failureStreak = consecutiveFailures(statuses);
    const backoffMinutes = shouldApplyBackoff(statuses) && failureStreak > 0 ? 10 : 0;

    const lastFinished = recent.find((j: any) => Boolean(j.finished_at));
    if (lastFinished?.finished_at) {
      const lastMs = new Date(lastFinished.finished_at).getTime();
      const nextDueMs = lastMs + (intervalMinutes + backoffMinutes) * 60 * 1000;
      if (Date.now() < nextDueMs) {
        results.push({
          task: task.key,
          action: 'skipped_not_due',
          interval_minutes: intervalMinutes,
          backoff_minutes: backoffMinutes,
          next_due_at: new Date(nextDueMs).toISOString(),
          consecutive_failures: failureStreak,
        });
        continue;
      }
    }

    let offset = 0;
    if (task.progressiveOffset && recent.length > 0) {
      offset = extractOffsetFromJobLog(recent[0].log);
    }

    const initialLog = [
      {
        event_type: 'cron_dispatch',
        type: 'info',
        message: `Disparo automático: ${task.label}`,
        timestamp: nowIso(),
        task: task.key,
        interval_minutes: intervalMinutes,
        backoff_minutes: backoffMinutes,
        consecutive_failures: failureStreak,
        offset,
      },
      ...(failureStreak >= 3
        ? [{
            event_type: 'cron_alert',
            type: 'error',
            message: `Alerta: ${failureStreak} falhas consecutivas em ${task.label}`,
            timestamp: nowIso(),
            task: task.key,
          }]
        : []),
    ];

    const { data: insertedJob, error: jobInsertError } = await serviceClient
      .from('jobs')
      .insert({
        tipo: task.jobTipo,
        status: 'pendente',
        progresso: 0,
        total: 1,
        processados: 0,
        log: initialLog,
        cancelado: false,
        created_by: null,
      })
      .select('id')
      .single();

    if (jobInsertError || !insertedJob?.id) {
      results.push({
        task: task.key,
        action: 'insert_error',
        error: jobInsertError?.message || 'Falha ao criar job',
      });
      continue;
    }

    setTimeout(() => {
      void runMlSingleStageJob({
        jobId: insertedJob.id,
        tipo: task.jobTipo,
        path: task.path,
        label: task.label,
        query: task.progressiveOffset ? { offset } : undefined,
      }).catch((err: any) => {
        console.error('[cron-dispatch] erro ao executar job', task.key, err?.message || err);
      });
    }, 0);

    results.push({
      task: task.key,
      action: 'dispatched',
      jobId: insertedJob.id,
      interval_minutes: intervalMinutes,
      backoff_minutes: backoffMinutes,
      offset,
    });
  }

  return NextResponse.json({
    success: true,
    jitter_ms: jitterMs,
    timezone: 'America/Sao_Paulo',
    hour,
    results,
  });
}
