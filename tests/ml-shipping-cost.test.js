const test = require('node:test');
const assert = require('node:assert/strict');

test('frete a combinar usa o custo comercial configurado', async () => {
  const { getConfiguredMlShippingCost } = await import('../src/lib/ml/shipping-cost.ts');

  assert.equal(getConfiguredMlShippingCost('not_specified', 37.5), 37.5);
  assert.equal(getConfiguredMlShippingCost(' NOT_SPECIFIED ', 12), 12);
});

test('outros modos continuam usando a cotação do Mercado Livre', async () => {
  const { getConfiguredMlShippingCost } = await import('../src/lib/ml/shipping-cost.ts');

  assert.equal(getConfiguredMlShippingCost('me2', 30), null);
  assert.equal(getConfiguredMlShippingCost(null, 30), null);
});
