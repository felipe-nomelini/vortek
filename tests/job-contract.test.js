const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ACTIVE_JOB_STATUSES,
  FAILURE_JOB_STATUSES,
  JOB_PROGRESS_UNITS,
  JOB_STATUSES,
  SUCCESS_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  isActiveJobStatus,
  isTerminalJobStatus,
} = require('../src/lib/jobs/contract.ts');
const { SYNC_TASKS } = require('../src/lib/sync/registry.ts');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('contrato de jobs mantém estados canônicos e grupos sem sobreposição', () => {
  assert.deepEqual(JOB_STATUSES, [
    'pendente',
    'rodando',
    'on_hold',
    'completo',
    'completo_parcial',
    'erro',
    'failed_auth',
    'cancelado',
  ]);
  assert.deepEqual(ACTIVE_JOB_STATUSES, ['pendente', 'rodando', 'on_hold']);
  assert.deepEqual(SUCCESS_JOB_STATUSES, ['completo', 'completo_parcial']);
  assert.deepEqual(FAILURE_JOB_STATUSES, ['erro', 'failed_auth']);
  assert.deepEqual(TERMINAL_JOB_STATUSES, [
    'completo',
    'completo_parcial',
    'erro',
    'failed_auth',
    'cancelado',
  ]);
  assert.equal(isActiveJobStatus('on_hold'), true);
  assert.equal(isActiveJobStatus('completo'), false);
  assert.equal(isTerminalJobStatus('cancelado'), true);
  assert.equal(isTerminalJobStatus('concluido'), false);
});

test('toda task registrada declara a unidade de progresso', () => {
  assert.deepEqual(JOB_PROGRESS_UNITS, ['execucao', 'itens', 'etapas']);
  assert.equal(SYNC_TASKS.length > 0, true);
  assert.deepEqual(
    SYNC_TASKS.filter((task) => !JOB_PROGRESS_UNITS.includes(task.progressUnit)).map((task) => task.key),
    [],
  );
  assert.equal(
    SYNC_TASKS.find((task) => task.key === 'sync_ml_listings_observed')?.progressUnit,
    'itens',
  );
  assert.deepEqual(
    SYNC_TASKS.filter((task) => task.key !== 'sync_ml_listings_observed' && task.progressUnit !== 'execucao')
      .map((task) => task.key),
    [],
  );
});

test('writers diretos declaram unidade e não gravam booleano de cancelamento legado', () => {
  const directWriters = new Map([
    ['src/app/api/catalogo/no-catalogo/refresh/job/route.ts', 'itens'],
    ['src/app/api/dslite/pedido/route.ts', 'etapas'],
    ['src/app/api/pedidos/[id]/enviar-etiqueta-whatsapp/route.ts', 'etapas'],
    ['src/app/api/sync/anuncios/job/route.ts', 'itens'],
    ['src/app/api/sync/dslite/route.ts', 'etapas'],
    ['src/app/api/sync/nf/reconciliar-brasilnfe/job/route.ts', 'execucao'],
    ['src/app/api/sync/pedidos/job/route.ts', 'execucao'],
    ['src/app/api/webhooks/ml/notifications/route.ts', 'itens'],
  ]);

  for (const [relativePath, unit] of directWriters) {
    const source = read(relativePath);
    assert.match(source, new RegExp(`unidade_progresso:\\s*['\"]${unit}['\"]`), relativePath);
    assert.doesNotMatch(source, /cancelado\s*:\s*false/, relativePath);
  }

  for (const relativePath of [
    'src/services/sync-dispatch.ts',
    'src/app/api/sync/cron-dispatch/route.ts',
  ]) {
    const source = read(relativePath);
    assert.match(source, /unidade_progresso:\s*task\.progressUnit/, relativePath);
    assert.doesNotMatch(source, /cancelado\s*:\s*false/, relativePath);
  }

  const genericQueue = read('src/services/job-queue.ts');
  assert.match(genericQueue, /progressUnit:\s*JobProgressUnit/);
  assert.match(genericQueue, /unidade_progresso:\s*progressUnit/);
  assert.doesNotMatch(genericQueue, /cancelado:\s*boolean/);
});

test('migrations adicionam unidade antes de restringir e removem estado duplicado', () => {
  const additive = read('supabase/migrations/20260831110000_job_progress_unit.sql');
  const constraints = read('supabase/migrations/20260831113000_job_status_constraints.sql');

  assert.match(additive, /add column if not exists unidade_progresso text not null default 'execucao'/i);
  assert.match(additive, /'sync_ml_listings_observed'[\s\S]*then 'itens'/i);
  assert.match(additive, /'dslite_criar_pedido'[\s\S]*then 'etapas'/i);

  assert.match(constraints, /set status = 'completo'[\s\S]*= 'concluido'/i);
  assert.match(constraints, /constraint jobs_status_check/i);
  assert.match(constraints, /constraint jobs_unidade_progresso_check/i);
  assert.match(constraints, /constraint jobs_metricas_check/i);
  assert.match(constraints, /processados between 0 and total/i);
  assert.match(constraints, /not valid/i);
  assert.match(constraints, /validate constraint jobs_status_check/i);
  assert.match(constraints, /drop column if exists cancelado/i);
});
