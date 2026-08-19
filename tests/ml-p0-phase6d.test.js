const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED,
  CANDIDATES,
  exactCatalogIdentity,
  protectivePrice,
} = require('../scripts/lib/ml-p0-phase6d');

test('authorized batch is exactly one hundred unique ordered SKUs', () => {
  assert.equal(ALLOWED.length, 100);
  assert.equal(CANDIDATES.length, 100);
  assert.equal(new Set(ALLOWED.map((row) => row.sku)).size, 100);
  assert.equal(ALLOWED[0].sku, 'VTK026001');
  assert.equal(ALLOWED.at(-1).sku, 'VTK004630');
  assert.ok(!ALLOWED.some((row) => row.sku === 'VTK017508'));
});

test('every candidate has a documented decision and sanitation metadata when blocked', () => {
  for (const row of ALLOWED) {
    assert.ok(['PASS', 'SOURCE_DEFERRED'].includes(row.decision) || row.decision.startsWith('BLOCK_'));
    if (row.decision !== 'PASS') {
      assert.ok(row.reason);
      assert.ok(row.sanitation);
      assert.ok(row.source);
    }
  }
});

test('catalog identity checks deterministic title evidence when configured', () => {
  const config = { catalogProductId: 'MLB1', gtin: '789', brand: 'Marca', modelAliases: [], catalogTitleAliases: ['Produto', 'Azul'], critical: {} };
  const result = { id: 'MLB1', name: 'Produto Marca Azul', settings: { listing_strategy: 'catalog_required' }, attributes: [{ id: 'GTIN', value_name: '789' }, { id: 'BRAND', value_name: 'Marca' }] };
  assert.equal(exactCatalogIdentity(result, config).passed, true);
  assert.equal(exactCatalogIdentity({ ...result, name: 'Produto Marca Vermelho' }, config).passed, false);
});

test('missing critical catalog attribute never matches an alias', () => {
  const config = { catalogProductId: 'MLB1', gtin: '789', brand: 'Marca', modelAliases: [], critical: { VOLTAGE: ['220V'] } };
  const result = { id: 'MLB1', name: 'Produto', settings: { listing_strategy: 'catalog_required' }, attributes: [{ id: 'GTIN', value_name: '789' }, { id: 'BRAND', value_name: 'Marca' }] };
  assert.equal(exactCatalogIdentity(result, config).passed, false);
});

test('protective price rounds upward and preserves 55 percent catalog buffer', () => {
  const price = protectivePrice({ cost: 100, shipping: 50, feeRate: 0.11, taxRate: 0.05, targetMargin: 0.55 });
  const margin = (price - price * 0.11 - price * 0.05 - 150) / price;
  assert.ok(margin >= 0.55);
});
