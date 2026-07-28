const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateFinalOrderProfit,
  resolveMlSellerShippingCost,
} = require('../src/lib/ml/order-profit.ts');

test('usa somente o custo final do vendedor informado pelo Mercado Livre', () => {
  const cost = resolveMlSellerShippingCost({
    senders: [
      { user_id: 10, cost: 8.19 },
      { user_id: 20, cost: 5.5 },
    ],
  }, 20);

  assert.equal(cost, 5.5);
});

test('aceita custo zero como custo final válido', () => {
  assert.equal(resolveMlSellerShippingCost({
    senders: [{ user_id: 10, cost: 0 }],
  }, 10), 0);
});

test('não inventa custo quando resposta de frete está incompleta', () => {
  assert.equal(resolveMlSellerShippingCost({ senders: [] }, 10), null);
  assert.equal(resolveMlSellerShippingCost({
    senders: [{ user_id: 10, cost: null }],
  }, 10), null);
});

test('não calcula lucro antes do custo final do frete', () => {
  assert.equal(calculateFinalOrderProfit({
    total: 89,
    productCost: 55.43,
    saleFees: 10.24,
    sellerShippingCost: null,
    tax: 3.56,
    matchedItems: 1,
  }), null);
});

test('calcula lucro final com custo real do frete', () => {
  assert.equal(calculateFinalOrderProfit({
    total: 89,
    productCost: 55.43,
    saleFees: 10.24,
    sellerShippingCost: 13.25,
    tax: 3.56,
    matchedItems: 1,
  }), 6.52);
});
