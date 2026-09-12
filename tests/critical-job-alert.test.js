const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CRITICAL_JOB_TIMEOUT_GRACE_MS,
  classifyCriticalJobIncident,
  decideCriticalJobAlert,
  getCriticalJobScope,
  isJobTimeoutAbort,
} = require('../src/lib/sync/critical-job-alert.ts');

const abortLog = {
  event_type: 'job_start_failed',
  message: 'Falha ao executar job: This operation was aborted',
};

test('reconhece timeout local por AbortController', () => {
  assert.equal(isJobTimeoutAbort(abortLog), true);
  assert.equal(isJobTimeoutAbort({ event_type: 'job_stage_done', message: 'HTTP 500' }), false);
});

test('não alerta job recuperado depois da falha', () => {
  assert.equal(decideCriticalJobAlert({
    status: 'erro',
    occurrences: 3,
    finishedAt: '2026-08-04T00:00:00.000Z',
    recoveredAt: '2026-08-04T00:02:00.000Z',
    rootLog: abortLog,
    nowMs: Date.parse('2026-08-04T00:20:00.000Z'),
  }), 'skip_recovered');
});

test('aguarda recuperação antes de alertar timeout repetido', () => {
  const finishedAt = '2026-08-04T00:00:00.000Z';
  assert.equal(decideCriticalJobAlert({
    status: 'erro',
    occurrences: 2,
    finishedAt,
    rootLog: abortLog,
    nowMs: Date.parse(finishedAt) + CRITICAL_JOB_TIMEOUT_GRACE_MS - 1,
  }), 'defer_timeout');

  assert.equal(decideCriticalJobAlert({
    status: 'erro',
    occurrences: 2,
    finishedAt,
    rootLog: abortLog,
    nowMs: Date.parse(finishedAt) + CRITICAL_JOB_TIMEOUT_GRACE_MS,
  }), 'alert');
});

test('mantém alertas de autenticação e falhas reais repetidas', () => {
  assert.equal(decideCriticalJobAlert({
    status: 'failed_auth',
    occurrences: 1,
  }), 'alert');

  assert.equal(decideCriticalJobAlert({
    status: 'erro',
    occurrences: 2,
    rootLog: { event_type: 'job_stage_done', message: 'HTTP 500' },
  }), 'alert');

  assert.equal(decideCriticalJobAlert({
    status: 'erro',
    occurrences: 1,
  }), 'skip_transient');
});

test('identifica incidentes pelo registro afetado e não somente pela rotina', () => {
  const first = { tipo: 'dslite_criar_pedido', dedupe_key: 'pedido:111', log: [] };
  const second = { tipo: 'dslite_criar_pedido', dedupe_key: 'pedido:222', log: [] };
  assert.equal(getCriticalJobScope(first), 'pedido:111');
  assert.notEqual(
    classifyCriticalJobIncident(first, { message: 'Rejeição 778: NCM inválido' }).key,
    classifyCriticalJobIncident(second, { message: 'Rejeição 778: NCM inválido' }).key,
  );
  const incident = classifyCriticalJobIncident(first, { message: 'Rejeição 778: NCM inválido' });
  assert.equal(incident.errorClass, 'invalid_ncm_778');
  assert.match(incident.title, /cadastro fiscal/);
});

test('resultado comercial inconclusivo do Pricing não vira incidente técnico', () => {
  const review = classifyCriticalJobIncident(
    { tipo: 'pricing_product_reanalysis', dedupe_key: 'product:P1' },
    { error_code: 'listing_identity_pending' },
  );
  assert.equal(review.actionable, false);
  const outage = classifyCriticalJobIncident(
    { tipo: 'pricing_product_reanalysis', dedupe_key: 'product:P1' },
    { error_code: 'listing_link_unavailable', http_status: 503 },
  );
  assert.equal(outage.actionable, true);
  assert.equal(outage.errorClass, 'provider_unavailable');
});

test('resultado comercial legado também é reconhecido quando o código está na mensagem', () => {
  const incident = classifyCriticalJobIncident(
    { tipo: 'pricing_product_reanalysis', status: 'erro', dedupe_key: 'product:P1' },
    { message: 'listing_identity_pending' },
  );
  assert.equal(incident.actionable, false);
});

test('sucesso de outro registro não representa recuperação do pedido com erro', () => {
  const failed = { tipo: 'dslite_criar_pedido', dedupe_key: 'pedido:111' };
  const unrelatedSuccess = { tipo: 'dslite_criar_pedido', dedupe_key: 'pedido:222' };
  assert.notEqual(
    `${failed.tipo}:${getCriticalJobScope(failed)}`,
    `${unrelatedSuccess.tipo}:${getCriticalJobScope(unrelatedSuccess)}`,
  );
});
