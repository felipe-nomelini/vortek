const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isModifiableMlListingStatus,
  operationalMlStatus,
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

test('lucro inclui imposto operacional de cinco por cento', () => {
  assert.equal(calculateNetProfitAtPrice({
    price: 364.13,
    cost: 215,
    shipping: 44.05,
    mlFee: 0.16,
  }), 28.61);
});
