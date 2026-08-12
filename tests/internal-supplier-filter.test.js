const assert = require('node:assert/strict');
const test = require('node:test');

const {
  INTERNAL_SUPPLIER_FILTER_ID,
  includesInternalSupplierFilter,
  mapSupplierFilterIdsToDsliteIds,
  matchesOrderSupplierFilter,
} = require('../src/lib/produto-filtering.ts');

const options = [
  { id: INTERNAL_SUPPLIER_FILTER_ID, label: 'INTERNO', apelido: 'INTERNO', dsliteId: '' },
  { id: 'supplier-a', label: 'Fornecedor A', apelido: 'Fornecedor A', dsliteId: '101' },
  { id: 'supplier-b', label: 'Fornecedor B', apelido: 'Fornecedor B', dsliteId: '202' },
];

test('separa INTERNO dos IDs DSLite externos', () => {
  assert.equal(includesInternalSupplierFilter([INTERNAL_SUPPLIER_FILTER_ID]), true);
  assert.deepEqual(
    mapSupplierFilterIdsToDsliteIds([INTERNAL_SUPPLIER_FILTER_ID, 'supplier-b'], options),
    ['202'],
  );
});

test('combina fornecedores selecionados com lógica OR', () => {
  assert.equal(matchesOrderSupplierFilter({
    row: { operational_supplier_ids: ['202'] },
    supplierDsliteIds: ['101', '202'],
    includeInternal: false,
  }), true);

  assert.equal(matchesOrderSupplierFilter({
    row: { operational_internal_stock: true },
    supplierDsliteIds: ['101'],
    includeInternal: true,
  }), true);
});

test('INTERNO exige cobertura completa calculada no enriquecimento', () => {
  assert.equal(matchesOrderSupplierFilter({
    row: { fornecedor_nome: 'Estoque Interno', operational_internal_stock: false },
    supplierDsliteIds: [],
    includeInternal: true,
  }), false);

  assert.equal(matchesOrderSupplierFilter({
    row: { internal_stock_available: true },
    supplierDsliteIds: [],
    includeInternal: true,
  }), true);
});
