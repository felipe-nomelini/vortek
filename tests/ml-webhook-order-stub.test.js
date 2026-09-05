const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const {
  resolveWebhookOrderSituation,
  shouldAlertNewSaleFromWebhook,
  shouldHydrateWebhookOrder,
} = require('../src/lib/ml/webhook-order-stub.ts');

test('nova venda exige inserção confirmada e pagamento, inclusive nas reentregas', () => {
  for (const persistenceAction of ['inserted', 'updated', null, undefined]) {
    for (const orderStatus of ['paid', ' PAID ', 'cancelled', 'payment_in_process', null, undefined]) {
      assert.equal(shouldAlertNewSaleFromWebhook({ persistenceAction, orderStatus }),
        persistenceAction === 'inserted' && ['paid', ' PAID '].includes(orderStatus),
        `${persistenceAction}/${orderStatus}`);
    }
  }
});

test('webhook inicia WhatsApp e Push uma vez; atualização de stub não inicia alertas', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app/api/webhooks/ml/notifications/route.ts'), 'utf8');
  const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  let alertGate;
  const alertCalls = [];
  function visit(node) {
    if (ts.isIfStatement(node) && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(ast) === 'shouldAlertNewSaleFromWebhook') alertGate = node;
    if (ts.isCallExpression(node) && ['alertNewSale', 'pushEvents().newSale'].includes(node.expression.getText(ast))) {
      alertCalls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(alertGate, 'gate deve estar conectado ao webhook');
  assert.equal(alertCalls.length, 2);
  assert.ok(alertCalls.every((call) => call.pos > alertGate.pos && call.end < alertGate.end),
    'ambos os canais precisam estar protegidos pelo gate');
  const code = ts.transpileModule(alertGate.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = { whatsapp: 0, push: 0 };
  const context = {
    shouldAlertNewSaleFromWebhook,
    pedidoId: 'pedido-teste',
    order: { id: 123, status: 'paid', total_amount: 100 },
    stubResult: { action: 'inserted' },
    alertNewSale: () => { calls.whatsapp += 1; },
    pushEvents: () => ({ newSale: async () => { calls.push += 1; } }),
  };
  vm.runInNewContext(code, context);
  assert.deepEqual(calls, { whatsapp: 1, push: 1 });
  context.stubResult = { action: 'updated' };
  vm.runInNewContext(code, context);
  vm.runInNewContext(code, context);
  context.stubResult = null;
  vm.runInNewContext(code, context);
  context.stubResult = { action: 'inserted' };
  context.order.status = 'cancelled';
  vm.runInNewContext(code, context);
  assert.deepEqual(calls, { whatsapp: 1, push: 1 });
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
