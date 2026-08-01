const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getMlOrderIdFromHydrationJob,
  normalizeMlOrderHydrationKey,
} = require('../src/lib/sync/ml-order-hydration.ts');
const { resolveMlJobOutcome } = require('../src/lib/sync/job-outcome.ts');

test('normaliza chave de hidratação somente para pedido ML numérico', () => {
  assert.equal(normalizeMlOrderHydrationKey(' 2000017704996990 '), '2000017704996990');
  assert.equal(normalizeMlOrderHydrationKey('MLB123'), null);
  assert.equal(normalizeMlOrderHydrationKey(''), null);
});

test('recupera pedido pela chave deduplicada ou pelo log legado', () => {
  assert.equal(getMlOrderIdFromHydrationJob({ dedupe_key: '2000017705238674' }), '2000017705238674');
  assert.equal(getMlOrderIdFromHydrationJob({
    log: [{ event_type: 'webhook_dispatch', ml_order_id: '2000017704996990' }],
  }), '2000017704996990');
});

test('conflito de lock mantém hidratação em espera', () => {
  assert.equal(resolveMlJobOutcome({
    domainLockConflict: true,
    requestSucceeded: false,
    authFailure: false,
    retryOnFailure: true,
  }), 'on_hold');
});

test('job periódico equivalente ainda pode ignorar conflito de lock', () => {
  assert.equal(resolveMlJobOutcome({
    domainLockConflict: true,
    requestSucceeded: false,
    authFailure: false,
    retryOnFailure: false,
  }), 'completo');
});

test('falha transitória fica em espera, mas autenticação fatal não', () => {
  assert.equal(resolveMlJobOutcome({
    domainLockConflict: false,
    requestSucceeded: false,
    authFailure: false,
    retryOnFailure: true,
  }), 'on_hold');
  assert.equal(resolveMlJobOutcome({
    domainLockConflict: false,
    requestSucceeded: false,
    authFailure: true,
    retryOnFailure: true,
  }), 'failed_auth');
});
