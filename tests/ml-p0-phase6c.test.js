const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED,
  buildManualAttributes,
  buildPersistenceSql,
  classifyRemoteIdentity,
  feeComponents,
  protectivePrice,
} = require('../scripts/lib/ml-p0-phase6c');

test('authorized batch is exactly fifty unique ordered SKUs', () => {
  assert.equal(ALLOWED.length, 50);
  assert.equal(new Set(ALLOWED.map((row) => row.sku)).size, 50);
  assert.equal(ALLOWED[0].sku, 'VTK017508');
  assert.equal(ALLOWED.at(-1).sku, 'VTK017783');
});

test('manual attributes are limited by category contract', () => {
  const config = { manualAttributes: [{ id: 'BRAND', value_name: 'Saty' }, { id: 'UNKNOWN', value_name: 'x' }] };
  const rows = buildManualAttributes(config, [{ id: 'BRAND' }, { id: 'SELLER_SKU' }, { id: 'ITEM_CONDITION' }], 'VTK1');
  assert.deepEqual(rows.map((row) => row.id), ['BRAND', 'ITEM_CONDITION', 'SELLER_SKU']);
});

test('protective price is solved in closed form and rounded upward', () => {
  const price = protectivePrice({ cost: 100, shipping: 50, feeRate: 0.11, taxRate: 0.05, targetMargin: 0.52 });
  assert.equal(price, 469.9);
  const margin = (price - price * 0.11 - price * 0.05 - 150) / price;
  assert.ok(margin >= 0.52);
});

test('fee components prefer explicit API details', () => {
  assert.deepEqual(feeComponents({ sale_fee_amount: 12, sale_fee_details: { percentage_fee: 11, fixed_fee: 1 } }, 100), { rate: 0.11, fixed: 1, source: 'sale_fee_details' });
});

test('remote identity supports leading-zero GTIN and optional catalog', () => {
  const item = { seller_id: 1, seller_custom_field: 'VTK1', category_id: 'MLB1', available_quantity: 2, listing_type_id: 'gold_special', condition: 'new', attributes: [{ id: 'GTIN', value_name: '0789' }, { id: 'BRAND', value_name: 'Marca' }, { id: 'MODEL', value_name: 'M1' }] };
  const result = classifyRemoteIdentity(item, { sellerId: 1, sku: 'VTK1', gtin: '789', brand: 'Marca', modelAliases: ['M1'], categoryId: 'MLB1', quantity: 2, listingTypeId: 'gold_special' });
  assert.equal(result.passed, true);
});

test('persistence SQL is transactional, locked and idempotent', () => {
  const sql = buildPersistenceSql({ product: { id: '00000000-0000-0000-0000-000000000001', sku: 'VTK1', gtin: '789' }, item: { id: 'MLB1', title: 'Produto', listing_type_id: 'gold_special', price: 100, status: 'active', catalog_listing: false, pictures: [] } });
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /ALREADY_CONSISTENT/);
  assert.match(sql, /begin;[\s\S]*commit;/);
});
