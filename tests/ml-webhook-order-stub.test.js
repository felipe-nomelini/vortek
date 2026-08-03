const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveWebhookOrderSituation } = require('../src/lib/ml/webhook-order-stub.ts');

test('preserva situação final de pedido pago já hidratado', () => {
  assert.equal(resolveWebhookOrderSituation({
    orderStatus: 'paid',
    existingSituation: 'entregue',
  }), 'entregue');
});

test('cancelamento do ML prevalece sobre situação local', () => {
  assert.equal(resolveWebhookOrderSituation({
    orderStatus: 'cancelled',
    existingSituation: 'entregue',
  }), 'cancelado');
});

test('novo pedido pago começa aberto', () => {
  assert.equal(resolveWebhookOrderSituation({
    orderStatus: 'paid',
  }), 'aberto');
});
