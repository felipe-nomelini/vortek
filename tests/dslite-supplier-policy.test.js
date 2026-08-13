const assert = require('node:assert/strict');
const test = require('node:test');

const {
  filterAllowedDropshippingDsliteSupplierIds,
  isBlockedDropshippingDsliteSupplier,
  selectAllowedSupplierProductCandidate,
} = require('../src/lib/dslite/supplier-policy.ts');

test('bloqueia EVOLUSOM-ES e mantém EVOLUSOM-PR', () => {
  assert.equal(isBlockedDropshippingDsliteSupplier('134'), true);
  assert.equal(isBlockedDropshippingDsliteSupplier(134), true);
  assert.equal(isBlockedDropshippingDsliteSupplier('133'), false);
  assert.deepEqual(
    filterAllowedDropshippingDsliteSupplierIds(['2', '134', 133]),
    ['2', '133'],
  );
});

test('colisão do produto DSLite 381479 escolhe produto ativo da EVOLUSOM-PR', () => {
  const selected = selectAllowedSupplierProductCandidate(
    [
      { id: 'vtk024788', ativo: false },
      { id: 'vtk017371', ativo: true },
    ],
    [
      {
        produto_id: 'vtk024788',
        dslite_fornecedor_id: '134',
        ativo: false,
        estoque: 0,
      },
      {
        produto_id: 'vtk017371',
        dslite_fornecedor_id: '133',
        ativo: true,
        estoque: 50,
      },
    ],
  );

  assert.equal(selected?.id, 'vtk017371');
});

test('não seleciona produto quando só existe oferta EVOLUSOM-ES', () => {
  const selected = selectAllowedSupplierProductCandidate(
    [{ id: 'es-only', ativo: true }],
    [
      {
        produto_id: 'es-only',
        dslite_fornecedor_id: '134',
        ativo: true,
        estoque: 10,
      },
    ],
  );

  assert.equal(selected, null);
});
