const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PRODUCT_COST_INACTIVE_THRESHOLD,
  shouldSupplierOfferBeInactiveByCost,
} = require('../src/lib/product-activity.ts');

test('limite de custo inativa somente a oferta acima de R$ 2.000', () => {
  assert.equal(PRODUCT_COST_INACTIVE_THRESHOLD, 2000);
  assert.equal(shouldSupplierOfferBeInactiveByCost(2000), false);
  assert.equal(shouldSupplierOfferBeInactiveByCost(2000.01), true);
  assert.equal(shouldSupplierOfferBeInactiveByCost('inválido'), false);
});
