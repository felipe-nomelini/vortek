const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { assessMlSaleConcretization } = require('../src/lib/ml/sale-concretization.ts');
const { mapearStatusShipment } = require('../src/lib/ml/shipment-status.ts');
const {
  getOrderSalesProgress,
  isPostDispatchOrder,
  matchesOrdersOperationalView,
} = require('../src/lib/orders/operational-view.ts');

const releasedPayment = {
  id: 1,
  status: 'approved',
  money_release_status: 'released',
  money_release_date: '2026-09-05T03:00:00.000-03:00',
  transaction_amount_refunded: 0,
};

function assess(overrides = {}) {
  return assessMlSaleConcretization({
    orderStatus: 'paid',
    shipmentStatus: 'shipped',
    shipmentSubstatus: 'stale',
    hasClaim: false,
    isReturned: false,
    claimLookupComplete: true,
    paymentLookupComplete: true,
    payments: [releasedPayment],
    ...overrides,
  });
}

test('concretiza venda paga, sem claim, com envio stale e pagamentos integralmente liberados', () => {
  assert.deepEqual(assess(), { concretized: true, reason: 'concretized' });
});

test('não concretiza pedido não pago nem envio fora de shipped/stale', () => {
  assert.equal(assess({ orderStatus: 'confirmed' }).reason, 'order_not_paid');
  assert.equal(assess({ shipmentSubstatus: 'out_for_delivery' }).reason, 'shipment_not_stale');
  assert.equal(assess({ shipmentStatus: 'delivered', shipmentSubstatus: null }).reason, 'shipment_not_stale');
});

test('claim ou devolução sempre bloqueiam a concretização', () => {
  assert.equal(assess({ hasClaim: true }).reason, 'claim_or_return');
  assert.equal(assess({ isReturned: true }).reason, 'claim_or_return');
});

test('consulta incompleta ou ausência de pagamentos não produz inferência', () => {
  assert.equal(assess({ claimLookupComplete: false }).reason, 'claim_lookup_incomplete');
  assert.equal(assess({ paymentLookupComplete: false }).reason, 'payment_lookup_incomplete');
  assert.equal(assess({ payments: [] }).reason, 'payment_lookup_incomplete');
});

test('todos os pagamentos precisam estar aprovados, liberados e sem reembolso', () => {
  assert.equal(assess({
    payments: [releasedPayment, { ...releasedPayment, id: 2, status: 'cancelled' }],
  }).reason, 'payment_not_released');
  assert.equal(assess({
    payments: [releasedPayment, { ...releasedPayment, id: 2, money_release_status: 'pending' }],
  }).reason, 'payment_not_released');
  assert.equal(assess({
    payments: [{ ...releasedPayment, transaction_amount_refunded: 1 }],
  }).reason, 'payment_refunded');
});

test('webhook shipped/stale preserva concretizada_ml sem bloquear transições canônicas posteriores', () => {
  assert.equal(mapearStatusShipment('shipped', 'stale', 'concretizada_ml'), 'concretizada_ml');
  assert.equal(mapearStatusShipment('delivered', undefined, 'concretizada_ml'), 'entregue');
  assert.equal(mapearStatusShipment('not_delivered', 'refused_delivery', 'concretizada_ml'), 'recusado');
  assert.equal(mapearStatusShipment('cancelled', undefined, 'concretizada_ml'), 'cancelado');
});

test('concretizada_ml é pós-despacho, não aparece como em transporte ou entregue', () => {
  const order = { situacao: 'concretizada_ml' };
  assert.equal(isPostDispatchOrder(order), true);
  assert.equal(matchesOrdersOperationalView(order, 'shipping', 60), false);
  assert.equal(matchesOrdersOperationalView(order, 'delivered', 60), false);
  assert.equal(matchesOrdersOperationalView(order, 'all', 60), true);
});

test('progresso comunica 5/6 sem classificar a venda como sucesso de entrega', () => {
  const progress = getOrderSalesProgress({ situacao: 'concretizada_ml' });
  assert.deepEqual(
    [progress.completedSteps, progress.currentStep, progress.currentLabel, progress.nextLabel, progress.tone],
    [5, 6, 'Entrega', 'Concretizada pelo ML, sem entrega confirmada', 'normal'],
  );
});

test('consulta financeira usa o OAuth do Mercado Livre e não o token do app Mercado Pago', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/mercadopago.ts'),
    'utf8',
  );
  const method = source.slice(source.indexOf('export async function getMercadoPagoPaymentForMlSale'));
  assert.match(method, /getValidMLToken\(\)/);
  assert.match(method, /\/v1\/payments\/\$\{encodeURIComponent\(cleanId\)\}/);
  assert.doesNotMatch(method.split('export function buildUtcRange')[0], /getMercadoPagoAccessToken\(\)/);
});

test('migration é nova e adiciona somente o valor do enum no DEV', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260905120000_bnt_parity_07_concretizada_ml.sql'),
    'utf8',
  );
  assert.match(migration, /alter type public\.pedido_status/);
  assert.match(migration, /add value if not exists 'concretizada_ml'/);
  assert.doesNotMatch(migration, /insert|update|delete|drop|truncate/i);
});

test('rotas operacionais bloqueiam efeitos externos para venda concretizada', () => {
  const routes = [
    '../src/app/api/dslite/pedido/route.ts',
    '../src/app/api/dslite/frete/route.ts',
    '../src/app/api/dslite/etiqueta-auto/route.ts',
    '../src/app/api/compras/[id]/confirmar-pagamento/route.ts',
    '../src/app/api/compras/[id]/enviar-etiqueta-whatsapp/route.ts',
    '../src/app/api/pedidos/[id]/enviar-etiqueta-whatsapp/route.ts',
  ];
  for (const route of routes) {
    const source = fs.readFileSync(path.join(__dirname, route), 'utf8');
    assert.match(source, /situacao === 'concretizada_ml'/, route);
    assert.match(source, /status: 409|, 409,/, route);
  }
});

test('job de etiqueta já enfileirado encerra como não aplicável sem retry', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/whatsapp-label-job.ts'),
    'utf8',
  );
  const guardStart = source.indexOf("situacao === 'concretizada_ml'");
  const guardEnd = source.indexOf("await setStep('resolve_shipment'", guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /queueStatus: 'not_applicable'/);
  assert.match(guard, /reason: 'order_concretized_by_ml'/);
  assert.match(guard, /state = 'warning'/);
  assert.match(guard, /return;/);
  assert.doesNotMatch(guard, /queueStatus: 'on_hold'/);
});
