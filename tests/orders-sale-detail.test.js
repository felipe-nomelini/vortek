const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSaleDetailGroups } = require('../src/lib/orders/sale-detail.ts');

function purchase(id, dsliteId, supplier) {
  return {
    id,
    dslite_id: dsliteId,
    status: 'criado',
    status_dslite: 'Pendente',
    fornecedor_id: null,
    fornecedor_nome: supplier,
    produto_descricao: null,
    produto_sku: null,
    quantidade: null,
    valor_total: null,
    valor_frete: null,
    supplier_payment_mode: null,
    supplier_payment_status: null,
    supplier_payment_amount: null,
    supplier_payment_reference: null,
    supplier_payment_notes: null,
    nf_numero: null,
    nf_chave: null,
    rastreio: null,
  };
}

test('detalhe associa itens e compra ao pedido operacional correto', () => {
  const result = buildSaleDetailGroups({
    operationalPedidoIds: ['pedido-a'],
    operationalDsliteIds: ['DSL-10'],
    orders: [{ id: 'pedido-a', ml_order_id: 'ML-1', dslite_id: 'DSL-10', fulfillment_source: 'supplier' }],
    items: [{
      pedido_id: 'pedido-a', titulo: 'Produto A', quantidade: 2, seller_sku: 'VTKA',
      ml_item_id: 'MLB1', valor_unitario: 50, valor_total_liquido: 100,
    }],
    purchases: [purchase('compra-a', 'DSL-10', 'Fornecedor A')],
  });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].items[0].seller_sku, 'VTKA');
  assert.equal(result.groups[0].purchase.id, 'compra-a');
  assert.deepEqual(result.unmatchedPurchases, []);
});

test('carrinho associa compras pelo DSLite ID mesmo quando a consulta vem em outra ordem', () => {
  const result = buildSaleDetailGroups({
    operationalPedidoIds: ['pedido-a', 'pedido-b'],
    operationalDsliteIds: ['DSL-10', 'DSL-20'],
    orders: [
      { id: 'pedido-a', ml_order_id: 'ML-1', dslite_id: 'DSL-10' },
      { id: 'pedido-b', ml_order_id: 'ML-2', dslite_id: 'DSL-20' },
    ],
    items: [],
    purchases: [
      purchase('compra-b', 'DSL-20', 'Fornecedor B'),
      purchase('compra-a', 'DSL-10', 'Fornecedor A'),
    ],
  });

  assert.equal(result.groups[0].purchase.fornecedor_nome, 'Fornecedor A');
  assert.equal(result.groups[1].purchase.fornecedor_nome, 'Fornecedor B');
});

test('compra operacional sem vínculo não é atribuída por posição', () => {
  const result = buildSaleDetailGroups({
    operationalPedidoIds: ['pedido-a'],
    operationalDsliteIds: ['DSL-10', 'DSL-SEM-VINCULO'],
    orders: [{ id: 'pedido-a', dslite_id: 'DSL-10' }],
    items: [],
    purchases: [
      purchase('compra-solta', 'DSL-SEM-VINCULO', 'Fornecedor incerto'),
      purchase('compra-a', 'DSL-10', 'Fornecedor A'),
    ],
  });

  assert.equal(result.groups[0].purchase.id, 'compra-a');
  assert.deepEqual(result.unmatchedPurchases.map((entry) => entry.id), ['compra-solta']);
});

test('DSLite ID duplicado permanece explícito como ambíguo', () => {
  const result = buildSaleDetailGroups({
    operationalPedidoIds: ['pedido-a'],
    operationalDsliteIds: ['DSL-10'],
    orders: [{ id: 'pedido-a', dslite_id: 'DSL-10' }],
    items: [],
    purchases: [
      purchase('compra-a', 'DSL-10', 'Fornecedor A'),
      purchase('compra-b', 'DSL-10', 'Fornecedor B'),
    ],
  });

  assert.equal(result.groups[0].purchase, null);
  assert.deepEqual(result.unmatchedPurchases.map((entry) => entry.id), ['compra-a', 'compra-b']);
});
