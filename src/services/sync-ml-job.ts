import { createServiceClient } from '@/lib/supabase';
import { resolveMlJobOutcome, type MlJobOutcome } from '@/lib/sync/job-outcome';
import type { Database } from '@/types/database';
import { runMlListingsObservedJobBatch } from '@/services/ml-listings-observed-job';

interface MlJobConfig {
  jobId: string;
  tipo: string;
  path: string;
  label: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Record<string, any>;
  requestTimeoutMs?: number;
  retryOnFailure?: boolean;
}

type JobsUpdate = Database['public']['Tables']['jobs']['Update'];

const DOMAIN_LOCK_RETRY_ATTEMPTS = 15;
const DOMAIN_LOCK_RETRY_DELAY_MS = 2_000;

function nowIso() {
  return new Date().toISOString();
}

function parseJobLog(log: any): any[] {
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

function eventLog(
  eventType: 'job_started' | 'job_stage_done' | 'job_finished' | 'job_start_failed' | 'job_deferred',
  message: string,
  extra?: Record<string, any>,
) {
  return {
    event_type: eventType,
    type: eventType === 'job_start_failed' ? 'error' : 'info',
    message,
    timestamp: nowIso(),
    ...extra,
  };
}

function isValidFornecedorCursor(value: unknown): value is { fornecedorId: string; page: number } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && String((value as any).fornecedorId || '').trim().length > 0
    && Number.isFinite(Number((value as any).page))
    && Number((value as any).page) > 0;
}

async function updateJob(jobId: string, data: JobsUpdate) {
  const serviceClient = createServiceClient();
  await serviceClient.from('jobs').update(data).eq('id', jobId);
}

export async function runMlSingleStageJob(config: MlJobConfig): Promise<{
  success: boolean;
  status: MlJobOutcome;
  processados: number;
  total: number;
}> {
  const { jobId, tipo, path, label, query, body } = config;
  if (tipo === 'sync_ml_listings_observed') {
    return runMlListingsObservedJobBatch(jobId);
  }
  const serviceClient = createServiceClient();

  const { data: job } = await serviceClient
    .from('jobs')
    .select('id, status, tipo, log, finished_at')
    .eq('id', jobId)
    .single();

  if (!job?.id || job.tipo !== tipo) {
    throw new Error('Job não encontrado');
  }

  if (job.finished_at || ['completo', 'completo_parcial', 'erro', 'cancelado', 'failed_auth'].includes(job.status)) {
    return {
      success: true,
      status: job.status === 'completo' ? 'completo' : (job.status === 'failed_auth' ? 'failed_auth' : 'erro'),
      processados: 1,
      total: 1,
    };
  }

  const logs = parseJobLog(job.log);
  logs.push(eventLog('job_started', `Processamento iniciado para ${label}`, { job_id: jobId, tipo }));

  const { data: claimedJob, error: claimError } = await serviceClient
    .from('jobs')
    .update({
      status: 'rodando',
      progresso: 0,
      processados: 0,
      total: 1,
      log: logs,
      finished_at: null,
    })
    .eq('id', jobId)
    .in('status', ['pendente', 'on_hold'])
    .select('id')
    .maybeSingle();

  if (claimError) {
    throw new Error(`Falha ao assumir job: ${claimError.message}`);
  }
  if (!claimedJob?.id) {
    return {
      success: false,
      status: 'on_hold',
      processados: 0,
      total: 1,
    };
  }

  const baseUrl = process.env.INTERNAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const apiKey = process.env.API_SECRET_KEY || '';
  const requestTimeoutMs = Number(config.requestTimeoutMs || process.env.INTERNAL_SYNC_TIMEOUT_MS || 120000);
  const requestBody = {
    ...(body || {}),
    syncJobId: jobId,
    syncJobType: tipo,
  };

  try {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const startedAtMs = Date.now();
    let res: Response;
    try {
      logs.push(eventLog('job_stage_done', 'Requisição interna do job iniciada', {
        stage: tipo,
        type: 'info',
        event_type: 'job_http_request_started',
        path,
        request_timeout_ms: requestTimeoutMs,
      }));
      await updateJob(jobId, { log: logs });

      res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    logs.push(eventLog('job_stage_done', 'Resposta HTTP recebida da rota interna', {
      stage: tipo,
      type: 'info',
      event_type: 'job_http_response_received',
      path,
      http_status: res.status,
      duration_ms: Date.now() - startedAtMs,
    }));
    await updateJob(jobId, { log: logs });

    let raw = await res.json().catch(() => ({}));
    let primaryError = Array.isArray(raw?.errors) && raw.errors.length > 0 ? raw.errors[0] : null;
    let errorCode = raw?.code || raw?.error_code || primaryError?.code || null;
    let isDomainLockConflict = res.status === 409 && errorCode === 'domain_lock_conflict';

    const lockRetryAttempts = config.retryOnFailure ? 0 : DOMAIN_LOCK_RETRY_ATTEMPTS;
    for (let retry = 1; isDomainLockConflict && retry <= lockRetryAttempts; retry++) {
      logs.push(eventLog('job_stage_done', 'Domínio ocupado; aguardando para repetir a etapa', {
        stage: tipo,
        event_type: 'job_domain_lock_retry',
        retry,
        retry_delay_ms: DOMAIN_LOCK_RETRY_DELAY_MS,
      }));
      await updateJob(jobId, { log: logs });
      await new Promise((resolve) => setTimeout(resolve, DOMAIN_LOCK_RETRY_DELAY_MS));

      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), requestTimeoutMs);
      try {
        res = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: retryController.signal,
        });
      } finally {
        clearTimeout(retryTimeout);
      }

      raw = await res.json().catch(() => ({}));
      primaryError = Array.isArray(raw?.errors) && raw.errors.length > 0 ? raw.errors[0] : null;
      errorCode = raw?.code || raw?.error_code || primaryError?.code || null;
      isDomainLockConflict = res.status === 409 && errorCode === 'domain_lock_conflict';
    }

    const skippedDueToDomainLock = isDomainLockConflict;
    const requestSucceeded = res.ok && raw?.success !== false && raw?.ok !== false;
    const authFailure = res.status === 401 && (raw?.failure_reason === 'auth_fatal' || raw?.auth_state === 'reauth_required');
    const deferred = raw?.deferred === true;
    const statusFinal = resolveMlJobOutcome({
      domainLockConflict: isDomainLockConflict,
      requestSucceeded,
      authFailure,
      retryOnFailure: Boolean(config.retryOnFailure),
      deferred,
    });
    const ok = statusFinal === 'completo';
    const errorCategory = raw?.category || primaryError?.category || null;
    const upstreamStatus = raw?.upstream_status ?? primaryError?.upstream_status ?? null;
    const previousCursor = isValidFornecedorCursor(body)
      ? {
          fornecedorId: String(body.fornecedorId),
          page: Number(body.page),
        }
      : null;
    const effectiveNextCursor = isValidFornecedorCursor(raw?.cursor)
      ? {
          fornecedorId: String(raw.cursor.fornecedorId),
          page: Number(raw.cursor.page),
        }
      : isValidFornecedorCursor(raw?.next_cursor)
        ? {
            fornecedorId: String(raw.next_cursor.fornecedorId),
            page: Number(raw.next_cursor.page),
          }
        : null;
    const cursorExhausted = raw?.cursor_exhausted === true || (!effectiveNextCursor && (Object.prototype.hasOwnProperty.call(raw, 'cursor') || Object.prototype.hasOwnProperty.call(raw, 'next_cursor')));
    const cursorSource = effectiveNextCursor
      ? (isValidFornecedorCursor(raw?.cursor) ? 'cursor' : 'next_cursor')
      : (cursorExhausted ? 'reset' : 'none');

    const { data: latestJob } = await serviceClient
      .from('jobs')
      .select('log, processados, total')
      .eq('id', jobId)
      .maybeSingle();
    const finalLogs = parseJobLog(latestJob?.log);

    finalLogs.push({
      event_type: 'job_stage_done',
      type: statusFinal === 'on_hold' ? 'warning' : (ok ? 'success' : 'error'),
      stage: tipo,
      http_status: res.status,
      message: isDomainLockConflict
        ? (statusFinal === 'on_hold'
          ? 'Etapa adiada: domínio ocupado; job mantido para nova tentativa'
          : 'Etapa ignorada: domínio já está em execução por outro job')
        : (raw?.message || raw?.erro || raw?.error || (ok ? 'Etapa concluída' : 'Etapa falhou')),
      timestamp: nowIso(),
      duration_ms: Date.now() - startedAtMs,
      request_timeout_ms: requestTimeoutMs,
      auth_failure: authFailure,
      deferred,
      error_code: errorCode,
      error_category: errorCategory,
      upstream_status: upstreamStatus,
      cursor_previous: previousCursor,
      cursor_effective_next: effectiveNextCursor,
      cursor_exhausted: cursorExhausted,
      cursor_source: cursorSource,
      skipped_due_to_domain_lock: skippedDueToDomainLock,
      ...raw,
    });

    finalLogs.push(eventLog(
      statusFinal === 'on_hold' ? 'job_deferred' : 'job_finished',
      statusFinal === 'on_hold'
        ? 'Job mantido em espera para nova tentativa'
        : `Processamento finalizado com status ${statusFinal}`,
      { job_id: jobId, tipo, http_status: res.status },
    ));

    await updateJob(jobId, {
      status: statusFinal,
      processados: statusFinal === 'on_hold' ? 0 : Math.max(1, Number(latestJob?.processados || 0)),
      total: Math.max(1, Number(latestJob?.total || 0)),
      progresso: statusFinal === 'on_hold' ? 0 : 100,
      log: finalLogs,
      finished_at: statusFinal === 'on_hold' ? null : nowIso(),
    });

    return {
      success: ok,
      status: statusFinal,
      processados: statusFinal === 'on_hold' ? 0 : 1,
      total: 1,
    };
  } catch (err: any) {
    const { data: latestJob } = await serviceClient
      .from('jobs')
      .select('log')
      .eq('id', jobId)
      .maybeSingle();
    const failedLogs = parseJobLog(latestJob?.log);
    failedLogs.push(eventLog('job_start_failed', `Falha ao executar job: ${err?.message || 'erro desconhecido'}`, {
      job_id: jobId,
      tipo,
      error_name: err?.name || null,
      abort: err?.name === 'AbortError',
    }));

    const retryOnFailure = Boolean(config.retryOnFailure);
    if (retryOnFailure) {
      failedLogs.push(eventLog('job_deferred', 'Job mantido em espera após falha transitória', {
        job_id: jobId,
        tipo,
      }));
    }

    await updateJob(jobId, {
      status: retryOnFailure ? 'on_hold' : 'erro',
      log: failedLogs,
      finished_at: retryOnFailure ? null : nowIso(),
      processados: retryOnFailure ? 0 : 1,
      total: 1,
      progresso: retryOnFailure ? 0 : 100,
    });

    if (retryOnFailure) {
      return {
        success: false,
        status: 'on_hold',
        processados: 0,
        total: 1,
      };
    }
    throw err;
  }
}
