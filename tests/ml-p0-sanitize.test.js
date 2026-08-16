const test = require('node:test');
const assert = require('node:assert/strict');
const {
  auditRemoteProduct,
  buildRemoteIndex,
  classifyGtin,
  jitteredBackoff,
  selectNewStatus,
  sourceScores,
} = require('../scripts/lib/ml-p0-sanitize');

test('índice remoto inclui SKU e GTIN de item e variação', () => {
  const index = buildRemoteIndex([{
    id: 'MLB1', status: 'paused', seller_id: 10, seller_custom_field: 'VTK1',
    attributes: [{ id: 'GTIN', value_name: '7898566200414' }],
    variations: [{ attributes: [{ id: 'SELLER_SKU', value_name: 'VTK2' }] }],
  }]);
  assert.equal(index.sku.get('VTK1')[0].item_id, 'MLB1');
  assert.equal(index.sku.get('VTK2')[0].status, 'paused');
  assert.equal(index.gtin.get('7898566200414')[0].item_id, 'MLB1');
});

test('busca remota falha fechada quando scan não é confiável', () => {
  const audit = auditRemoteProduct({
    index: buildRemoteIndex([]), scanReliable: false,
    product: { sku: 'VTK1' }, dslite: {}, phase1: {}, catalogProductId: '',
  });
  assert.equal(audit.lookup_status, 'INVENTORY_SCAN_UNRELIABLE');
});

test('infraestrutura deferred não recebe score documental zero', () => {
  assert.equal(sourceScores('SOURCE_LOOKUP_DEFERRED'), null);
  const [status] = selectNewStatus({
    sourceStatus: 'SOURCE_LOOKUP_DEFERRED', identityConfirmed: false, gtinConflict: false,
    remoteAudit: { remote_listing_found: false, lookup_status: 'INVENTORY_SCAN_UNRELIABLE' },
    categoryValidated: false, attributesComplete: false, imageApproved: false,
    pricingApproved: false, contentReady: false, sensitive: false,
  });
  assert.equal(status, 'SOURCE_LOOKUP_DEFERRED');
});

test('sem GTIN não pode virar divergência de GTIN', () => {
  assert.equal(classifyGtin({
    categoryGtin: 'conditional_required', conditionalRequired: true, dsliteGtin: '',
    phase1Status: 'P0_API_ERROR', sourceStatus: 'SOURCE_LOOKUP_DEFERRED', officialConfirmsAbsent: false,
  }), 'GTIN_LOOKUP_BLOCKED');
});

test('ready exige todos gates e busca remota confiável', () => {
  const [status] = selectNewStatus({
    sourceStatus: 'SOURCE_FOUND_OFFICIAL', identityConfirmed: true, gtinConflict: false,
    remoteAudit: { remote_listing_found: false, lookup_status: 'NOT_FOUND' },
    categoryValidated: true, attributesComplete: true, imageApproved: true,
    pricingApproved: true, contentReady: true, sensitive: false,
  });
  assert.equal(status, 'P0_READY');
});

test('candidato remoto por título ou modelo bloqueia criação automática', () => {
  const [status, reason] = selectNewStatus({
    sourceStatus: 'SOURCE_FOUND_OFFICIAL', identityConfirmed: true, gtinConflict: false,
    remoteAudit: { remote_listing_found: false, lookup_status: 'TITLE_MODEL_CANDIDATE_ONLY' },
    categoryValidated: true, attributesComplete: true, imageApproved: true,
    pricingApproved: true, contentReady: true, sensitive: false,
  });
  assert.equal(status, 'P0_MANUAL_IDENTITY');
  assert.equal(reason, 'possible_remote_listing_requires_review');
});

test('backoff é exponencial e limitado', () => {
  assert.equal(jitteredBackoff(1, 1000, 5000, () => 0.5), 1000);
  assert.equal(jitteredBackoff(4, 1000, 5000, () => 0.5), 5000);
});
