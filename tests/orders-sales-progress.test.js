const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const modulePromise = import(pathToFileURL(path.resolve(
  __dirname,
  '../src/lib/orders/operational-view.ts',
)).href);

function baseOrder(patch = {}) {
  return {
    data: new Date().toISOString(),
    situacao: { valor: 'pendente' },
    dslite_label_operational_status: 'pending',
    whatsapp_label_status: 'not_sent',
    ...patch,
  };
}

test('progresso mantém a venda na preparação enquanto o fulfillment está pendente', async () => {
  const { getOrderSalesProgress } = await modulePromise;
  const initial = getOrderSalesProgress(baseOrder());
  const payment = getOrderSalesProgress(baseOrder({
    dslite_id: 'DSL-1',
    dslite_next_action: 'confirm_supplier_payment',
    dslite_next_action_label: 'Confirmar PIX',
  }));

  assert.deepEqual(
    [initial.completedSteps, initial.currentStep, initial.currentLabel, initial.nextLabel],
    [1, 2, 'Preparação', 'Criar pedido no fornecedor'],
  );
  assert.deepEqual(
    [payment.completedSteps, payment.currentStep, payment.currentLabel, payment.nextLabel],
    [1, 2, 'Preparação', 'Confirmar PIX'],
  );
});

test('progresso avança de forma contígua por fiscal, etiqueta, envio e entrega', async () => {
  const { getOrderSalesProgress } = await modulePromise;
  const prepared = baseOrder({
    dslite_id: 'DSL-1',
    dslite_next_action: 'complete_dslite_label',
  });

  const fiscal = getOrderSalesProgress(prepared);
  const label = getOrderSalesProgress({ ...prepared, notaFiscal: { emitida: true } });
  const dispatch = getOrderSalesProgress({
    ...prepared,
    notaFiscal: { emitida: true },
    dslite_label_operational_status: 'real_sent',
  });
  const shipping = getOrderSalesProgress({ ...prepared, situacao: { valor: 'em_transito' } });
  const delivered = getOrderSalesProgress({ ...prepared, situacao: { valor: 'entregue' } });

  assert.deepEqual([fiscal.completedSteps, fiscal.currentLabel], [2, 'Fiscal']);
  assert.deepEqual([label.completedSteps, label.currentLabel], [3, 'Etiqueta']);
  assert.deepEqual([dispatch.completedSteps, dispatch.currentLabel], [4, 'Envio']);
  assert.deepEqual([shipping.completedSteps, shipping.currentLabel], [5, 'Entrega']);
  assert.deepEqual(
    [delivered.completedSteps, delivered.currentStep, delivered.nextLabel, delivered.tone],
    [6, 6, 'Concluída', 'success'],
  );
});

test('progresso cobre envio interno e interrupções sem criar um status persistido', async () => {
  const { getOrderSalesProgress } = await modulePromise;
  const pendingInternal = getOrderSalesProgress(baseOrder({
    fulfillment_source: 'internal',
    internal_stock_available: true,
    dslite_next_action: 'internal_shipping',
  }));
  const readyInternal = getOrderSalesProgress(baseOrder({
    fulfillment_source: 'internal',
    envio_interno_at: new Date().toISOString(),
    notaFiscal: { emitida: true },
    ml_label_storage_path: 'labels/test.pdf',
  }));
  const cancelled = getOrderSalesProgress(baseOrder({ situacao: { valor: 'cancelado' } }));

  assert.deepEqual([pendingInternal.currentStep, pendingInternal.nextLabel], [2, 'Processar envio interno']);
  assert.deepEqual([readyInternal.completedSteps, readyInternal.currentLabel], [4, 'Envio']);
  assert.equal(cancelled.tone, 'error');
  assert.equal(cancelled.nextLabel, 'Fluxo encerrado: venda cancelada');
});
