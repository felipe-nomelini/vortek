import { createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';

interface MlJobConfig {
  jobId: string;
  tipo: string;
  path: string;
  label: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Record<string, any>;
}

type JobsUpdate = Database['public']['Tables']['jobs']['Update'];

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
  eventType: 'job_started' | 'job_stage_done' | 'job_finished' | 'job_start_failed',
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
  status: 'completo' | 'erro' | 'failed_auth';
  processados: number;
  total: number;
}> {
  const { jobId, tipo, path, label, query, body } = config;
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const apiKey = process.env.API_SECRET_KEY || '';
  const requestTimeoutMs = Number(process.env.INTERNAL_SYNC_TIMEOUT_MS || 120000);
  const logs = parseJobLog(job.log);

  try {
    logs.push(eventLog('job_started', `Processamento iniciado para ${label}`, { job_id: jobId, tipo }));

    await updateJob(jobId, {
      status: 'rodando',
      progresso: 0,
      processados: 0,
      total: 1,
      log: logs,
      finished_at: null,
    });

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
        body: JSON.stringify(body || {}),
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

    const raw = await res.json().catch(() => ({}));
    const ok = res.ok && raw?.success !== false && raw?.ok !== false;
    const authFailure = res.status === 401 && (raw?.failure_reason === 'auth_fatal' || raw?.auth_state === 'reauth_required');
    const statusFinal: 'completo' | 'erro' | 'failed_auth' = ok ? 'completo' : (authFailure ? 'failed_auth' : 'erro');
    const primaryError = Array.isArray(raw?.errors) && raw.errors.length > 0 ? raw.errors[0] : null;
    const errorCode = raw?.code || raw?.error_code || primaryError?.code || null;
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

    logs.push({
      event_type: 'job_stage_done',
      type: ok ? 'success' : 'error',
      stage: tipo,
      http_status: res.status,
      message: raw?.message || raw?.erro || raw?.error || (ok ? 'Etapa concluída' : 'Etapa falhou'),
      timestamp: nowIso(),
      duration_ms: Date.now() - startedAtMs,
      request_timeout_ms: requestTimeoutMs,
      auth_failure: authFailure,
      error_code: errorCode,
      error_category: errorCategory,
      upstream_status: upstreamStatus,
      cursor_previous: previousCursor,
      cursor_effective_next: effectiveNextCursor,
      cursor_exhausted: cursorExhausted,
      cursor_source: cursorSource,
      ...raw,
    });

    logs.push(eventLog('job_finished', `Processamento finalizado com status ${statusFinal}`, {
      job_id: jobId,
      tipo,
      http_status: res.status,
    }));

    await updateJob(jobId, {
      status: statusFinal,
      processados: 1,
      total: 1,
      progresso: 100,
      log: logs,
      finished_at: nowIso(),
    });

    return {
      success: true,
      status: statusFinal,
      processados: 1,
      total: 1,
    };
  } catch (err: any) {
    logs.push(eventLog('job_start_failed', `Falha ao executar job: ${err?.message || 'erro desconhecido'}`, {
      job_id: jobId,
      tipo,
      error_name: err?.name || null,
      abort: err?.name === 'AbortError',
    }));

    await updateJob(jobId, {
      status: 'erro',
      log: logs,
      finished_at: nowIso(),
      processados: 1,
      total: 1,
      progresso: 100,
    });

    throw err;
  }
}
