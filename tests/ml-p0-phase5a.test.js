const test = require('node:test');
const assert = require('node:assert/strict');
const { assertAuditPayload, finalState, remoteMatch } = require('../scripts/lib/ml-p0-phase5a');

test('blocking state precedence isolates remote, local and GTIN conflicts', () => {
  const base = { remote_exact: false, remote_possible: false, local_duplicate: false, gtin_conflict: false, identity_confirmed: true, category_valid: true, image_approved: true, attributes_complete: true, financial_approved: true, source_deferred: false };
  assert.equal(finalState(base), 'MULTI_CANARY_READY');
  assert.equal(finalState({ ...base, gtin_conflict: true }), 'MANUAL_GTIN');
  assert.equal(finalState({ ...base, remote_exact: true, gtin_conflict: true }), 'BLOCK_REMOTE_EXISTING');
});

test('generic brand and model do not create a possible match without variant evidence', () => {
  const item = { title: 'Ventilador Ventisol Turbo 6 50cm Azul 220V', attributes: [{ id: 'BRAND', value_name: 'Ventisol' }, { id: 'MODEL', value_name: 'Turbo 6' }] };
  const match = remoteMatch(item, { sku: 'VTK000392', gtin: '7898461970375', brand: 'Ventisol', model: 'Turbo 6', distinguishing_attributes: { DIAMETER: ['40cm'], VOLTAGE: ['127V'], BLADES_COLOR: ['Azul'] } });
  assert.equal(match.classification, 'NOT_MATCH');
});

test('remote exact match uses SKU, GTIN or catalog identity', () => {
  const item = { id: 'MLB1', seller_custom_field: 'OTHER', catalog_product_id: null, attributes: [{ id: 'GTIN', value_name: '7891234567890' }] };
  const match = remoteMatch(item, { sku: 'VTK1', gtin: '7891234567890', brand: 'X', model: 'Y' });
  assert.equal(match.classification, 'EXACT_REMOTE_MATCH');
  assert.equal(match.confidence, 100);
});

test('User Products previews never carry title, description or variations', () => {
  const valid = { family_name: 'Mouse Intelbras MSI 50', category_id: 'MLB1714', price: 100, available_quantity: 1, attributes: [] };
  assert.equal(assertAuditPayload(valid), true);
  assert.equal(assertAuditPayload({ ...valid, title: 'forbidden' }), false);
  assert.equal(assertAuditPayload({ ...valid, description: {} }), false);
});
