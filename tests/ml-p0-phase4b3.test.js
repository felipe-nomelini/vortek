const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED,
  buildListingPayload,
  buildLocalRemoteDiff,
  classifyLocalState,
  compareStableRemoteState,
  stableRemoteCommercialState,
  validateRemoteIdentity,
} = require('../scripts/lib/ml-p0-phase4b3');

function item() {
  return {
    id: EXPECTED.itemId,
    seller_id: EXPECTED.sellerId,
    seller_custom_field: EXPECTED.sku,
    user_product_id: EXPECTED.userProductId,
    family_id: Number(EXPECTED.familyId),
    title: 'Carregador De Pilhas Toshiba Tnhc-6gae4 Cb',
    status: 'active',
    price: EXPECTED.price,
    available_quantity: EXPECTED.quantity,
    sold_quantity: 0,
    category_id: EXPECTED.categoryId,
    listing_type_id: EXPECTED.listingTypeId,
    condition: EXPECTED.condition,
    shipping: { mode: 'me2' },
    catalog_listing: false,
    permalink: 'https://example.test/item',
    pictures: [{ secure_url: 'https://example.test/image.jpg' }],
    attributes: [
      ['SELLER_SKU', EXPECTED.sku], ['GTIN', EXPECTED.gtin], ['BRAND', EXPECTED.brand],
      ['MODEL', EXPECTED.model], ['PRODUCT_TYPE', EXPECTED.productType], ['INPUT_VOLTAGE', EXPECTED.inputVoltage],
    ].map(([id, value_name]) => ({ id, value_name })),
  };
}

test('validates all critical remote identity and commercial gates', () => {
  const result = validateRemoteIdentity(item(), { id: EXPECTED.userProductId, family_id: Number(EXPECTED.familyId) }, { family_id: Number(EXPECTED.familyId) });
  assert.equal(result.identityMismatch, false);
  assert.equal(result.commercialDrift, false);
});

test('classifies clean, concurrent, and already-consistent local states', () => {
  const product = { id: EXPECTED.productId, sku: EXPECTED.sku, ml_item_id: null };
  const base = { product, productBySku: product, itemListings: [], productListings: [], skuListings: [], otherProducts: [] };
  assert.equal(classifyLocalState(base).state, 'CLEAR');
  assert.equal(classifyLocalState({ ...base, product: { ...product, ml_item_id: 'MLBOTHER' } }).state, 'CONCURRENT_LINK');
  const exact = { ml_item_id: EXPECTED.itemId, produto_id: EXPECTED.productId, sku: EXPECTED.sku };
  assert.equal(classifyLocalState({ ...base, product: { ...product, ml_item_id: EXPECTED.itemId }, itemListings: [exact], productListings: [exact], skuListings: [exact], otherProducts: [{ id: EXPECTED.productId }] }).state, 'ALREADY_CONSISTENT');
});

test('builds schema-compatible premium listing and reconciles it', () => {
  const remote = item();
  const listing = buildListingPayload(remote);
  assert.equal(listing.tipo, 'premium');
  assert.equal(listing.status, 'ativo');
  const diff = buildLocalRemoteDiff({ ml_item_id: EXPECTED.itemId }, listing, remote);
  assert.equal(diff.material_drift, false);
});

test('detects a Mercado Livre picture replacement as remote drift', () => {
  const before = stableRemoteCommercialState(item(), null, null);
  const changed = item();
  changed.pictures[0] = { secure_url: 'https://example.test/reprocessed.jpg', id: 'new-id' };
  const after = stableRemoteCommercialState(changed, null, null);
  const diff = compareStableRemoteState(before, after);
  assert.equal(diff.drift, true);
  assert.equal(diff.fields[0].field, 'pictures[0]');
});
