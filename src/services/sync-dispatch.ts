import { after } from 'next/server';
import { ML_OBSERVED_CYCLE_DEDUPE_KEY } from '@/lib/ml/observed-scan-batch';
import { createServiceClient } from '@/lib/supabase';
import {
  buildSyncTaskBody,
  buildSyncTaskQuery,
  type SyncDispatchBody,
  type SyncTaskQuery,
} from '@/lib/sync/dispatch-request';
import { getSyncTaskByKey, type SyncTaskDefinition, type SyncTaskKey } from '@/lib/sync/registry';
import { runMlSingleStageJob } from '@/services/sync-ml-job';
import type { Database } from '@/types/database';

type JobsInsert = Database['public']['Tables']['jobs']['Insert'];

export type SyncDispatchOrigin =
  | { kind: 'system'; source: 'api/sync/run' }
  | { kind: 'manual_ui'; source: 'api/sync/disparar'; actorUserId: string };

export interface SyncDispatchResult {
  task: SyncTaskKey;
  tipo: string;
  domain: string;
  reused?: boolean;
  resumed?: boolean;
  skipped?: boolean;
  jobId?: string;
  status?: string;
  query?: SyncTaskQuery;
  payload?: Record<string, unknown>;
  error?: string;
}

export interface SyncDispatchOutcome {
  success: boolean;
  mode: 'background_jobs';
  tasks: SyncTaskKey[];
  results: SyncDispatchResult[];
  httpStatus: 202 | 207;
}

function nowIso(): string {
  return new Date().toISOString();
}

function scheduleBackgroundJob(params: {
  jobId: string;
  task: SyncTaskDefinition;
  query: SyncTaskQuery;
  payload: Record<string, unknown>;
}) {
  after(async () => {
    try {
      await runMlSingleStageJob({
        jobId: params.jobId,
        tipo: params.task.jobTipo,
        path: params.task.path,
        label: params.task.label,
        query: params.query,
        body: params.payload,
        requestTimeoutMs: params.task.requestTimeoutMs,
        retryOnFailure: params.task.retryOnFailure,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[sync-dispatch] Falha ao iniciar processamento em background:', message);
    }
  });
}

function buildInitialLog(params: {
  task: SyncTaskDefinition;
  origin: SyncDispatchOrigin;
  query: SyncTaskQuery;
  payload: Record<string, unknown>;
}): Record<string, unknown>[] {
  const manualUi = params.origin.kind === 'manual_ui';
  const realtime = !manualUi && params.task.dispatchMode === 'realtime';

  return [{
    event_type: manualUi ? 'manual_dispatch' : realtime ? 'realtime_dispatch' : 'system_dispatch',
    type: 'info',
    message: manualUi
      ? `Disparo manual (UI): ${params.task.label}`
      : realtime
        ? `Disparo em tempo real: ${params.task.label}`
        : `Disparo de sistema: ${params.task.label}`,
    timestamp: nowIso(),
    task: params.task.key,
    task_domain: params.task.domain,
    source: params.origin.source,
    origin: manualUi ? 'manual_ui' : realtime ? 'realtime' : 'system',
    dispatch_mode: params.task.dispatchMode,
    query: params.query,
    payload: params.payload,
    ...(params.origin.kind === 'manual_ui' ? { actor_user_id: params.origin.actorUserId } : {}),
  }];
}

async function hasPendingMlPublish(
  serviceClient: ReturnType<typeof createServiceClient>,
  payload: Record<string, unknown>,
): Promise<{ pending: boolean; error?: string }> {
  if (Boolean(payload.seedFromProducts)) return { pending: true };

  const targetOutboxId = String(payload.outboxId || '').trim();
  let pendingQuery = serviceClient
    .from('anuncios_ml_outbox' as never)
    .select('id')
    .in('status', ['pending', 'retry'])
    .limit(1);

  pendingQuery = targetOutboxId
    ? pendingQuery.eq('id', targetOutboxId)
    : pendingQuery.lte('available_at', nowIso());

  const { data, error } = await pendingQuery;
  if (error) return { pending: false, error: error.message };
  return { pending: Array.isArray(data) && data.length > 0 };
}

export async function dispatchSyncTasks(params: {
  requestBody: SyncDispatchBody;
  taskKeys: SyncTaskKey[];
  origin: SyncDispatchOrigin;
}): Promise<SyncDispatchOutcome> {
  const serviceClient = createServiceClient();
  const results: SyncDispatchResult[] = [];

  for (const taskKey of params.taskKeys) {
    const task = getSyncTaskByKey(taskKey);
    if (!task) continue;

    const query = buildSyncTaskQuery(task.key, params.requestBody);
    const payload = buildSyncTaskBody(task, params.requestBody);
    const { data: running, error: runningError } = await serviceClient
      .from('jobs')
      .select('id, status, created_at')
      .eq('tipo', task.jobTipo)
      .in('status', ['pendente', 'rodando', 'on_hold'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runningError) {
      results.push({ task: task.key, tipo: task.jobTipo, domain: task.domain, error: runningError.message });
      continue;
    }

    if (running?.id) {
      if (running.status === 'on_hold') {
        scheduleBackgroundJob({ jobId: running.id, task, query, payload });
      }
      results.push({
        task: task.key,
        tipo: task.jobTipo,
        domain: task.domain,
        reused: true,
        resumed: running.status === 'on_hold',
        jobId: running.id,
        status: running.status,
      });
      continue;
    }

    if (task.key === 'sync_ml_listings_publish') {
      const pendingPublish = await hasPendingMlPublish(serviceClient, payload);
      if (pendingPublish.error) {
        results.push({ task: task.key, tipo: task.jobTipo, domain: task.domain, error: pendingPublish.error });
        continue;
      }
      if (!pendingPublish.pending) {
        results.push({ task: task.key, tipo: task.jobTipo, domain: task.domain, skipped: true, status: 'empty' });
        continue;
      }
    }

    const initialLog = buildInitialLog({ task, origin: params.origin, query, payload });
    const jobInsert: JobsInsert = {
      tipo: task.jobTipo,
      status: 'pendente',
      progresso: 0,
      total: 1,
      processados: 0,
      unidade_progresso: task.progressUnit,
      log: initialLog as JobsInsert['log'],
      created_by: params.origin.kind === 'manual_ui' ? params.origin.actorUserId : null,
      dedupe_key: task.key === 'sync_ml_listings_observed' ? ML_OBSERVED_CYCLE_DEDUPE_KEY : null,
    };

    const { data: insertedJob, error: insertError } = await serviceClient
      .from('jobs')
      .insert(jobInsert)
      .select('id, status')
      .single();

    if (insertError || !insertedJob?.id) {
      results.push({
        task: task.key,
        tipo: task.jobTipo,
        domain: task.domain,
        reused: false,
        error: insertError?.message || 'Falha ao criar job',
      });
      continue;
    }

    scheduleBackgroundJob({ jobId: insertedJob.id, task, query, payload });
    results.push({
      task: task.key,
      tipo: task.jobTipo,
      domain: task.domain,
      reused: false,
      jobId: insertedJob.id,
      status: insertedJob.status,
      query,
      payload,
    });
  }

  const success = results.every((result) => !result.error);
  return {
    success,
    mode: 'background_jobs',
    tasks: params.taskKeys,
    results,
    httpStatus: success ? 202 : 207,
  };
}
