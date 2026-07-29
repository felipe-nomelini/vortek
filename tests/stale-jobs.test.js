const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isJobStale,
} = require('../src/lib/sync/job-staleness.ts');

test('job antigo com atividade recente não é stale', () => {
  const now = Date.now();
  assert.equal(isJobStale({
    created_at: new Date(now - 60 * 60_000).toISOString(),
    finished_at: null,
    status: 'rodando',
    log: [{ event: 'progress_snapshot', at: new Date(now - 30_000).toISOString() }],
  }, 10), false);
});

test('job sem atividade recente continua sendo stale', () => {
  const now = Date.now();
  assert.equal(isJobStale({
    created_at: new Date(now - 60 * 60_000).toISOString(),
    finished_at: null,
    status: 'rodando',
    log: [{ event: 'request_received', at: new Date(now - 59 * 60_000).toISOString() }],
  }, 10), true);
});
