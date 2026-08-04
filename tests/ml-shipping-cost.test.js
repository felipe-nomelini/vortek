const test = require('node:test');
const assert = require('node:assert/strict');

test('frete a combinar usa custo fixo de R$ 30', async () => {
  const {
    NOT_SPECIFIED_FIXED_SHIPPING_COST,
    getConfiguredMlShippingCost,
  } = await import('../src/lib/ml/shipping-cost.ts');

  assert.equal(NOT_SPECIFIED_FIXED_SHIPPING_COST, 30);
  assert.equal(getConfiguredMlShippingCost('not_specified'), 30);
  assert.equal(getConfiguredMlShippingCost(' NOT_SPECIFIED '), 30);
});

test('outros modos continuam usando a cotação do Mercado Livre', async () => {
  const { getConfiguredMlShippingCost } = await import('../src/lib/ml/shipping-cost.ts');

  assert.equal(getConfiguredMlShippingCost('me2'), null);
  assert.equal(getConfiguredMlShippingCost(null), null);
});
