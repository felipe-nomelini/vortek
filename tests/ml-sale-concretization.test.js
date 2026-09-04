const assert = require('node:assert/strict');
const test = require('node:test');

const { assessMlSaleConcretization } = require('../src/lib/ml/sale-concretization.ts');
const { mapearStatusShipment } = require('../src/lib/ml/shipment-status.ts');
const {
  isPostDispatchOrder,
  matchesOrdersOperationalView,
} = require('../src/lib/orders/operational-view.ts');

const releasedPayment = {
  id: 1,
  status: 'approved',
  money_release_status: 'released',
  money_release_date: '2026-08-31T21:14:32.000-04:00',
  transaction_amount_refunded: 0,
};

test('concretiza venda paga e liberada cujo envio permaneceu shipped/stale', () => {
  assert.deepEqual(assessMlSaleConcretization({
    orderStatus: 'paid',
    shipmentStatus: 'shipped',
    shipmentSubstatus: 'stale',
    hasClaim: false,
    isReturned: false,
    claimLookupComplete: true,
    paymentLookupComplete: true,
    payments: [releasedPayment],
  }), { concretized: true, reason: 'concretized' });
});

test('exige que todos os pagamentos aprovados estejam liberados', () => {
  const result = assessMlSaleConcretization({
    orderStatus: 'paid',
    shipmentStatus: 'shipped',
    shipmentSubstatus: 'stale',
    hasClaim: false,
    isReturned: false,
    claimLookupComplete: true,
    paymentLookupComplete: true,
    payments: [releasedPayment, { ...releasedPayment, id: 2, money_release_status: 'pending' }],
  });
  assert.equal(result.concretized, false);
  assert.equal(result.reason, 'payment_not_released');
});

test('não concretiza quando houve reembolso, reclamação ou consulta incompleta', () => {
  for (const override of [
    { payments: [{ ...releasedPayment, transaction_amount_refunded: 1 }] },
    { hasClaim: true },
    { isReturned: true },
    { claimLookupComplete: false },
    { paymentLookupComplete: false },
  ]) {
    const result = assessMlSaleConcretization({
      orderStatus: 'paid',
      shipmentStatus: 'shipped',
      shipmentSubstatus: 'stale',
      hasClaim: false,
      isReturned: false,
      claimLookupComplete: true,
      paymentLookupComplete: true,
      payments: [releasedPayment],
      ...override,
    });
    assert.equal(result.concretized, false);
  }
});

test('entrega confirmada não é substituída por concretização financeira', () => {
  const result = assessMlSaleConcretization({
    orderStatus: 'paid',
    shipmentStatus: 'delivered',
    shipmentSubstatus: null,
    hasClaim: false,
    isReturned: false,
    claimLookupComplete: true,
    paymentLookupComplete: true,
    payments: [releasedPayment],
  });
  assert.equal(result.concretized, false);
  assert.equal(mapearStatusShipment('delivered', null, 'concretizada_ml'), 'entregue');
});

test('webhook shipped/stale não rebaixa venda já concretizada', () => {
  assert.equal(
    mapearStatusShipment('shipped', 'stale', 'concretizada_ml'),
    'concretizada_ml',
  );
  assert.equal(mapearStatusShipment('not_delivered', 'returned', 'concretizada_ml'), 'dest_ausente');
  assert.equal(mapearStatusShipment('cancelled', null, 'concretizada_ml'), 'cancelado');
});

test('status concretizada fica fora de transporte e entregues e bloqueia ações operacionais', () => {
  const order = { situacao: 'concretizada_ml' };
  assert.equal(isPostDispatchOrder(order), true);
  assert.equal(matchesOrdersOperationalView(order, 'shipping'), false);
  assert.equal(matchesOrdersOperationalView(order, 'delivered'), false);
  assert.equal(matchesOrdersOperationalView(order, 'all'), true);
});
