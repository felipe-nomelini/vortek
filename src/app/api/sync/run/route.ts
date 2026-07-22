import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { runMlSingleStageJob } from '@/services/sync-ml-job';
import { SYNC_TASKS, getSyncTaskByKey, mapLegacyTipoToTaskKey, type SyncTaskKey } from '@/lib/sync/registry';

export const maxDuration = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeTaskKey(value: unknown): SyncTaskKey | null {
  const key = String(value || '').trim();
  if (!key) return null;
  return getSyncTaskByKey(key)?.key || null;
}

function resolveTaskKeys(body: Record<string, unknown>): SyncTaskKey[] {
  const directTaskKeys = Array.isArray(body.taskKeys)
    ? body.taskKeys
        .map((entry) => sanitizeTaskKey(entry))
        .filter((entry): entry is SyncTaskKey => Boolean(entry))
    : [];

  if (directTaskKeys.length > 0) {
    return Array.from(new Set(directTaskKeys));
  }

  const directTaskKey = sanitizeTaskKey(body.taskKey);
  if (directTaskKey) {
    return [directTaskKey];
  }

  const tipoRaw = String(body.tipo || 'todos').trim();
  const tipoAsTask = sanitizeTaskKey(tipoRaw);
  if (tipoAsTask) {
    return [tipoAsTask];
  }

  const mapped = mapLegacyTipoToTaskKey(tipoRaw);
  if (mapped === 'todos') {
    return SYNC_TASKS.filter((task) => task.schedule).map((task) => task.key);
  }
  if (mapped) return [mapped];

  return [];
}

function parseOffset(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function nowIso() {
  return new Date().toISOString();
}

function buildQuery(taskKey: SyncTaskKey, body: Record<string, unknown>): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {};

  if (isRecord(body.query)) {
    for (const [key, value] of Object.entries(body.query)) {
      if (value !== undefined && value !== null && ['string', 'number', 'boolean'].includes(typeof value)) {
        query[key] = value as string | number | boolean;
      }
    }
  }

  if (taskKey === 'sync_ml_orders_ingest') {
    const mlOrderId = String(body.mlOrderId || '').trim();
    if (mlOrderId) query.mlOrderId = mlOrderId;

    const offset = parseOffset(body.offset, -1);
    if (offset >= 0) query.offset = offset;

    const limit = parsePositiveInt(body.limit, -1);
    if (limit > 0) query.limit = limit;
  }

  if (taskKey === 'sync_ml_listings_observed') {
    const offset = parseOffset(body.offset, -1);
    if (offset >= 0) query.offset = offset;

    const limit = parsePositiveInt(body.limit, -1);
    if (limit > 0) query.limit = Math.min(100, limit);
  }

  if (taskKey === 'sync_reconcile_fiscal') {
    const limit = parsePositiveInt(body.limit, -1);
    if (limit > 0) query.limit = Math.min(500, limit);

    const mlOrderId = String(body.mlOrderId || '').trim();
    if (mlOrderId) query.mlOrderId = mlOrderId;

    const pedidoId = String(body.pedidoId || '').trim();
    if (pedidoId) query.pedidoId = pedidoId;
  }

  if (taskKey === 'sync_pack_id_backfill') {
    const limit = parsePositiveInt(body.limit, -1);
    if (limit > 0) query.limit = Math.min(200, limit);
  }

  return query;
}

function buildBody(taskKey: SyncTaskKey, taskDefaultBody: Record<string, unknown> | undefined, requestBody: Record<string, unknown>) {
  const payload = {
    ...(taskDefaultBody || {}),
  } as Record<string, unknown>;

  if (isRecord(requestBody.body)) {
    Object.assign(payload, requestBody.body);
  }

  if (taskKey === 'sync_dslite_catalogo') {
    if (Array.isArray(requestBody.fornecedorIds)) payload.fornecedorIds = requestBody.fornecedorIds;
    if (requestBody.pageSize !== undefined) payload.pageSize = parsePositiveInt(requestBody.pageSize, 100);
    if (requestBody.maxPagesPerRun !== undefined) payload.maxPagesPerRun = parsePositiveInt(requestBody.maxPagesPerRun, 1);
  }

  if (taskKey === 'sync_dslite_preco_estoque') {
    if (Array.isArray(requestBody.fornecedorIds)) payload.fornecedorIds = requestBody.fornecedorIds;
    if (requestBody.fornecedorId !== undefined) payload.fornecedorId = requestBody.fornecedorId;
    if (requestBody.page !== undefined) payload.page = parsePositiveInt(requestBody.page, 1);
    if (requestBody.pageSize !== undefined) payload.pageSize = parsePositiveInt(requestBody.pageSize, 50);
    if (requestBody.maxPagesPerRun !== undefined) payload.maxPagesPerRun = parsePositiveInt(requestBody.maxPagesPerRun, 1);
    payload.withMlSync = false;
  }

  if (taskKey === 'sync_dslite_pedidos_compra') {
    if (requestBody.windowDays !== undefined) payload.windowDays = parsePositiveInt(requestBody.windowDays, 2);
    if (requestBody.dataInicial !== undefined) payload.dataInicial = requestBody.dataInicial;
    if (requestBody.dataFinal !== undefined) payload.dataFinal = requestBody.dataFinal;
  }

  if (taskKey === 'sync_ml_listings_publish') {
    if (requestBody.limit !== undefined) payload.limit = Math.min(50, parsePositiveInt(requestBody.limit, 10));
    if (requestBody.seedFromProducts !== undefined) payload.seedFromProducts = Boolean(requestBody.seedFromProducts);
    if (requestBody.outboxId !== undefined) payload.outboxId = String(requestBody.outboxId || '').trim();
  }

  if (taskKey === 'sync_mercadopago_account_money') {
    if (requestBody.windowDays !== undefined) payload.windowDays = parsePositiveInt(requestBody.windowDays, 7);
    if (requestBody.beginDate !== undefined) payload.beginDate = requestBody.beginDate;
    if (requestBody.endDate !== undefined) payload.endDate = requestBody.endDate;
    if (requestBody.taskId !== undefined) payload.taskId = requestBody.taskId;
    if (requestBody.fileName !== undefined) payload.fileName = requestBody.fileName;
  }

  return payload;
}

function dispatchBackground(params: {
  jobId: string;
  tipo: string;
  path: string;
  label: string;
  query: Record<string, string | number | boolean>;
  body: Record<string, unknown>;
}) {
  setTimeout(() => {
    void runMlSingleStageJob({
      jobId: params.jobId,
      tipo: params.tipo,
      path: params.path,
      label: params.label,
      query: params.query,
      body: params.body,
    }).catch((err: any) => {
      console.error('[sync-run] Falha ao iniciar processamento em background:', err?.message || err);
    });
  }, 0);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const safeBody = isRecord(body) ? body : {};

    const apiKey = request.headers.get('x-api-key') || '';
    if (apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
    }

    const taskKeys = resolveTaskKeys(safeBody);
    if (taskKeys.length === 0) {
      return NextResponse.json({ error: 'Nenhuma task válida informada (use taskKey, taskKeys ou tipo).' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const results: any[] = [];

    for (const taskKey of taskKeys) {
      const task = getSyncTaskByKey(taskKey);
      if (!task) continue;

      if (task.key === 'sync_ml_listings_publish') {
        const targetOutboxId = String(safeBody.outboxId || '').trim();
        let pendingQuery = serviceClient
          .from('anuncios_ml_outbox' as any)
          .select('id')
          .in('status', ['pending', 'retry'])
          .limit(1);
        pendingQuery = targetOutboxId
          ? pendingQuery.eq('id', targetOutboxId)
          : pendingQuery.lte('available_at', nowIso());
        const { data: pendingOutbox, error: pendingOutboxError } = await pendingQuery;
        if (pendingOutboxError) {
          results.push({ task: task.key, tipo: task.jobTipo, domain: task.domain, error: pendingOutboxError.message });
          continue;
        }
        if (!pendingOutbox || pendingOutbox.length === 0) {
          results.push({ task: task.key, tipo: task.jobTipo, domain: task.domain, skipped: true, status: 'empty' });
          continue;
        }
      }

      const { data: running } = await serviceClient
        .from('jobs')
        .select('id, status, created_at')
        .eq('tipo', task.jobTipo)
        .in('status', ['pendente', 'rodando'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (running?.id) {
        results.push({
          task: task.key,
          tipo: task.jobTipo,
          domain: task.domain,
          reused: true,
          jobId: running.id,
          status: running.status,
        });
        continue;
      }

      const query = buildQuery(task.key, safeBody);
      const payload = buildBody(task.key, task.defaultBody, safeBody);
      const initialLog: any[] = [
        {
          event_type: 'manual_dispatch',
          type: 'info',
          message: `Disparo manual: ${task.label}`,
          timestamp: nowIso(),
          task: task.key,
          task_domain: task.domain,
          source: 'api/sync/run',
          query,
          payload,
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

      dispatchBackground({
        jobId: insertedJob.id,
        tipo: task.jobTipo,
        path: task.path,
        label: task.label,
        query,
        body: payload,
      });

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

    const success = results.every((row) => !row.error);
    return NextResponse.json({
      success,
      mode: 'background_jobs',
      tasks: taskKeys,
      results,
    }, { status: success ? 202 : 207 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro inesperado no disparo de sync' }, { status: 500 });
  }
}
