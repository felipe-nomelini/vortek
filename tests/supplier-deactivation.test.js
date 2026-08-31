const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifySupplierDeactivationProducts,
  isActiveSupplierListingStatus,
  isSafeInactiveSupplierPause,
  shouldSkipExistingSupplierPause,
  supplierPauseOperationKey,
} = require('../src/lib/supplier-deactivation.ts');

test('inativação separa fontes alternativas, estoque interno e produtos sem fonte', () => {
  const products = [
    { id: 'alternativo', ativo: true },
    { id: 'interno', ativo: true },
    { id: 'ambos', ativo: true },
    { id: 'sem-fonte', ativo: true },
    { id: 'ja-inativo', ativo: false },
  ];

  const result = classifySupplierDeactivationProducts(
    products,
    new Set(['alternativo', 'ambos']),
    new Set(['interno', 'ambos']),
  );

  assert.deepEqual(result.withAlternative.map((item) => item.id), ['alternativo', 'ambos']);
  assert.deepEqual(result.withInternalStock.map((item) => item.id), ['interno', 'ambos']);
  assert.deepEqual(result.withoutAvailableSource.map((item) => item.id), ['sem-fonte', 'ja-inativo']);
  assert.deepEqual(result.activeWithoutAvailableSource.map((item) => item.id), ['sem-fonte']);
});

test('somente status ativo do Mercado Livre é candidato à pausa', () => {
  assert.equal(isActiveSupplierListingStatus('active'), true);
  assert.equal(isActiveSupplierListingStatus(' ACTIVE '), true);
  assert.equal(isActiveSupplierListingStatus('paused'), false);
  assert.equal(isActiveSupplierListingStatus('closed'), false);
});

test('reprocessamento não duplica pausas da mesma transição', () => {
  assert.equal(shouldSkipExistingSupplierPause('pending', false), true);
  assert.equal(shouldSkipExistingSupplierPause('retry', false), true);
  assert.equal(shouldSkipExistingSupplierPause('processing', false), true);
  assert.equal(shouldSkipExistingSupplierPause('done', false), false);
  assert.equal(shouldSkipExistingSupplierPause('done', true), true);
  assert.equal(shouldSkipExistingSupplierPause('failed', true), false);
  assert.equal(shouldSkipExistingSupplierPause('cancelled', true), false);
});

test('chave de pausa diferencia produto e anúncio sem depender de outras operações', () => {
  assert.equal(supplierPauseOperationKey(' produto-1 ', ' MLB123 '), 'produto-1::MLB123');
  assert.notEqual(
    supplierPauseOperationKey('produto-1', 'MLB123'),
    supplierPauseOperationKey('produto-1', 'MLB456'),
  );
});

test('produto inativo só pode publicar a pausa segura da transição', () => {
  assert.equal(isSafeInactiveSupplierPause({
    source: 'fornecedor_inativo_pause',
    desiredStatus: 'pausado',
    desiredQuantity: 0,
    appliesPrice: false,
    appliesQuantity: true,
    appliesStatus: true,
  }), true);
  assert.equal(isSafeInactiveSupplierPause({
    source: 'fornecedor_inativo_pause',
    desiredStatus: 'ativo',
    desiredQuantity: 1,
    appliesPrice: false,
    appliesQuantity: true,
    appliesStatus: true,
  }), false);
  assert.equal(isSafeInactiveSupplierPause({
    source: 'produto_patch',
    desiredStatus: 'pausado',
    desiredQuantity: 0,
    appliesPrice: false,
    appliesQuantity: true,
    appliesStatus: true,
  }), false);
  assert.equal(isSafeInactiveSupplierPause({
    source: 'fornecedor_inativo_pause',
    desiredStatus: 'pausado',
    desiredQuantity: 0,
    appliesPrice: true,
    appliesQuantity: true,
    appliesStatus: true,
  }), false);
});
