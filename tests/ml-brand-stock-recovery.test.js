const assert = require('node:assert/strict');
const test = require('node:test');
const identity = require('../src/lib/ml-listing-identity.ts');
const stock = require('../src/lib/ml/stock-status-policy.ts');

const evidence = { source: 'product', reference: 'P1', collectedAt: '2026-09-16T00:00:00Z', condition: 'valid' };
const item = (brand, gtin = '7908638400199') => ({ seller_custom_field: 'VTK005786', attributes: [
  { id: 'BRAND', value_name: brand }, { id: 'GTIN', value_name: gtin },
] });
const facts = { SELLER_SKU: { value: 'VTK005786', evidence: [evidence] },
  BRAND: { value: 'Storm', evidence: [evidence] }, GTIN: { value: '7908638400199', evidence: [evidence] } };
const context = aliases => ({ categoryAttributes: ['SELLER_SKU', 'BRAND', 'GTIN'].map(id => ({ id })),
  remoteEvidence: { ...evidence, source: 'mercado_livre' }, brandEquivalences: aliases });

test('equivalência aprovada reconhece Storm e Stormtech sem liberar outra marca ou GTIN', () => {
  const aliases = identity.buildBrandEquivalences([{ brand_a_key: 'storm', brand_b_key: 'stormtech' }]);
  assert.equal(identity.assessMlListingIdentity(item('Stormtech'), facts, context()).identity.status, 'CONFLITO_CONFIRMADO');
  assert.equal(identity.isMlExistingListingIdentitySafe(identity.assessMlListingIdentity(item('Stormtech'), facts, context(aliases))), true);
  assert.equal(identity.hasConfirmedMlIdentityConflict(identity.assessMlListingIdentity(item('Outra'), facts, context(aliases))), true);
  assert.equal(identity.hasConfirmedMlIdentityConflict(identity.assessMlListingIdentity(item('Stormtech', '7908638400000'), facts, context(aliases))), true);
});

test('somente pausa por estoque ou pausa explicitamente assumida pode ser retomada', () => {
  const base = { status: 'paused', remoteLastUpdated: '2026-09-16T10:00:00Z' };
  assert.equal(stock.mayReactivateAfterStock({ ...base, subStatus: ['out_of_stock'] }), true);
  assert.equal(stock.mayReactivateAfterStock({ ...base, subStatus: ['paused_by_seller'] }), false);
  assert.equal(stock.mayReactivateAfterStock({ ...base, subStatus: ['paused_by_seller'], ownedPauseLastUpdated: base.remoteLastUpdated }), true);
  assert.equal(stock.mayReactivateAfterStock({ ...base, subStatus: ['paused_by_seller'], ownedPauseLastUpdated: '2026-09-16T09:00:00Z' }), false);
  assert.equal(stock.mayReactivateAfterStock({ ...base, status: 'closed', subStatus: ['out_of_stock'] }), false);
});
