const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveWebhookOrderSituation,
  shouldHydrateWebhookOrder,
} = require('../src/lib/ml/webhook-order-stub.ts');

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

test('pedido pago em trânsito volta à hidratação quando há pagamento aprovado identificável', () => {
  assert.equal(shouldHydrateWebhookOrder({
    order: { status: 'paid', payments: [{ id: 123, status: 'approved' }] },
    existing: {
      id: 'pedido-1',
      situacao: 'em_transito',
      snapshot_incompleto: false,
      sincronizado_em: '2026-09-05T12:00:00.000Z',
    },
  }), true);
});

test('pedido hidratado fora da condição financeira não é reenfileirado', () => {
  const existing = {
    id: 'pedido-1',
    situacao: 'em_transito',
    snapshot_incompleto: false,
    sincronizado_em: '2026-09-05T12:00:00.000Z',
  };
  assert.equal(shouldHydrateWebhookOrder({
    order: { status: 'paid', payments: [{ id: null, status: 'approved' }] },
    existing,
  }), false);
  assert.equal(shouldHydrateWebhookOrder({
    order: { status: 'paid', payments: [{ id: 123, status: 'approved' }] },
    existing: { ...existing, situacao: 'entregue' },
  }), false);
});
