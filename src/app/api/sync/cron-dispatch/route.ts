import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { runMlSingleStageJob } from '@/services/sync-ml-job';
import { getMLAuthDiagnostics } from '@/services/integration';
import { SYNC_TASKS, getIntervalMsForTask, getIntervalMinutesForTask, getSaoPauloHour } from '@/lib/sync/registry';
import {
  DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
  isJobStale,
  markJobAsStale,
  requeueStaleJob,
} from '@/lib/sync/stale-jobs';
import {
  getMlOrderIdFromHydrationJob,
  ML_ORDER_HYDRATION_JOB_TYPE,
  ML_ORDER_HYDRATION_STALE_MINUTES,
} from '@/lib/sync/ml-order-hydration';
import {
  alertCriticalJobs,
  alertIntegrationStatus,
  alertStaleScheduledTasks,
  scanAndAlertReleasedLabels,
  sendSalesReport,
} from '@/services/whatsapp-alerts';
import { dispatchPushNotifications } from '@/services/push-notifications';
import {
  getWhatsappLabelJobRequest,
  getWhatsappLabelRetry,
  isWhatsappLabelJobDue,
  parseWhatsappLabelJobLog,
  runWhatsappLabelJob,
} from '@/services/whatsapp-label-job';
import { ML_OBSERVED_CYCLE_DEDUPE_KEY } from '@/lib/ml/observed-scan-batch';

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

async function processWhatsappLabelQueue(serviceClient: ReturnType<typeof createServiceClient>) {
  const { data: queuedJobs, error } = await serviceClient
    .from('jobs')
    .select('id,status,log,created_at')
    .eq('tipo', 'whatsapp_label_send')
    .in('status', ['pendente', 'on_hold'])
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    console.error('[cron-dispatch] falha ao listar fila de WhatsApp', error.message);
    return { processed: 0, error: error.message };
  }

  const dueJobs = (queuedJobs || [])
    .filter((job: any) => job.status === 'pendente' || isWhatsappLabelJobDue(job.log))
    .slice(0, 5);

  const settled = await Promise.allSettled(dueJobs.map(async (job: any) => {
    const payload = getWhatsappLabelJobRequest(job.log);
    if (!payload) {
      const log = parseWhatsappLabelJobLog(job.log);
      const retryAttempt = getWhatsappLabelRetry(log).attempt + 1;
      const nextRetryAt = new Date(Date.now() + 30 * 60_000).toISOString();
      log.push({
        event: 'queue_hold',
        at: nowIso(),
        retry_attempt: retryAttempt,
        next_retry_at: nextRetryAt,
        error: 'Payload original do envio não encontrado',
      });
      await serviceClient
        .from('jobs')
        .update({ status: 'on_hold', log, finished_at: null })
        .eq('id', job.id)
        .in('status', ['pendente', 'on_hold']);
      return;
    }

    await runWhatsappLabelJob({ jobId: job.id, ...payload });
  }));

  return {
    processed: dueJobs.length,
    fulfilled: settled.filter((item) => item.status === 'fulfilled').length,
    rejected: settled.filter((item) => item.status === 'rejected').length,
  };
}

async function processMlOrderHydrationQueue(serviceClient: ReturnType<typeof createServiceClient>) {
  const { data: queuedJobs, error } = await serviceClient
    .from('jobs')
    .select('id,status,dedupe_key,log,created_at')
    .eq('tipo', ML_ORDER_HYDRATION_JOB_TYPE)
    .in('status', ['pendente', 'on_hold'])
    .order('created_at', { ascending: true })
    .limit(5);

  if (error) {
    console.error('[cron-dispatch] falha ao listar fila de hidratação ML', error.message);
    return { processed: 0, completed: 0, deferred: 0, error: error.message };
  }

  let processed = 0;
  let completed = 0;
  let deferred = 0;
  for (const job of queuedJobs || []) {
    const mlOrderId = getMlOrderIdFromHydrationJob(job as any);
    if (!mlOrderId) {
      const log = parseLog(job.log);
      log.push({
        event_type: 'job_invalid_payload',
        type: 'error',
        message: 'Job sem ID válido de pedido ML',
        timestamp: nowIso(),
      });
      await serviceClient
        .from('jobs')
        .update({ status: 'erro', finished_at: nowIso(), progresso: 100, log })
        .eq('id', job.id)
        .in('status', ['pendente', 'on_hold']);
      continue;
    }

    const result = await runMlSingleStageJob({
      jobId: job.id,
      tipo: ML_ORDER_HYDRATION_JOB_TYPE,
      path: '/api/sync/pedidos',
      label: 'ML Orders V2 Hydration',
      query: { mlOrderId },
      body: {
        mlOrderId,
        triggerSource: 'cron_queue',
        source: 'webhook_orders_v2_retry',
      },
      retryOnFailure: true,
    });

    processed += 1;
    if (result.status === 'completo') completed += 1;
    if (result.status === 'on_hold') {
      deferred += 1;
      break;
    }
  }

  return { processed, completed, deferred, error: null };
}

function getSaoPauloDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  return {
    weekday: parts.find((part) => part.type === 'weekday')?.value || '',
    day: Number(parts.find((part) => part.type === 'day')?.value || '0'),
    hour: Number(parts.find((part) => part.type === 'hour')?.value || '0'),
  };
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

async function runScheduledTask(params: {
  jobId: string;
  tipo: string;
  path: string;
  label: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Record<string, any>;
  requestTimeoutMs?: number;
  retryOnFailure?: boolean;
}) {
  try {
    const result = await runMlSingleStageJob({
      jobId: params.jobId,
      tipo: params.tipo,
      path: params.path,
      label: params.label,
      query: params.query,
      body: params.body,
      requestTimeoutMs: params.requestTimeoutMs,
      retryOnFailure: params.retryOnFailure,
    });
    return { ok: true, result };
  } catch (err: any) {
    console.error('[cron-dispatch] erro ao executar job', params.tipo, err?.message || err);
    return {
      ok: false,
      error: err?.message || 'Falha ao executar job',
    };
  }
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
  const alertResults: any[] = [];

  // Jobs manuais, como a criação de pedido DSLite, não pertencem a SYNC_TASKS.
  // Recupera-os aqui para que não permaneçam indefinidamente em "rodando".
  const { data: runningJobs, error: runningJobsError } = await serviceClient
    .from('jobs')
    .select('id, tipo, status, created_at, finished_at, log')
    .in('status', ['pendente', 'rodando'])
    .order('created_at', { ascending: true })
    .limit(100);

  if (runningJobsError) {
    console.error('[cron-dispatch] falha ao listar jobs para recuperação stale', runningJobsError.message);
  } else {
    for (const job of runningJobs || []) {
      if (job.tipo === ML_ORDER_HYDRATION_JOB_TYPE) {
        if (job.status !== 'rodando' || !isJobStale(job as any, ML_ORDER_HYDRATION_STALE_MINUTES)) continue;
        const recovery = await requeueStaleJob(job as any, ML_ORDER_HYDRATION_STALE_MINUTES);
        results.push({
          task: job.tipo,
          action: 'stale_job_queued_for_retry',
          jobId: job.id,
          stale_threshold_minutes: ML_ORDER_HYDRATION_STALE_MINUTES,
          ...recovery,
        });
        continue;
      }
      if (job.tipo === 'sync_ml_listings_observed') {
        if (job.status !== 'rodando' || !isJobStale(job as any, DEFAULT_STALE_JOB_THRESHOLD_MINUTES)) continue;
        const recovery = await requeueStaleJob(job as any, DEFAULT_STALE_JOB_THRESHOLD_MINUTES);
        results.push({
          task: job.tipo,
          action: 'stale_job_queued_for_retry',
          jobId: job.id,
          stale_threshold_minutes: DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
          ...recovery,
        });
        continue;
      }
      if (!isJobStale(job as any, DEFAULT_STALE_JOB_THRESHOLD_MINUTES)) continue;
      if (job.tipo === 'whatsapp_label_send') {
        const log = parseWhatsappLabelJobLog(job.log);
        const retryAttempt = getWhatsappLabelRetry(log).attempt + 1;
        log.push({
          event: 'queue_hold',
          at: nowIso(),
          retry_attempt: retryAttempt,
          next_retry_at: nowIso(),
          error: 'Job travado recuperado automaticamente pelo cron',
        });
        await serviceClient
          .from('jobs')
          .update({ status: 'on_hold', log, finished_at: null })
          .eq('id', job.id)
          .in('status', ['pendente', 'rodando']);
        results.push({
          task: job.tipo,
          action: 'stale_job_queued_for_retry',
          jobId: job.id,
        });
        continue;
      }
      await markJobAsStale(job as any);
      results.push({
        task: job.tipo,
        action: 'stale_job_recovered',
        jobId: job.id,
        stale_threshold_minutes: DEFAULT_STALE_JOB_THRESHOLD_MINUTES,
      });
    }
  }

  const whatsappQueueResult = await processWhatsappLabelQueue(serviceClient);
  results.push({ task: 'whatsapp_label_send', action: 'queue_processed', ...whatsappQueueResult });

  if (mlAuth.state === 'reauth_required' || Boolean(mlAuth.blocked_until)) {
    results.push({
      task: ML_ORDER_HYDRATION_JOB_TYPE,
      action: 'queue_skipped_auth_block',
      auth_state: mlAuth.state,
      auth_blocked_until: mlAuth.blocked_until,
    });
  } else {
    const hydrationQueueResult = await processMlOrderHydrationQueue(serviceClient);
    results.push({ task: ML_ORDER_HYDRATION_JOB_TYPE, action: 'queue_processed', ...hydrationQueueResult });
  }

  await Promise.allSettled([
    alertIntegrationStatus().then((result) => alertResults.push({ alert: 'integration_status', ...result })),
    alertCriticalJobs().then((result) => alertResults.push({ alert: 'critical_jobs', ...result })),
    alertStaleScheduledTasks().then((result) => alertResults.push({ alert: 'stale_scheduled_tasks', ...result })),
    scanAndAlertReleasedLabels().then((result) => alertResults.push({ alert: 'released_labels', ...result })),
    dispatchPushNotifications().then((result) => alertResults.push({ alert: 'push_dispatch', ...result })),
  ]);

  const spDate = getSaoPauloDateParts();
  if (spDate.weekday === 'Mon' && spDate.hour >= 8 && spDate.hour <= 10) {
    await sendSalesReport('weekly').then((result) => alertResults.push({ alert: 'weekly_sales_report', ...result })).catch(() => null);
  }
  if (spDate.day === 1 && spDate.hour >= 8 && spDate.hour <= 10) {
    await sendSalesReport('monthly').then((result) => alertResults.push({ alert: 'monthly_sales_report', ...result })).catch(() => null);
  }

  const tasksToRun = SYNC_TASKS.filter((task) => task.schedule);

  for (const task of tasksToRun) {
    const intervalMinutes = getIntervalMinutesForTask(task, hour);
    const intervalMs = getIntervalMsForTask(task, hour);
    if (!intervalMs || intervalMs <= 0) continue;

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
      .in('status', ['pendente', 'rodando', 'on_hold'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let resumableJobId: string | null = null;
    if (running?.id) {
      if (running.status === 'on_hold') {
        resumableJobId = running.id;
      } else if (isJobStale(running, DEFAULT_STALE_JOB_THRESHOLD_MINUTES)) {
        if (task.key === 'sync_ml_listings_observed') {
          await requeueStaleJob(running as any, DEFAULT_STALE_JOB_THRESHOLD_MINUTES);
          resumableJobId = running.id;
        } else {
          await markJobAsStale(running as any);
        }
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
    if (!resumableJobId && lastFinished?.finished_at) {
      const lastMs = new Date(lastFinished.finished_at).getTime();
      const nextDueMs = lastMs + intervalMs + backoffMinutes * 60 * 1000;
      if (Date.now() < nextDueMs) {
        results.push({
          task: task.key,
          action: 'skipped_not_due',
          next_due_at: new Date(nextDueMs).toISOString(),
          interval_minutes: intervalMinutes,
          interval_ms: intervalMs,
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
        interval_ms: intervalMs,
        backoff_minutes: backoffMinutes,
        consecutive_failures: failureStreak,
        offset,
        cursor: cursorInfo.cursor,
        cursor_exhausted: cursorInfo.exhausted,
        cursor_source: cursorInfo.source,
      },
    ];

    let jobId = resumableJobId;
    if (!jobId) {
      const { data: insertedJob, error: insertError } = await serviceClient
        .from('jobs')
        .insert({
          tipo: task.jobTipo,
          status: 'pendente',
          progresso: 0,
          total: 1,
          processados: 0,
          unidade_progresso: task.progressUnit,
          log: initialLog,
          created_by: null,
          dedupe_key: task.key === 'sync_ml_listings_observed' ? ML_OBSERVED_CYCLE_DEDUPE_KEY : null,
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
      jobId = insertedJob.id;
    }

    const body = {
      ...(task.defaultBody || {}),
      ...(task.usesCursor && cursorInfo.cursor
        ? { fornecedorId: cursorInfo.cursor.fornecedorId, page: cursorInfo.cursor.page }
        : {}),
    };
    const query = task.usesOffset ? { offset } : undefined;

    if (task.runMode === 'inline') {
      const runResult = await runScheduledTask({
        jobId,
        tipo: task.jobTipo,
        path: task.path,
        label: task.label,
        query,
        body,
        requestTimeoutMs: task.requestTimeoutMs,
        retryOnFailure: task.retryOnFailure,
      });

      const deferred = runResult.ok && runResult.result?.status === 'on_hold';

      results.push({
        task: task.key,
        action: deferred
          ? 'deferred_inline'
          : runResult.ok
            ? (resumableJobId ? 'resumed_inline' : 'completed_inline')
            : 'failed_inline',
        jobId,
        status: runResult.ok ? runResult.result?.status : 'erro',
        error: runResult.ok ? null : runResult.error,
        interval_minutes: intervalMinutes,
        backoff_minutes: backoffMinutes,
        offset,
        cursor: cursorInfo.cursor,
        cursor_exhausted: cursorInfo.exhausted,
        cursor_source: cursorInfo.source,
      });
      continue;
    }

    setTimeout(() => {
      void runScheduledTask({
        jobId,
        tipo: task.jobTipo,
        path: task.path,
        label: task.label,
        query,
        body,
        requestTimeoutMs: task.requestTimeoutMs,
        retryOnFailure: task.retryOnFailure,
      });
    }, 0);

    results.push({
      task: task.key,
      action: resumableJobId ? 'resumed_background' : 'dispatched_background',
      jobId,
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
    alert_results: alertResults,
    results,
  });
}
