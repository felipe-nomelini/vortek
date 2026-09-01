const assert = require('node:assert/strict');
const test = require('node:test');

const { resolvePurchaseProgress } = require('../src/lib/purchase-progress.ts');

function purchase(overrides = {}) {
  return {
    status: 'Iniciado',
    supplier_payment_mode: 'prepaid_pix',
    supplier_payment_status: 'pending',
    bkr1_pix_deferred: false,
    nf_numero: null,
    nf_chave: null,
    rastreio: null,
    ...overrides,
  };
}

test('PIX pendente é a etapa atual e pede registro', () => {
  const progress = resolvePurchaseProgress(purchase());
  assert.deepEqual(progress.items.map((item) => item.status), ['finish', 'process', 'wait', 'wait']);
  assert.equal(progress.nextLabel, 'Registrar o PIX do fornecedor');
});

test('PIX pago com nota avança até aguardar rastreio', () => {
  const progress = resolvePurchaseProgress(purchase({ supplier_payment_status: 'paid', nf_numero: '123' }));
  assert.deepEqual(progress.items.map((item) => item.status), ['finish', 'finish', 'finish', 'process']);
  assert.equal(progress.nextLabel, 'Aguardar o código de rastreio');
});

test('falha de PIX fica visível como erro', () => {
  const progress = resolvePurchaseProgress(purchase({ supplier_payment_status: 'failed' }));
  assert.deepEqual(progress.items.map((item) => item.status), ['finish', 'error', 'wait', 'wait']);
  assert.equal(progress.nextLabel, 'Revisar o registro do PIX');
});

test('compra cancelada encerra o fluxo sem sugerir entrega', () => {
  const progress = resolvePurchaseProgress(purchase({ status: 'Cancelado' }));
  assert.deepEqual(progress.items.map((item) => item.status), ['error', 'wait', 'wait', 'wait']);
  assert.equal(progress.nextLabel, 'Fluxo encerrado: compra cancelada');
});

test('gate BKR1 mostra espera pela etiqueta', () => {
  const progress = resolvePurchaseProgress(purchase({ bkr1_pix_deferred: true }));
  assert.equal(progress.nextLabel, 'Aguardar a etiqueta do Mercado Livre');
});

test('rastreio significa acompanhamento e não entrega concluída', () => {
  const progress = resolvePurchaseProgress(purchase({
    supplier_payment_status: 'paid',
    nf_chave: 'chave',
    rastreio: 'AA123BR',
  }));
  assert.deepEqual(progress.items.map((item) => item.status), ['finish', 'finish', 'finish', 'process']);
  assert.equal(progress.nextLabel, 'Acompanhar a entrega');
});
