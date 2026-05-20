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

async function updateJob(jobId: string, data: JobsUpdate) {
  const serviceClient = createServiceClient();
  await serviceClient.from('jobs').update(data).eq('id', jobId);
}

export async function runMlSingleStageJob(config: MlJobConfig): Promise<{
  success: boolean;
  status: 'completo' | 'erro';
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

  if (job.finished_at || ['completo', 'completo_parcial', 'erro', 'cancelado'].includes(job.status)) {
    return {
      success: true,
      status: job.status === 'completo' ? 'completo' : 'erro',
      processados: 1,
      total: 1,
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const apiKey = process.env.API_SECRET_KEY || '';
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

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body || {}),
    });

    const raw = await res.json().catch(() => ({}));
    const ok = res.ok && raw?.success !== false && raw?.ok !== false;
    const statusFinal: 'completo' | 'erro' = ok ? 'completo' : 'erro';

    logs.push({
      event_type: 'job_stage_done',
      type: ok ? 'success' : 'error',
      stage: tipo,
      http_status: res.status,
      message: raw?.message || raw?.erro || raw?.error || (ok ? 'Etapa concluída' : 'Etapa falhou'),
      timestamp: nowIso(),
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
