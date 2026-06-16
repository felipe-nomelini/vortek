import { createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';

interface StageDef {
  key: 'fornecedores' | 'catalogo' | 'precos' | 'pedidos';
  path: string;
  label: string;
}

interface StageResult {
  stage: StageDef['key'];
  label: string;
  ok: boolean;
  status: number;
  message: string;
  stats?: Record<string, number>;
}

type JobsUpdate = Database['public']['Tables']['jobs']['Update'];

const stages: StageDef[] = [
  { key: 'fornecedores', path: '/api/sync/fornecedores', label: 'Fornecedores' },
  { key: 'catalogo', path: '/api/sync/catalogo', label: 'Catálogo' },
  { key: 'precos', path: '/api/sync/preco-estoque', label: 'Preços e Estoque' },
  { key: 'pedidos', path: '/api/sync/dslite-pedidos', label: 'Pedidos de Compra' },
];

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
    type: eventType === 'job_stage_done' || eventType === 'job_finished' || eventType === 'job_started' ? 'info' : 'error',
    message,
    timestamp: nowIso(),
    ...extra,
  };
}

function makeStageLog(result: StageResult) {
  const stats = result.stats || {};
  return {
    event_type: 'job_stage_done',
    type: result.ok ? 'success' : 'error',
    stage: result.stage,
    http_status: result.status,
    message: `${result.label} (${result.stage}) [HTTP ${result.status}] ${result.message}`,
    timestamp: nowIso(),
    ...stats,
  };
}

async function updateJob(jobId: string, data: JobsUpdate) {
  const serviceClient = createServiceClient();
  await serviceClient.from('jobs').update(data).eq('id', jobId);
}

async function runStage(baseUrl: string, apiKey: string, stage: StageDef): Promise<StageResult> {
  try {
    const res = await fetch(`${baseUrl}${stage.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({}),
    });

    const raw = await res.json().catch(() => ({}));
    const ok = res.ok && raw.success !== false;
    const message =
      raw?.message ||
      raw?.error ||
      raw?.erro ||
      (ok ? 'Etapa concluída' : 'Etapa retornou falha');

    const stats: Record<string, number> = {};
    for (const key of ['total', 'inseridos', 'atualizados', 'inativados', 'erros']) {
      const value = raw?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        stats[key] = value;
      }
    }

    return {
      stage: stage.key,
      label: stage.label,
      ok,
      status: res.status,
      message: String(message),
      stats: Object.keys(stats).length > 0 ? stats : undefined,
    };
  } catch (err: any) {
    return {
      stage: stage.key,
      label: stage.label,
      ok: false,
      status: 500,
      message: err?.message || 'Erro inesperado na etapa',
    };
  }
}

export async function runDsliteJob(jobId: string): Promise<{
  success: boolean;
  status: 'completo' | 'completo_parcial' | 'erro';
  processados: number;
  total: number;
}> {
  const serviceClient = createServiceClient();
  const { data: job } = await serviceClient
    .from('jobs')
    .select('id, status, tipo, log, finished_at')
    .eq('id', jobId)
    .single();

  if (!job?.id || job.tipo !== 'sync_dslite') {
    throw new Error('Job não encontrado');
  }

  if (job.finished_at || ['completo', 'completo_parcial', 'erro', 'cancelado'].includes(job.status)) {
    return {
      success: true,
      status: (job.status as any) === 'completo_parcial' ? 'completo_parcial' : (job.status as any) === 'completo' ? 'completo' : 'erro',
      processados: stages.length,
      total: stages.length,
    };
  }

  const baseUrl = process.env.INTERNAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const apiKey = process.env.API_SECRET_KEY || '';

  const stageResults: StageResult[] = [];
  const stageLogs = parseJobLog(job.log);

  try {
    stageLogs.push(eventLog('job_started', 'Processamento DSLite iniciado', { job_id: jobId }));
    await updateJob(jobId, {
      status: 'rodando',
      progresso: 0,
      processados: 0,
      total: stages.length,
      log: stageLogs,
      finished_at: null,
    });

    for (const stage of stages) {
      const result = await runStage(baseUrl, apiKey, stage);
      stageResults.push(result);
      stageLogs.push(makeStageLog(result));

      const processados = stageResults.length;
      const progresso = Math.round((processados / stages.length) * 100);
      await updateJob(jobId, {
        processados,
        progresso,
        total: stages.length,
        log: stageLogs,
      });
    }

    const totalErros = stageResults.filter(r => !r.ok).length;
    const statusFinal = totalErros === 0
      ? 'completo'
      : totalErros === stages.length
        ? 'erro'
        : 'completo_parcial';

    stageLogs.push(eventLog('job_finished', `Processamento finalizado com status ${statusFinal}`, {
      job_id: jobId,
      errors: totalErros,
      total: stages.length,
    }));

    await updateJob(jobId, {
      status: statusFinal,
      processados: stages.length,
      total: stages.length,
      progresso: 100,
      log: stageLogs,
      finished_at: nowIso(),
    });

    // Sanity check: garante finalização consistente.
    const { data: finalJob } = await serviceClient
      .from('jobs')
      .select('status, finished_at')
      .eq('id', jobId)
      .single();

    if (finalJob?.status === 'rodando' || !finalJob?.finished_at) {
      await updateJob(jobId, {
        status: statusFinal,
        finished_at: nowIso(),
        progresso: 100,
        processados: stages.length,
      });
    }

    return {
      success: true,
      status: statusFinal,
      processados: stages.length,
      total: stages.length,
    };
  } catch (err: any) {
    const failLog = eventLog(
      'job_start_failed',
      `Falha ao executar job DSLite: ${err?.message || 'erro desconhecido'}`,
      { job_id: jobId },
    );
    stageLogs.push(failLog);
    await updateJob(jobId, {
      status: 'erro',
      log: stageLogs,
      finished_at: nowIso(),
    });
    throw err;
  }
}
