const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  classifySupplierDeactivationProducts,
} = require('../src/lib/supplier-deactivation.ts');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const statusRoute = read('src/app/api/fornecedores/[id]/status/route.ts');
const supplierList = read('src/app/(app)/fornecedores/page.tsx');
const supplierDetail = read('src/app/(app)/fornecedores/[id]/page.tsx');

test('classifica fornecedor alternativo, estoque interno e ausência de fonte sem somar origens', () => {
  const products = [
    { id: 'alternativo', ativo: true },
    { id: 'interno', ativo: true },
    { id: 'ambos', ativo: true },
    { id: 'sem-fonte', ativo: true },
    { id: 'interno-inativo', ativo: false },
  ];

  const result = classifySupplierDeactivationProducts(
    products,
    new Set(['alternativo', 'ambos']),
    new Set(['interno', 'ambos', 'interno-inativo']),
  );

  assert.deepEqual(result.withAlternative.map((product) => product.id), ['alternativo', 'ambos']);
  assert.deepEqual(result.withInternalStock.map((product) => product.id), ['interno', 'ambos', 'interno-inativo']);
  assert.deepEqual(result.keptOnlyByInternalStock.map((product) => product.id), ['interno']);
  assert.deepEqual(result.withoutAvailableSource.map((product) => product.id), ['sem-fonte']);
});

test('rota usa capacidade canônica, preserva atividade manual e sincroniza estoque interno', () => {
  assert.match(statusRoute, /loadProductFulfillmentCapacities/);
  assert.match(statusRoute, /capacity\.internal > 0/);
  assert.match(statusRoute, /classifySupplierDeactivationProducts/);
  assert.match(statusRoute, /enfileirarSyncMlEstoqueInterno/);
  assert.match(statusRoute, /mlDeleteCancelledInternalStock/);
  assert.match(statusRoute, /produto preservado pela capacidade do estoque interno/);
  assert.match(statusRoute, /products_kept_only_by_internal_stock/);
  assert.match(statusRoute, /products_without_available_source/);
  assert.doesNotMatch(statusRoute, /productsToInactivate|productsInactivated/);
  assert.doesNotMatch(statusRoute, /\.from\('produtos'\)[\s\S]{0,120}\.update\(\{ ativo: false/);
});

test('confirmações explicam que estoque interno preserva a operação', () => {
  for (const page of [supplierList, supplierDetail]) {
    assert.match(page, /Mantidos pelo estoque interno/);
    assert.match(page, /Sem fonte disponível/);
    assert.match(page, /sem fornecedor alternativo nem estoque interno/);
  }
});
