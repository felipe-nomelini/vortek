import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { runMlSingleStageJob } from '@/services/sync-ml-job';
import { getMLAuthDiagnostics } from '@/services/integration';
import { SYNC_TASKS, getIntervalMinutesForTask, getSaoPauloHour } from '@/lib/sync/registry';
import { DEFAULT_STALE_JOB_THRESHOLD_MINUTES, isJobStale, markJobAsStale } from '@/lib/sync/stale-jobs';

export const maxDuration = 300;

function nowIso() {
  return new Date().toISOString();
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
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i] || {};
    const fromCursor = Number(entry?.cursor?.offset);
    if (Number.isFinite(fromCursor) && fromCursor >= 0) return fromCursor;

    const fromLegacy = Number(entry?.proximo);
    if (Number.isFinite(fromLegacy) && fromLegacy >= 0) return fromLegacy;

    if (entry?.acabou === true) return 0;
  }
  return 0;
}

interface CursorExtractionResult {
  cursor: { fornecedorId: string; page: number } | null;
  exhausted: boolean;
  source: 'cursor' | 'next_cursor' | 'reset' | 'legacy' | 'none';
}

function isValidFornecedorCursor(value: unknown): value is { fornecedorId: string; page: number } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && String((value as any).fornecedorId || '').trim().length > 0
    && Number.isFinite(Number((value as any).page))
    && Number((value as any).page) > 0;
}

function extractCursorFromJobLog(log: any): CursorExtractionResult {
  const logs = parseLog(log);
  let legacyCursor: { fornecedorId: string; page: number } | null = null;

  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i] || {};

    if (!legacyCursor && isValidFornecedorCursor(entry?.cursor)) {
      legacyCursor = {
        fornecedorId: String(entry.cursor.fornecedorId),
        page: Number(entry.cursor.page),
      };
    }

    if (entry?.event_type !== 'job_stage_done') continue;

    if (entry?.cursor_exhausted === true) {
      return { cursor: null, exhausted: true, source: 'reset' };
    }

    if (isValidFornecedorCursor(entry?.cursor)) {
      return {
        cursor: {
          fornecedorId: String(entry.cursor.fornecedorId),
          page: Number(entry.cursor.page),
        },
        exhausted: false,
        source: 'cursor',
      };
    }

    if (isValidFornecedorCursor(entry?.next_cursor)) {
      return {
        cursor: {
          fornecedorId: String(entry.next_cursor.fornecedorId),
          page: Number(entry.next_cursor.page),
        },
        exhausted: false,
        source: 'next_cursor',
      };
    }

    const hasExplicitCursorState =
      Object.prototype.hasOwnProperty.call(entry, 'cursor')
      || Object.prototype.hasOwnProperty.call(entry, 'next_cursor');

    if (hasExplicitCursorState) {
      return { cursor: null, exhausted: true, source: 'reset' };
    }
  }

  if (legacyCursor) {
    return { cursor: legacyCursor, exhausted: false, source: 'legacy' };
  }

  return { cursor: null, exhausted: false, source: 'none' };
}

function consecutiveFailures(statuses: string[]): number {
  let count = 0;
  for (const status of statuses) {
    if (status === 'completo') break;
    count += 1;
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
  const mlAuth = await getMLAuthDiagnostics();
  const results: any[] = [];

  const tasksToRun = SYNC_TASKS.filter((task) => task.schedule);

  for (const task of tasksToRun) {
    const intervalMinutes = getIntervalMinutesForTask(task, hour);
    if (!intervalMinutes || intervalMinutes <= 0) continue;

    const isMlTask = task.kind === 'ml';
    if (isMlTask && (mlAuth.state === 'reauth_required' || Boolean(mlAuth.blocked_until))) {
      results.push({
        task: task.key,
        action: 'skipped_auth_block',
        auth_state: mlAuth.state,
        auth_blocked_until: mlAuth.blocked_until,
      });
      continue;
    }

    const { data: running } = await serviceClient
      .from('jobs')
      .select('id, tipo, status, created_at, finished_at, log')
      .eq('tipo', task.jobTipo)
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (running?.id) {
      if (isJobStale(running, DEFAULT_STALE_JOB_THRESHOLD_MINUTES)) {
        await markJobAsStale(running as any);
        results.push({
          task: task.key,
          action: 'stale_job_detected',
          jobId: running.id,
          stale_threshold_minutes: DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
        });
      } else {
        results.push({
          task: task.key,
          action: 'skipped_running_fresh',
          jobId: running.id,
          stale_threshold_minutes: DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
        });
        continue;
      }
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
    const backoffMinutes = task.key === 'sync_dslite_preco_estoque'
      ? 0
      : shouldApplyBackoff(statuses) && failureStreak > 0
        ? 10
        : 0;

    const lastFinished = recent.find((j: any) => Boolean(j.finished_at));
    if (lastFinished?.finished_at) {
      const lastMs = new Date(lastFinished.finished_at).getTime();
      const nextDueMs = lastMs + (intervalMinutes + backoffMinutes) * 60 * 1000;
      if (Date.now() < nextDueMs) {
        results.push({
          task: task.key,
          action: 'skipped_not_due',
          next_due_at: new Date(nextDueMs).toISOString(),
          interval_minutes: intervalMinutes,
          backoff_minutes: backoffMinutes,
        });
        continue;
      }
    }

    let offset = 0;
    let cursorInfo: CursorExtractionResult = {
      cursor: null,
      exhausted: false,
      source: 'none',
    };
    if (task.usesOffset && recent.length > 0) {
      offset = extractOffsetFromJobLog(recent[0].log);
    }
    if (task.usesCursor && recent.length > 0) {
      cursorInfo = extractCursorFromJobLog(recent[0].log);
    }

    const initialLog = [
      {
        event_type: 'cron_dispatch',
        type: 'info',
        message: `Disparo automático: ${task.label}`,
        timestamp: nowIso(),
        task: task.key,
        task_domain: task.domain,
        interval_minutes: intervalMinutes,
        backoff_minutes: backoffMinutes,
        consecutive_failures: failureStreak,
        offset,
        cursor: cursorInfo.cursor,
        cursor_exhausted: cursorInfo.exhausted,
        cursor_source: cursorInfo.source,
      },
    ];

    const { data: insertedJob, error: insertError } = await serviceClient
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

    if (insertError || !insertedJob?.id) {
      results.push({
        task: task.key,
        action: 'insert_error',
        error: insertError?.message || 'Falha ao criar job',
      });
      continue;
    }

    setTimeout(() => {
      const body = {
        ...(task.defaultBody || {}),
        ...(task.usesCursor && cursorInfo.cursor
          ? { fornecedorId: cursorInfo.cursor.fornecedorId, page: cursorInfo.cursor.page }
          : {}),
      };
      const query = task.usesOffset ? { offset } : undefined;

      void runMlSingleStageJob({
        jobId: insertedJob.id,
        tipo: task.jobTipo,
        path: task.path,
        label: task.label,
        query,
        body,
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
        cursor: cursorInfo.cursor,
        cursor_exhausted: cursorInfo.exhausted,
        cursor_source: cursorInfo.source,
      });
  }

  return NextResponse.json({
    success: true,
    jitter_ms: jitterMs,
    timezone: 'America/Sao_Paulo',
    hour,
    ml_auth: mlAuth,
    results,
  });
}
