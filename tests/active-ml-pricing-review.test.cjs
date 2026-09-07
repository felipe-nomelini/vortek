const { test } = require('node:test');
const assert = require('node:assert/strict');
const { atTarget, chooseProduct } = require('../scripts/correct-active-ml-prices.cjs');

test('anúncio adicional usa vínculo próprio, sem depender do ID principal do produto', () => {
  const products = [{ id: 'p', sku: 'VTK1', ml_item_id: 'MLB_MAIN' }];
  assert.equal(chooseProduct({ id: 'MLB_OTHER', seller_custom_field: 'VTK1' }, products, [{ ml_item_id: 'MLB_OTHER', produto_id: 'p' }]).id, 'p');
  assert.throws(() => chooseProduct({ id: 'MLB_OTHER', seller_custom_field: 'VTK1' }, products, [{ ml_item_id: 'MLB_OTHER', produto_id: 'different' }]), /VINCULO_DIVERGENTE/);
  assert.throws(() => chooseProduct({ id: 'UNKNOWN' }, products, []), /SEM_VINCULO/);
});

test('atingir piso não equivale a atingir alvo; cotação estimada não confirma correção', () => {
  const m = { result: 7, margin: .07, band: { floor: .05, target: .07 }, fee: { source: 'ml_live' }, shipping: { source: 'ml_live' } };
  assert.equal(atTarget(m), true);
  assert.equal(atTarget({ ...m, margin: .06 }), false);
  assert.equal(atTarget({ ...m, margin: .4 }), true);
  assert.equal(atTarget({ ...m, shipping: { source: 'fallback' } }), false);
});
