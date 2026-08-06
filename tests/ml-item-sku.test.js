const assert = require('node:assert/strict');
const test = require('node:test');

const { extractMlItemSku } = require('../src/lib/ml/item-sku.ts');

test('prioriza SELLER_SKU atualizado sobre seller_custom_field legado', () => {
  assert.equal(extractMlItemSku({
    seller_custom_field: 'HYX85134',
    attributes: [{ id: 'SELLER_SKU', value_name: 'VTK000826' }],
  }), 'VTK000826');
});

test('mantém fallback para seller_custom_field quando atributo não existe', () => {
  assert.equal(extractMlItemSku({ seller_custom_field: 'vtk000123' }), 'VTK000123');
});
