const assert = require('node:assert/strict');
const test = require('node:test');

const {
  filterOperationalDropshippingDsliteSupplierIds,
  filterOperationalDropshippingSupplierOffers,
  isOperationalDropshippingSupplier,
  isRetiredDropshippingSupplier,
  selectOperationalSupplierProductCandidate,
} = require('../src/lib/dslite/supplier-policy.ts');

const operational = new Set(['133']);

test('usa estado persistido, sem regra nominal por ID', () => {
  assert.equal(isOperationalDropshippingSupplier({ ativo: true, dropshipping_retired_at: null }), true);
  assert.equal(isOperationalDropshippingSupplier({ ativo: false, dropshipping_retired_at: null }), false);
  assert.equal(isOperationalDropshippingSupplier({ ativo: true, dropshipping_retired_at: '2026-09-04T00:00:00Z' }), false);
  assert.equal(isRetiredDropshippingSupplier({ dropshipping_retired_at: '2026-09-04T00:00:00Z' }), true);
  assert.deepEqual(
    filterOperationalDropshippingDsliteSupplierIds(['2', '134', 133], operational),
    ['133'],
  );
});

test('remove ofertas bloqueadas antes da seleção operacional', () => {
  assert.deepEqual(
    filterOperationalDropshippingSupplierOffers([
      { id: 'hayamax', dslite_fornecedor_id: '2' },
      { id: 'evolusom-es', dslite_fornecedor_id: '134' },
      { id: 'evolusom-pr', dslite_fornecedor_id: '133' },
    ], operational).map((offer) => offer.id),
    ['evolusom-pr'],
  );
});

test('colisão do produto DSLite 381479 escolhe produto ativo da EVOLUSOM-PR', () => {
  const selected = selectOperationalSupplierProductCandidate(
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
    ], operational,
  );

  assert.equal(selected?.id, 'vtk017371');
});

test('não seleciona produto quando só existe oferta EVOLUSOM-ES', () => {
  const selected = selectOperationalSupplierProductCandidate(
    [{ id: 'es-only', ativo: true }],
    [
      {
        produto_id: 'es-only',
        dslite_fornecedor_id: '134',
        ativo: true,
        estoque: 10,
      },
    ], operational,
  );

  assert.equal(selected, null);
});

test('não seleciona produto quando só existe oferta Hayamax', () => {
  const selected = selectOperationalSupplierProductCandidate(
    [{ id: 'hayamax-only', ativo: true }],
    [
      {
        produto_id: 'hayamax-only',
        dslite_fornecedor_id: '2',
        ativo: true,
        estoque: 10,
      },
    ], operational,
  );

  assert.equal(selected, null);
});
