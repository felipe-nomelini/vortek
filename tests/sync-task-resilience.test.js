const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getSyncTaskByKey,
  getScheduledTasksMissingSchedule,
  SYNC_TASKS,
} = require('../src/lib/sync/registry.ts');

test('jobs lentos usam timeout próprio e retornam para fila após falha transitória', () => {
  const dslite = getSyncTaskByKey('sync_dslite_pedidos_compra');
  const mlObserved = getSyncTaskByKey('sync_ml_listings_observed');
  const mlPublish = getSyncTaskByKey('sync_ml_listings_publish');

  assert.equal(dslite?.requestTimeoutMs, 180_000);
  assert.equal(dslite?.retryOnFailure, true);
  assert.equal(mlObserved?.requestTimeoutMs, 300_000);
  assert.equal(mlObserved?.retryOnFailure, true);
  assert.equal(mlPublish?.requestTimeoutMs, 180_000);
  assert.equal(mlPublish?.retryOnFailure, true);
});

test('publicação ML limita cada execução a vinte itens', () => {
  const mlPublish = getSyncTaskByKey('sync_ml_listings_publish');

  assert.deepEqual(mlPublish?.defaultBody, { limit: 20 });
});

test('preço e estoque DSLite permanecem agendados a cada dois minutos', () => {
  const dsliteStock = getSyncTaskByKey('sync_dslite_preco_estoque');

  assert.deepEqual(dsliteStock?.schedule, {
    businessMinutes: 2,
    offHoursMinutes: 2,
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
