const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyMlPublishEligibility,
  classifyMlPublishFailure,
  isModifiableMlListingStatus,
  operationalMlStatus,
  resolveMlPublishBlockPatch,
  selectOperationalMlListing,
} = require('../src/lib/ml/operational-listing.ts');
const { calculateNetProfitAtPrice } = require('../src/services/pricing.ts');

test('prefere anúncio tradicional ativo ao catálogo fechado', () => {
  const selected = selectOperationalMlListing([
    { ml_item_id: 'MLB-CATALOGO', status: 'closed', catalog_listing: true },
    { ml_item_id: 'MLB-TRADICIONAL', status: 'active', catalog_listing: false },
  ]);

  assert.equal(selected?.ml_item_id, 'MLB-TRADICIONAL');
  assert.equal(operationalMlStatus(selected), 'ativo');
});

test('nunca considera anúncio closed modificável', () => {
  assert.equal(isModifiableMlListingStatus('closed'), false);
  assert.equal(isModifiableMlListingStatus('active'), true);
  assert.equal(isModifiableMlListingStatus('paused'), true);
});

test('centraliza elegibilidade de publicação por estado observado e bloqueio', () => {
  assert.equal(classifyMlPublishEligibility({ observedStatus: 'active' }).kind, 'modifiable');
  assert.equal(classifyMlPublishEligibility({ observedStatus: 'paused' }).kind, 'modifiable');

  for (const status of ['under_review', 'closed', 'inactive']) {
    const eligibility = classifyMlPublishEligibility({ observedStatus: status });
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.kind, 'terminally_blocked');
  }

  assert.equal(classifyMlPublishEligibility({ observedStatus: 'not_yet_active' }).kind, 'unknown');
  assert.equal(classifyMlPublishEligibility({
    observedStatus: 'closed',
    deleteListing: true,
  }).eligible, true);
});

test('respeita cooldown futuro e ignora bloqueio vencido', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');
  assert.equal(classifyMlPublishEligibility({
    observedStatus: 'active',
    blockedUntil: '2026-08-30T13:00:00.000Z',
    blockReason: 'field_not_updatable',
    now,
  }).kind, 'temporarily_blocked');
  assert.equal(classifyMlPublishEligibility({
    blockedUntil: '2026-08-30T11:00:00.000Z',
    blockReason: 'field_not_updatable',
    now,
  }).kind, 'unknown');
});

test('classifica falhas de publicação transitórias e terminais', () => {
  assert.deepEqual(classifyMlPublishFailure({ status: 409 }), {
    kind: 'retryable',
    retryConflict: true,
  });
  assert.equal(classifyMlPublishFailure({ status: 429 }).kind, 'retryable');
  assert.equal(classifyMlPublishFailure({ status: 503 }).kind, 'retryable');
  assert.equal(classifyMlPublishFailure({ status: 401, category: 'auth_fatal' }).kind, 'auth_terminal');
  assert.equal(classifyMlPublishFailure({ status: 422 }).kind, 'terminal');
  assert.equal(classifyMlPublishFailure({ code: 'ml_stock_warehouse_mapping_required' }).kind, 'terminal');
  assert.equal(classifyMlPublishFailure({
    status: 400,
    code: 'field_not_updatable',
    error: 'Cannot update item MLB1 with status:under_review',
  }).kind, 'non_modifiable');
});

test('reconciliação persiste bloqueio terminal e limpa quando volta a ser modificável', () => {
  assert.deepEqual(resolveMlPublishBlockPatch('under_review', {
    ml_sync_block_reason: null,
    ml_sync_blocked_until: null,
    ml_sync_last_error: null,
  }), {
    ml_sync_block_reason: 'non_modifiable_status:under_review',
    ml_sync_last_error: 'Estado observado no Mercado Livre não aceita publicação comum: under_review',
  });

  assert.deepEqual(resolveMlPublishBlockPatch('active', {
    ml_sync_block_reason: 'non_modifiable_status:under_review',
    ml_sync_blocked_until: '2026-08-31T10:00:00.000Z',
    ml_sync_last_error: 'erro anterior',
  }), {
    ml_sync_block_reason: null,
    ml_sync_blocked_until: null,
    ml_sync_last_error: null,
  });
});

test('lucro inclui imposto operacional de cinco por cento', () => {
  assert.equal(calculateNetProfitAtPrice({
    price: 364.13,
    cost: 215,
    shipping: 44.05,
    mlFee: 0.16,
  }), 28.61);
});
