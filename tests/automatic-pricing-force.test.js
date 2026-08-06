const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveAutomaticPricingProductIds } = require('../src/lib/ml/automatic-pricing-selection.ts');

test('mantém regra normal: preço automático apenas quando custo muda', () => {
  const ids = resolveAutomaticPricingProductIds([
    { productId: 'same', previous: { custo: 10 }, next: { custo: 10 } },
    { productId: 'changed', previous: { custo: 10 }, next: { custo: 12 } },
  ]);

  assert.deepEqual(ids, ['changed']);
});

test('força reconciliação de preço do kit mesmo com custo já recalculado', () => {
  const ids = resolveAutomaticPricingProductIds([
    { productId: 'kit', previous: { custo: 50 }, next: { custo: 50 } },
  ], ['kit', 'kit']);

  assert.deepEqual(ids, ['kit']);
});
