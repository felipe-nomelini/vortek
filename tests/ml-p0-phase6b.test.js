const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildManualAttributes,
  buildPersistenceSql,
  classifyRemoteIdentity,
  entityHasGtin,
} = require('../scripts/lib/ml-p0-phase6b');

test('manual attributes keep only category-supported values and add local controls', () => {
  const config = { manualAttributes: [{ id: 'BRAND', value_name: 'Elgin' }, { id: 'UNSUPPORTED', value_name: 'x' }] };
  const attributes = buildManualAttributes(config, [{ id: 'BRAND' }, { id: 'ITEM_CONDITION' }, { id: 'SELLER_SKU' }], 'VTK1');
  assert.deepEqual(attributes.map((row) => row.id), ['BRAND', 'ITEM_CONDITION', 'SELLER_SKU']);
});

test('optional catalog identity does not require catalog linkage', () => {
  const item = { seller_id: 1, seller_custom_field: 'VTK1', category_id: 'MLB1', available_quantity: 2, listing_type_id: 'gold_special', condition: 'new', attributes: [{ id: 'GTIN', value_name: '0789' }, { id: 'BRAND', value_name: 'Marca' }, { id: 'MODEL', value_name: 'M1' }] };
  const result = classifyRemoteIdentity(item, { sellerId: 1, sku: 'VTK1', gtin: '789', brand: 'Marca', modelAliases: ['M1'], categoryId: 'MLB1', quantity: 2, listingTypeId: 'gold_special' });
  assert.equal(result.passed, true);
  assert.equal('catalog' in result.fields, false);
});

test('required catalog identity rejects incorrect catalog product', () => {
  const item = { seller_id: 1, seller_custom_field: 'VTK1', category_id: 'MLB1', catalog_product_id: 'MLB9', catalog_listing: true, available_quantity: 2, listing_type_id: 'gold_special', condition: 'new', attributes: [{ id: 'GTIN', value_name: '789' }, { id: 'BRAND', value_name: 'Marca' }] };
  const result = classifyRemoteIdentity(item, { sellerId: 1, sku: 'VTK1', gtin: '789', brand: 'Marca', modelAliases: [], categoryId: 'MLB1', catalogProductId: 'MLB2', quantity: 2, listingTypeId: 'gold_special' });
  assert.equal(result.passed, false);
  assert.equal(result.fields.catalog, false);
});

test('persistence transaction preserves idempotency check independently from FOUND', () => {
  const sql = buildPersistenceSql({ product: { id: '00000000-0000-0000-0000-000000000001', sku: 'VTK1', gtin: '789' }, item: { id: 'MLB1', title: 'Produto', listing_type_id: 'gold_special', price: 100, status: 'active', catalog_listing: false, pictures: [] } });
  assert.match(sql, /v_existing_found := found/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /begin;[\s\S]*commit;/);
});

test('multivalued catalog GTIN accepts the expected code', () => {
  assert.equal(entityHasGtin({ attributes: [{ id: 'GTIN', value_name: '7898419499132, 17898419502389' }] }, '7898419499132'), true);
});
