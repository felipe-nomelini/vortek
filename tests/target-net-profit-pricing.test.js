const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateTargetNetProfitPrice,
} = require('../src/services/pricing.ts');

test('lucro nominal não é mais um caminho comercial executável', () => {
  for (const targetNetProfit of [0, 20, 60, 150]) {
    assert.throws(() => calculateTargetNetProfitPrice({ cost: 50, shipping: 10, mlFee: .15,
      fixedFee: 6, targetNetProfit, taxRate: .04 }), /legada aposentada/);
  }
});

test('manifesto contém nove SKUs únicos e títulos válidos', () => {
  const manifest = require('../reports/ml-shelf-and-seo-2026-08-12/create-manifest.json');
  assert.equal(manifest.items.length, 9);
  assert.equal(new Set(manifest.items.map((row) => row.sku)).size, 9);
  assert.equal(new Set(manifest.items.map((row) => row.produtoId)).size, 9);
  for (const row of manifest.items) {
    assert.match(row.familyName, /^[a-zA-Z0-9 ]+$/);
    assert.ok(row.familyName.length < 60);
    assert.ok(row.targetNetProfit > 0);
  }
});
