const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseMlVirtualKitOrderGroup,
} = require('../src/lib/ml/virtual-kit-orders.ts');

test('extrai apenas orders componentes do mesmo kit virtual', () => {
  const group = parseMlVirtualKitOrderGroup({
    bundles: [{
      pack_id: 2000009088803387,
      shipment_id: 45452435654,
      main_orders: [{ order_id: 999 }],
      kit_orders: [
        {
          order_id: 2000012907378394,
          item_id: 'MLB4189327103',
          parent_item_id: 'MLB5663868532',
        },
        {
          order_id: 2000012907380228,
          item_id: 'MLB4189262175',
          parent_item_id: 'MLB5663868532',
        },
      ],
    }],
  }, '2000012907378394');

  assert.deepEqual(group, {
    orderIds: ['2000012907378394', '2000012907380228'],
    parentItemId: 'MLB5663868532',
    packId: '2000009088803387',
    shipmentId: '45452435654',
  });
});

test('ignora carrinho comum sem kit_orders relacionado', () => {
  assert.equal(parseMlVirtualKitOrderGroup({
    bundles: [{
      pack_id: 123,
      main_orders: [{ order_id: 1 }, { order_id: 2 }],
      kit_orders: [],
    }],
  }, '1'), null);
});

test('bloqueia grupo inconsistente com mais de um anúncio pai', () => {
  assert.equal(parseMlVirtualKitOrderGroup({
    bundles: [{
      kit_orders: [
        { order_id: 1, parent_item_id: 'MLB1' },
        { order_id: 2, parent_item_id: 'MLB2' },
      ],
    }],
  }, '1'), null);
});
