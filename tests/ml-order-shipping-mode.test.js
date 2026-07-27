const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseMlOrderShippingMode,
  resolveMlOrderSituation,
} = require('../src/lib/ml/order-shipping-mode.ts');

test('no_shipping fulfilled prevalece sobre tag residual not_delivered', () => {
  const shippingMode = parseMlOrderShippingMode({
    fulfilled: true,
    tags: ['no_shipping', 'paid', 'not_delivered'],
    shipping: { id: null },
  });

  assert.equal(shippingMode.isNoShipping, true);
  assert.equal(shippingMode.isNoShippingFulfilled, true);
  assert.equal(resolveMlOrderSituation({
    status: 'paid',
    tags: shippingMode.tags,
    isReturned: false,
    isNoShippingFulfilled: shippingMode.isNoShippingFulfilled,
  }), 'entregue');
});

test('fulfilled não substitui status de shipment do Mercado Envios', () => {
  const shippingMode = parseMlOrderShippingMode({
    fulfilled: true,
    tags: ['paid'],
    shipping: { id: 123456 },
  });

  assert.equal(shippingMode.isNoShipping, false);
  assert.equal(shippingMode.isNoShippingFulfilled, false);
});

test('devolução confirmada mantém prioridade', () => {
  assert.equal(resolveMlOrderSituation({
    status: 'paid',
    tags: ['no_shipping', 'not_delivered'],
    isReturned: true,
    isNoShippingFulfilled: true,
  }), 'devolvido');
});
