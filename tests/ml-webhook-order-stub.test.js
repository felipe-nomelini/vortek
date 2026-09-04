const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveWebhookOrderSituation,
  shouldAlertNewSaleFromWebhook,
} = require('../src/lib/ml/webhook-order-stub.ts');

test('alerta nova venda somente quando pedido pago acaba de ser inserido', () => {
  assert.equal(shouldAlertNewSaleFromWebhook({
    orderStatus: 'paid',
    persistenceAction: 'inserted',
  }), true);
});

test('atualização de pedido pago nunca vira alerta de nova venda', () => {
  assert.equal(shouldAlertNewSaleFromWebhook({
    orderStatus: 'paid',
    persistenceAction: 'updated',
  }), false);
});

test('pedido novo sem pagamento aprovado não gera alerta', () => {
  assert.equal(shouldAlertNewSaleFromWebhook({
    orderStatus: 'cancelled',
    persistenceAction: 'inserted',
  }), false);
});

test('stub pendente atualizado permanece delegado para hidratação', () => {
  assert.equal(shouldAlertNewSaleFromWebhook({
    orderStatus: 'paid',
    persistenceAction: 'updated',
  }), false);
});

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
