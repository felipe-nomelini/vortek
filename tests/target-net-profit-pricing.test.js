const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateTargetNetProfitPrice,
  TARGET_NET_PROFIT_TAX_RATE,
} = require('../src/services/pricing.ts');

test('calcula preço para lucro líquido nominal com imposto de 4%', () => {
  assert.equal(TARGET_NET_PROFIT_TAX_RATE, 0.04);
  assert.equal(calculateTargetNetProfitPrice({
    cost: 28.1,
    shipping: 6.5,
    mlFee: 0.165,
    targetNetProfit: 60.13,
  }), 119.16);
});

test('inclui tarifa fixa no preço do lucro alvo', () => {
  assert.equal(calculateTargetNetProfitPrice({
    cost: 50,
    shipping: 10,
    mlFee: 0.15,
    fixedFee: 6,
    targetNetProfit: 20,
  }), 106.17);
});

test('rejeita taxa ou valores inválidos', () => {
  assert.throws(() => calculateTargetNetProfitPrice({
    cost: -1,
    shipping: 0,
    mlFee: 0.15,
    targetNetProfit: 20,
  }), /Dados inválidos/);
  assert.throws(() => calculateTargetNetProfitPrice({
    cost: 1,
    shipping: 0,
    mlFee: 0.97,
    targetNetProfit: 20,
  }), /inferior a 100%/);
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
