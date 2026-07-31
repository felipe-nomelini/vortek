const assert = require('node:assert/strict');
const test = require('node:test');

const { isMlOrderPaid } = require('../src/lib/ml/order-sale-alert.ts');

test('aceita somente pedido pago como nova venda', () => {
  assert.equal(isMlOrderPaid({ status: 'paid' }), true);
  assert.equal(isMlOrderPaid({ status: ' PAID ' }), true);
  assert.equal(isMlOrderPaid({ status: 'cancelled' }), false);
  assert.equal(isMlOrderPaid({ status: 'payment_in_process' }), false);
  assert.equal(isMlOrderPaid({ status: 'confirmed' }), false);
  assert.equal(isMlOrderPaid(null), false);
});
