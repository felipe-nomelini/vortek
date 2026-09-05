export type SyncTaskKey =
  | 'sync_dslite_fornecedores'
  | 'sync_dslite_catalogo'
  | 'sync_dslite_preco_estoque'
  | 'sync_dslite_xml_preco_estoque'
  | 'sync_dslite_pedidos_compra'
  | 'sync_ml_orders_ingest'
  | 'sync_ml_cancelamentos_pos_nfe'
  | 'sync_ml_listings_observed'
  | 'sync_ml_listings_publish'
  | 'sync_ml_pricing_experiment_monitor'
  | 'sync_reconcile_fiscal'
  | 'sync_reconcile_brasilnfe'
  | 'sync_mercadopago_account_money'
  | 'sync_pack_id_backfill'
  | 'sync_municipios_seed';

export type SyncTaskKind = 'dslite' | 'ml' | 'fiscal' | 'finance' | 'infra';

/**
 * Declara como a task chega a ser executada, para que a ausência de `schedule`
 * seja uma decisão explícita e não um esquecimento silencioso (ver incidente
 * de 22/07–10/08 em que `sync_dslite_preco_estoque` perdeu o `schedule` e
 * ficou 19 dias sem rodar sem que nada acusasse).
 *
 * - 'scheduled': depende do `cron-dispatch` chamá-la periodicamente; exige `schedule`.
 * - 'realtime': disparada por trigger de banco/evento fora do `cron-dispatch` (ex.: outbox).
 * - 'manual': só roda por acionamento humano nas telas de operação.
 */
export type SyncTaskDispatchMode = 'scheduled' | 'realtime' | 'manual';

export interface SyncTaskDefinition {
  key: SyncTaskKey;
  jobTipo: string;
  label: string;
  path: string;
  domain: string;
  lockTtlSeconds: number;
  kind: SyncTaskKind;
  dispatchMode: SyncTaskDispatchMode;
  schedule?: {
    businessMinutes: number;
    offHoursMinutes: number;
    businessSeconds?: number;
    offHoursSeconds?: number;
  };
  usesOffset?: boolean;
  usesCursor?: boolean;
  defaultBody?: Record<string, unknown>;
  runMode?: 'background' | 'inline';
  requestTimeoutMs?: number;
  retryOnFailure?: boolean;
}

export const SYNC_TASKS: SyncTaskDefinition[] = [
  {
    key: 'sync_dslite_fornecedores',
    jobTipo: 'sync_dslite_fornecedores',
    label: 'DSLite Fornecedores',
    path: '/api/sync/fornecedores',
    domain: 'fornecedores:dslite',
    lockTtlSeconds: 20 * 60,
    kind: 'dslite',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 30, offHoursMinutes: 120 },
  },
  {
    key: 'sync_dslite_catalogo',
    jobTipo: 'sync_dslite_catalogo',
    label: 'DSLite Catálogo',
    path: '/api/sync/catalogo',
    domain: 'produtos:dslite_catalogo',
    lockTtlSeconds: 45 * 60,
    kind: 'dslite',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 360, offHoursMinutes: 720 },
    usesCursor: true,
    defaultBody: {
      pageSize: 100,
      maxPagesPerRun: 2,
    },
  },
  {
    key: 'sync_dslite_preco_estoque',
    jobTipo: 'sync_dslite_preco_estoque',
    label: 'DSLite Preço/Estoque',
    path: '/api/sync/preco-estoque',
    domain: 'produtos:dslite_preco',
    lockTtlSeconds: 15 * 60,
    kind: 'dslite',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 2, offHoursMinutes: 2 },
    usesCursor: true,
    defaultBody: {
      pageSize: 100,
      maxPagesPerRun: 1,
      withMlSync: false,
    },
    runMode: 'inline',
  },
  {
    key: 'sync_dslite_xml_preco_estoque',
    jobTipo: 'sync_dslite_xml_preco_estoque',
    label: 'DSLite XML Preço/Estoque',
    path: '/api/sync/preco-estoque-xml',
    domain: 'produtos:dslite_preco',
    lockTtlSeconds: 15 * 60,
    kind: 'dslite',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 10, offHoursMinutes: 10 },
    runMode: 'inline',
  },
  {
    key: 'sync_dslite_pedidos_compra',
    jobTipo: 'sync_dslite_pedidos_compra',
    label: 'DSLite Pedidos de Compra',
    path: '/api/sync/dslite-pedidos',
    domain: 'compras:dslite',
    lockTtlSeconds: 20 * 60,
    kind: 'dslite',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 2, offHoursMinutes: 2 },
    defaultBody: { windowDays: 2 },
    runMode: 'inline',
    requestTimeoutMs: 180_000,
    retryOnFailure: true,
  },
  {
    key: 'sync_ml_orders_ingest',
    jobTipo: 'sync_ml_orders_ingest',
    label: 'ML Pedidos (Ingestão)',
    path: '/api/sync/pedidos',
    domain: 'pedidos:ml_ingest',
    lockTtlSeconds: 20 * 60,
    kind: 'ml',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 2, offHoursMinutes: 5 },
    usesOffset: true,
    runMode: 'inline',
  },
  {
    key: 'sync_ml_cancelamentos_pos_nfe',
    jobTipo: 'sync_ml_cancelamentos_pos_nfe',
    label: 'ML Cancelamentos Pós-NF',
    path: '/api/sync/pedidos/cancelamentos-pos-nfe',
    domain: 'pedidos:cancelamentos_pos_nfe',
    lockTtlSeconds: 20 * 60,
    kind: 'fiscal',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 2, offHoursMinutes: 5 },
    defaultBody: { limit: 10 },
    runMode: 'inline',
  },
  {
    key: 'sync_ml_listings_observed',
    jobTipo: 'sync_ml_listings_observed',
    label: 'ML Anúncios (Observado)',
    path: '/api/sync/anuncios',
    domain: 'anuncios:ml_pull',
    lockTtlSeconds: 20 * 60,
    kind: 'ml',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 5, offHoursMinutes: 15 },
    usesOffset: true,
    runMode: 'inline',
    requestTimeoutMs: 300_000,
    retryOnFailure: true,
  },
  {
    key: 'sync_ml_listings_publish',
    jobTipo: 'sync_ml_listings_publish',
    label: 'ML Anúncios (Publicação)',
    path: '/api/sync/anuncios/publish',
    domain: 'anuncios:ml_push',
    lockTtlSeconds: 20 * 60,
    kind: 'ml',
    dispatchMode: 'realtime',
    defaultBody: { limit: 20 },
    runMode: 'inline',
    requestTimeoutMs: 180_000,
    retryOnFailure: true,
  },
  {
    key: 'sync_ml_pricing_experiment_monitor',
    jobTipo: 'sync_ml_pricing_experiment_monitor',
    label: 'ML Experimento de Pricing',
    path: '/api/sync/pricing-experiment/monitor',
    domain: 'anuncios:ml_pricing_experiment_monitor',
    lockTtlSeconds: 10 * 60,
    kind: 'ml',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 5, offHoursMinutes: 5 },
    runMode: 'inline',
    requestTimeoutMs: 300_000,
    retryOnFailure: false,
  },
  {
    key: 'sync_reconcile_fiscal',
    jobTipo: 'sync_reconcile_fiscal',
    label: 'Reconciliar Fiscal',
    path: '/api/sync/pedidos/reconciliar-fiscal',
    domain: 'pedidos:fiscal',
    lockTtlSeconds: 25 * 60,
    kind: 'fiscal',
    dispatchMode: 'manual',
  },
  {
    key: 'sync_reconcile_brasilnfe',
    jobTipo: 'sync_reconcile_brasilnfe',
    label: 'Reconciliar NF Brasil NFe',
    path: '/api/sync/nf/reconciliar-brasilnfe',
    domain: 'pedidos:brasilnfe',
    lockTtlSeconds: 15 * 60,
    kind: 'fiscal',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 2, offHoursMinutes: 10 },
    defaultBody: { limit: 10 },
    runMode: 'inline',
  },
  {
    key: 'sync_mercadopago_account_money',
    jobTipo: 'sync_mercadopago_account_money',
    label: 'Mercado Pago Dinheiro em Conta',
    path: '/api/sync/mercadopago-account-money',
    domain: 'financeiro:mercadopago',
    lockTtlSeconds: 20 * 60,
    kind: 'finance',
    dispatchMode: 'scheduled',
    schedule: { businessMinutes: 180, offHoursMinutes: 360 },
    defaultBody: { windowDays: 7 },
  },
  {
    key: 'sync_pack_id_backfill',
    jobTipo: 'sync_pack_id_backfill',
    label: 'Backfill Pack ID',
    path: '/api/sync/pedidos/pack-id-backfill',
    domain: 'pedidos:pack',
    lockTtlSeconds: 20 * 60,
    kind: 'ml',
    dispatchMode: 'manual',
  },
  {
    key: 'sync_municipios_seed',
    jobTipo: 'sync_municipios_seed',
    label: 'Seed Municípios IBGE',
    path: '/api/sync/municipios-ibge/seed',
    domain: 'municipios:seed',
    lockTtlSeconds: 30 * 60,
    kind: 'infra',
    dispatchMode: 'manual',
  },
];

const TASK_BY_KEY = new Map(SYNC_TASKS.map((task) => [task.key, task]));
const TASK_BY_JOB_TIPO = new Map(SYNC_TASKS.map((task) => [task.jobTipo, task]));

export function getSyncTaskByKey(key: string): SyncTaskDefinition | null {
  return TASK_BY_KEY.get(key as SyncTaskKey) || null;
}

export function getSyncTaskByJobTipo(jobTipo: string): SyncTaskDefinition | null {
  return TASK_BY_JOB_TIPO.get(jobTipo) || null;
}

/**
 * Tasks com `dispatchMode: 'scheduled'` mas sem `schedule` definido: o
 * `cron-dispatch` nunca vai chamá-las (ele filtra por `task.schedule`), então
 * isso é sempre um bug de configuração, não uma escolha válida.
 */
export function getScheduledTasksMissingSchedule(): SyncTaskDefinition[] {
  return SYNC_TASKS.filter((task) => task.dispatchMode === 'scheduled' && !task.schedule);
}

export type ScheduledTaskHealth = {
  state: 'healthy' | 'stale' | 'deferred';
  minutesSinceLastRun: number | null;
  staleThresholdMinutes: number;
};

export function evaluateScheduledTaskHealth(input: {
  intervalMinutes: number;
  lastRunAt: string | null;
  lookupFailed?: boolean;
  nowMs?: number;
}): ScheduledTaskHealth {
  const staleThresholdMinutes = Math.max(input.intervalMinutes * 6, 30);
  if (input.lookupFailed) {
    return { state: 'deferred', minutesSinceLastRun: null, staleThresholdMinutes };
  }
  if (!input.lastRunAt) {
    return { state: 'stale', minutesSinceLastRun: null, staleThresholdMinutes };
  }

  const lastRunMs = new Date(input.lastRunAt).getTime();
  if (!Number.isFinite(lastRunMs)) {
    return { state: 'deferred', minutesSinceLastRun: null, staleThresholdMinutes };
  }

  const minutesSinceLastRun = ((input.nowMs ?? Date.now()) - lastRunMs) / 60000;
  return {
    state: minutesSinceLastRun > staleThresholdMinutes ? 'stale' : 'healthy',
    minutesSinceLastRun,
    staleThresholdMinutes,
  };
}

export function getSaoPauloHour(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  return Number(parts.find((part) => part.type === 'hour')?.value || '0');
}

export function isBusinessHour(hour: number): boolean {
  return hour >= 8 && hour < 22;
}

export function getIntervalMinutesForTask(task: SyncTaskDefinition, hour: number): number | null {
  if (!task.schedule) return null;
  return isBusinessHour(hour) ? task.schedule.businessMinutes : task.schedule.offHoursMinutes;
}

export function getIntervalMsForTask(task: SyncTaskDefinition, hour: number): number | null {
  if (!task.schedule) return null;
  const seconds = isBusinessHour(hour) ? task.schedule.businessSeconds : task.schedule.offHoursSeconds;
  if (Number.isFinite(seconds) && Number(seconds) > 0) return Number(seconds) * 1000;
  const minutes = getIntervalMinutesForTask(task, hour);
  return minutes && minutes > 0 ? minutes * 60 * 1000 : null;
}

export function mapLegacyTipoToTaskKey(tipo: string): SyncTaskKey | 'todos' | null {
  const normalized = String(tipo || '').trim().toLowerCase();
  if (!normalized || normalized === 'todos') return 'todos';

  const map: Record<string, SyncTaskKey> = {
    fornecedores: 'sync_dslite_fornecedores',
    catalogo: 'sync_dslite_catalogo',
    precos: 'sync_dslite_preco_estoque',
    pedidos_compra: 'sync_dslite_pedidos_compra',
    pedidos: 'sync_ml_orders_ingest',
    anuncios: 'sync_ml_listings_observed',
    anuncios_publish: 'sync_ml_listings_publish',
    reconcile_fiscal: 'sync_reconcile_fiscal',
    reconcile_brasilnfe: 'sync_reconcile_brasilnfe',
    brasilnfe: 'sync_reconcile_brasilnfe',
    nfe_brasilnfe: 'sync_reconcile_brasilnfe',
    mercadopago_account_money: 'sync_mercadopago_account_money',
    mercado_pago: 'sync_mercadopago_account_money',
    mercado_pago_extrato: 'sync_mercadopago_account_money',
    pack_backfill: 'sync_pack_id_backfill',
    municipios_seed: 'sync_municipios_seed',
    // Compatibilidade com taxonomy legada
    sync_dslite_stock: 'sync_dslite_preco_estoque',
    sync_dslite_catalog: 'sync_dslite_catalogo',
    sync_dslite_pedidos: 'sync_dslite_pedidos_compra',
    sync_pedidos_ml: 'sync_ml_orders_ingest',
    sync_anuncios_ml: 'sync_ml_listings_observed',
    dslite_stock: 'sync_dslite_preco_estoque',
    dslite_catalog: 'sync_dslite_catalogo',
    dslite_pedidos: 'sync_dslite_pedidos_compra',
    ml_pedidos: 'sync_ml_orders_ingest',
    ml_anuncios: 'sync_ml_listings_observed',
  };

  return map[normalized] || null;
}
