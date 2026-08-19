const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCatalogAttributes,
  financialAt,
  missingRequiredAttributes,
  nextProtectivePrice,
  normalizeGtin,
} = require('../scripts/lib/ml-p0-phase6a');

test('normalizes GTIN padding without changing identity', () => {
  assert.equal(normalizeGtin('07891112359253'), normalizeGtin('7891112359253'));
});

test('protective price rounds upward and produces positive safety buffer', () => {
  const price = nextProtectivePrice({ cost: 100, shipping: 50, commission: 30, currentPrice: 250 });
  assert.ok(Math.abs((price % 10) - 9.9) < 1e-9);
  assert.ok(price > 250);
});

test('financial calculation uses configured five percent tax', () => {
  const result = financialAt({ price: 500, commission: 50, shipping: 50, cost: 100 });
  assert.equal(result.tax, 25);
  assert.equal(result.profit, 275);
  assert.equal(result.margin_percent, 55);
});

test('catalog payload preserves value ids and injects condition and seller sku', () => {
  const category = [{ id: 'BRAND', tags: { required: true } }, { id: 'MODEL', tags: { required: true } }];
  const catalog = { attributes: [{ id: 'BRAND', value_id: '1', value_name: 'Marca' }, { id: 'MODEL', value_name: 'M1' }] };
  const attrs = buildCatalogAttributes(catalog, category, 'VTK1');
  assert.equal(attrs.find((row) => row.id === 'BRAND').value_id, '1');
  assert.equal(attrs.find((row) => row.id === 'SELLER_SKU').value_name, 'VTK1');
  assert.deepEqual(missingRequiredAttributes(attrs, ['BRAND', 'MODEL']), []);
});
