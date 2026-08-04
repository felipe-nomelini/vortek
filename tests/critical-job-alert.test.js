const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CRITICAL_JOB_TIMEOUT_GRACE_MS,
  decideCriticalJobAlert,
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
