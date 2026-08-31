import {
  SYNC_TASKS,
  getSyncTaskByKey,
  mapLegacyTipoToTaskKey,
  type SyncTaskDefinition,
  type SyncTaskKey,
} from './registry';

export type SyncDispatchBody = Record<string, unknown>;
export type SyncTaskQuery = Record<string, string | number | boolean>;

export function asSyncDispatchBody(value: unknown): SyncDispatchBody {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeTaskKey(value: unknown): SyncTaskKey | null {
  const key = String(value || '').trim();
  if (!key) return null;
  return getSyncTaskByKey(key)?.key || null;
}

export function resolveSyncTaskKeys(body: SyncDispatchBody): SyncTaskKey[] {
  const directTaskKeys = Array.isArray(body.taskKeys)
    ? body.taskKeys
        .map((entry) => sanitizeTaskKey(entry))
        .filter((entry): entry is SyncTaskKey => Boolean(entry))
    : [];

  if (directTaskKeys.length > 0) {
    return Array.from(new Set(directTaskKeys));
  }

  const directTaskKey = sanitizeTaskKey(body.taskKey);
  if (directTaskKey) return [directTaskKey];

  const tipoRaw = String(body.tipo || 'todos').trim();
  const tipoAsTask = sanitizeTaskKey(tipoRaw);
  if (tipoAsTask) return [tipoAsTask];

  const mapped = mapLegacyTipoToTaskKey(tipoRaw);
  if (mapped === 'todos') {
    return SYNC_TASKS.filter((task) => task.schedule).map((task) => task.key);
  }
  if (mapped) return [mapped];

  return [];
}

function parseOffset(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.trunc(number);
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.trunc(number);
}

export function buildSyncTaskQuery(taskKey: SyncTaskKey, body: SyncDispatchBody): SyncTaskQuery {
  const query: SyncTaskQuery = {};

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

export function buildSyncTaskBody(
  task: SyncTaskDefinition,
  requestBody: SyncDispatchBody,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...(task.defaultBody || {}),
  };

  if (isRecord(requestBody.body)) {
    Object.assign(payload, requestBody.body);
  }

  if (task.key === 'sync_dslite_catalogo') {
    if (Array.isArray(requestBody.fornecedorIds)) payload.fornecedorIds = requestBody.fornecedorIds;
    if (requestBody.pageSize !== undefined) payload.pageSize = parsePositiveInt(requestBody.pageSize, 100);
    if (requestBody.maxPagesPerRun !== undefined) payload.maxPagesPerRun = parsePositiveInt(requestBody.maxPagesPerRun, 1);
  }

  if (task.key === 'sync_dslite_preco_estoque') {
    if (Array.isArray(requestBody.fornecedorIds)) payload.fornecedorIds = requestBody.fornecedorIds;
    if (requestBody.fornecedorId !== undefined) payload.fornecedorId = requestBody.fornecedorId;
    if (requestBody.page !== undefined) payload.page = parsePositiveInt(requestBody.page, 1);
    if (requestBody.pageSize !== undefined) payload.pageSize = parsePositiveInt(requestBody.pageSize, 50);
    if (requestBody.maxPagesPerRun !== undefined) payload.maxPagesPerRun = parsePositiveInt(requestBody.maxPagesPerRun, 1);
    payload.withMlSync = false;
  }

  if (task.key === 'sync_dslite_pedidos_compra') {
    if (requestBody.windowDays !== undefined) payload.windowDays = parsePositiveInt(requestBody.windowDays, 2);
    if (requestBody.dataInicial !== undefined) payload.dataInicial = requestBody.dataInicial;
    if (requestBody.dataFinal !== undefined) payload.dataFinal = requestBody.dataFinal;
  }

  if (task.key === 'sync_ml_listings_publish') {
    if (requestBody.limit !== undefined) payload.limit = Math.min(20, parsePositiveInt(requestBody.limit, 10));
    if (requestBody.seedFromProducts !== undefined) payload.seedFromProducts = Boolean(requestBody.seedFromProducts);
    if (requestBody.outboxId !== undefined) payload.outboxId = String(requestBody.outboxId || '').trim();
  }

  if (task.key === 'sync_mercadopago_account_money') {
    if (requestBody.windowDays !== undefined) payload.windowDays = parsePositiveInt(requestBody.windowDays, 7);
    if (requestBody.beginDate !== undefined) payload.beginDate = requestBody.beginDate;
    if (requestBody.endDate !== undefined) payload.endDate = requestBody.endDate;
    if (requestBody.taskId !== undefined) payload.taskId = requestBody.taskId;
    if (requestBody.fileName !== undefined) payload.fileName = requestBody.fileName;
  }

  return payload;
}
