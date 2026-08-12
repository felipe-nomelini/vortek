const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateCatalogCleanupProfit,
  evaluateCatalogCleanupCandidate,
} = require('../src/lib/ml/catalog-cleanup.ts');

const base = {
  localStatus: 'pausado',
  liveStatus: 'paused',
  liveSubStatus: [],
  profit: -3.24,
};

test('calcula lucro com mesma regra da página ANÚNCIOS', () => {
  assert.equal(calculateCatalogCleanupProfit({
    price: 29.05,
    cost: 15,
    shipping: 12.35,
    mlFee: 0.13,
  }), -3.24);
});

test('aceita qualquer anúncio pausado no ERP com lucro negativo', () => {
  assert.deepEqual(evaluateCatalogCleanupCandidate(base), { eligible: true, reason: 'eligible' });
  assert.equal(evaluateCatalogCleanupCandidate({ ...base, profit: -0.01 }).eligible, true);
});

test('bloqueia status local diferente de pausado e lucro não negativo', () => {
  assert.equal(evaluateCatalogCleanupCandidate({
    ...base,
    localStatus: 'ativo',
  }).reason, 'local_status_not_paused');
  assert.equal(evaluateCatalogCleanupCandidate({ ...base, profit: 0 }).reason, 'profit_not_negative');
  assert.equal(evaluateCatalogCleanupCandidate({ ...base, profit: 0.01 }).reason, 'profit_not_negative');
});

test('aceita resíduos closed e under_review/forbidden', () => {
  assert.equal(evaluateCatalogCleanupCandidate({ ...base, liveStatus: 'closed' }).eligible, true);
  assert.equal(evaluateCatalogCleanupCandidate({
    ...base,
    liveStatus: 'under_review',
    liveSubStatus: ['forbidden'],
  }).eligible, true);
});

test('bloqueia estado ao vivo incompatível', () => {
  assert.equal(evaluateCatalogCleanupCandidate({
    ...base,
    liveStatus: 'active',
  }).reason, 'live_status_not_eligible');
  assert.equal(evaluateCatalogCleanupCandidate({
    ...base,
    liveStatus: 'under_review',
    liveSubStatus: [],
  }).reason, 'live_status_not_eligible');
});
