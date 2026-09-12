const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getSyncTaskByKey,
  getScheduledTasksMissingSchedule,
  evaluateScheduledTaskHealth,
  SYNC_TASKS,
} = require('../src/lib/sync/registry.ts');
const { getJobLastActivityMs } = require('../src/lib/sync/job-staleness.ts');
const { resolveMlJobOutcome } = require('../src/lib/sync/job-outcome.ts');

test('jobs lentos usam timeout próprio e retornam para fila após falha transitória', () => {
  const dslite = getSyncTaskByKey('sync_dslite_pedidos_compra');
  const mlObserved = getSyncTaskByKey('sync_ml_listings_observed');
  const mlPublish = getSyncTaskByKey('sync_ml_listings_publish');
  const mercadoPago = getSyncTaskByKey('sync_mercadopago_account_money');

  assert.equal(dslite?.requestTimeoutMs, 180_000);
  assert.equal(dslite?.retryOnFailure, true);
  assert.equal(mlObserved?.requestTimeoutMs, 300_000);
  assert.equal(mlObserved?.retryOnFailure, true);
  assert.equal(mlObserved?.usesOffset, undefined);
  assert.equal(mlPublish?.requestTimeoutMs, 180_000);
  assert.equal(mlPublish?.retryOnFailure, true);
  assert.equal(mercadoPago?.requestTimeoutMs, 300_000);
  assert.equal(mercadoPago?.retryOnFailure, true);
});

test('falha do sync DSLite permanece em espera para retry seguro', () => {
  const dslite = getSyncTaskByKey('sync_dslite_pedidos_compra');

  assert.equal(resolveMlJobOutcome({
    domainLockConflict: false,
    requestSucceeded: false,
    authFailure: false,
    retryOnFailure: Boolean(dslite?.retryOnFailure),
  }), 'on_hold');
});

test('publicação ML limita cada execução a vinte itens', () => {
  const mlPublish = getSyncTaskByKey('sync_ml_listings_publish');

  assert.deepEqual(mlPublish?.defaultBody, { limit: 20 });
});

test('API principal e XML reconciliador preservam cadência e lock compartilhado', () => {
  const apiStock = getSyncTaskByKey('sync_dslite_preco_estoque');
  const xmlStock = getSyncTaskByKey('sync_dslite_xml_preco_estoque');

  assert.equal(apiStock?.label, 'DSLite Preço/Estoque — principal');
  assert.equal(xmlStock?.label, 'DSLite XML Preço/Estoque — reconciliação');
  assert.equal(apiStock?.domain, 'produtos:dslite_preco');
  assert.equal(xmlStock?.domain, apiStock?.domain);
  assert.equal(apiStock?.usesCursor, true);
  assert.equal(xmlStock?.usesCursor, undefined);
  assert.deepEqual(apiStock?.schedule, {
    businessMinutes: 2,
    offHoursMinutes: 2,
  });
  assert.deepEqual(xmlStock?.schedule, {
    businessMinutes: 10,
    offHoursMinutes: 10,
  });
});

// Guarda-corrida do incidente de 22/07-10/08: um PR removeu o `schedule` de
// `sync_dslite_preco_estoque` sem remover a intenção de rodar via cron, e o
// cron-dispatch simplesmente parou de disparar a task por 19 dias, sem erro
// e sem alerta (ele só dispara tasks com `schedule` definido). Este teste
// falha para QUALQUER task futura que caia na mesma armadilha, não só esta.
test('toda task com dispatchMode "scheduled" declara um schedule', () => {
  const offenders = getScheduledTasksMissingSchedule().map((task) => task.key);

  assert.deepEqual(offenders, []);
});

test('toda task do registry declara explicitamente seu dispatchMode', () => {
  const missing = SYNC_TASKS
    .filter((task) => !['scheduled', 'realtime', 'manual'].includes(task.dispatchMode))
    .map((task) => task.key);

  assert.deepEqual(missing, []);
});

test('falha ao consultar histórico adia diagnóstico sem acusar task parada', () => {
  assert.deepEqual(evaluateScheduledTaskHealth({
    intervalMinutes: 2,
    lastRunAt: null,
    lookupFailed: true,
    nowMs: Date.parse('2026-08-16T01:30:00Z'),
  }), {
    state: 'deferred',
    minutesSinceLastRun: null,
    staleThresholdMinutes: 30,
  });
});

test('consulta válida distingue job recente, ausente e atrasado', () => {
  const nowMs = Date.parse('2026-08-16T01:30:00Z');
  assert.equal(evaluateScheduledTaskHealth({
    intervalMinutes: 2,
    lastRunAt: '2026-08-16T01:25:00Z',
    nowMs,
  }).state, 'healthy');
  assert.equal(evaluateScheduledTaskHealth({
    intervalMinutes: 2,
    lastRunAt: null,
    nowMs,
  }).state, 'stale');
  assert.equal(evaluateScheduledTaskHealth({
    intervalMinutes: 2,
    lastRunAt: '2026-08-16T00:59:59Z',
    nowMs,
  }).state, 'stale');
});

test('monitor de agendamento usa progresso recente de um job longo', () => {
  const nowMs = Date.parse('2026-09-12T17:17:21.000Z');
  const lastActivityMs = getJobLastActivityMs({
    created_at: '2026-09-12T16:46:34.000Z',
    finished_at: null,
    log: [{
      event_type: 'ml_observed_batch_completed',
      timestamp: '2026-09-12T17:17:15.000Z',
      processed: 2400,
      total: 7052,
    }],
  });

  const health = evaluateScheduledTaskHealth({
    intervalMinutes: 5,
    lastRunAt: new Date(lastActivityMs).toISOString(),
    nowMs,
  });

  assert.equal(health.state, 'healthy');
  assert.equal(health.staleThresholdMinutes, 30);
  assert.ok(health.minutesSinceLastRun < 1);
});

test('nome da sincronização de anúncios é compreensível para o usuário', () => {
  assert.equal(
    getSyncTaskByKey('sync_ml_listings_observed')?.label,
    'Atualização dos anúncios do Mercado Livre',
  );
});
