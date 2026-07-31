const assert = require('node:assert/strict');
const test = require('node:test');

const {
  allocateMlShipmentCost,
  filterPackOrdersBySeller,
  parseMlPackOrderGroup,
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

test('extrai carrinho comum com duas orders', () => {
  assert.deepEqual(parseMlPackOrderGroup({
    id: 2000014280061837,
    shipment: { id: 47647004665 },
    orders: [
      { id: 2000017675239822 },
      { id: 2000017675244840 },
    ],
  }, '2000017675239822'), {
    orderIds: ['2000017675239822', '2000017675244840'],
    packId: '2000014280061837',
    shipmentId: '47647004665',
  });
});

test('ignora pack unitário', () => {
  assert.equal(parseMlPackOrderGroup({
    id: 123,
    orders: [{ id: 1 }],
  }, '1'), null);
});

test('mantém apenas orders do mesmo seller', () => {
  assert.deepEqual(filterPackOrdersBySeller({
    currentOrderId: '1',
    currentSellerId: 10,
    orderDetails: [
      { id: 1, seller: { id: 10 }, total_amount: 92 },
      { id: 2, seller: { id: 10 }, total_amount: 78.9 },
      { id: 3, seller: { id: 11 }, total_amount: 40 },
    ],
  }).map((order) => String(order.id)), ['1', '2']);
});

test('rateia custo único do shipment sem duplicar centavos', () => {
  const orders = [
    { id: '2000017675239822', total_amount: 92 },
    { id: '2000017675244840', total_amount: 78.9 },
  ];
  const first = allocateMlShipmentCost({
    sellerShippingCost: 20.1,
    currentOrderId: '2000017675239822',
    orders,
  });
  const second = allocateMlShipmentCost({
    sellerShippingCost: 20.1,
    currentOrderId: '2000017675244840',
    orders,
  });

  assert.equal(first, 10.82);
  assert.equal(second, 9.28);
  assert.equal(Number((first + second).toFixed(2)), 20.1);
});
