const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateInternalFulfillmentCapacity,
  calculateSafeFulfillmentQuantity,
  calculateSupplierFulfillmentCapacity,
} = require('../src/lib/orders/fulfillment-capacity.ts');
const { calcularSaldoEstoqueInterno } = require('../src/lib/estoque-interno-saldo.ts');
const { isBlockedDropshippingDsliteSupplier } = require('../src/lib/dslite/supplier-policy.ts');

const unit = [{ produtoId: 'produto', quantidade: 1 }];

function offer(overrides = {}) {
  return {
    id: 'oferta',
    produtoId: 'produto',
    supplierId: 'fornecedor',
    supplierProductId: 'produto-dslite',
    ativo: true,
    allowed: true,
    estoque: 3,
    custo: 10,
    ...overrides,
  };
}

test('Q segura usa fornecedor 3 quando internal possui 2', () => {
  assert.equal(calculateSafeFulfillmentQuantity(2, 3), 3);
});

test('Q segura usa internal 5 quando fornecedor possui 3', () => {
  assert.equal(calculateSafeFulfillmentQuantity(5, 3), 5);
});

test('fornecedor usa a melhor oferta operacional sem somar ofertas', () => {
  const capacity = calculateSupplierFulfillmentCapacity(unit, [
    offer({ id: 'preferencial', estoque: 3 }),
    offer({ id: 'alternativa', supplierId: 'outro', estoque: 8 }),
  ]);
  assert.equal(capacity, 8);
});

test('ofertas incompatíveis não são somadas na Q segura', () => {
  const capacity = calculateSupplierFulfillmentCapacity(unit, [
    offer({ id: 'a', supplierId: 'a', estoque: 3 }),
    offer({ id: 'b', supplierId: 'b', estoque: 8 }),
  ]);
  assert.notEqual(capacity, 11);
  assert.equal(capacity, 8);
});

test('oferta inválida não entra na capacidade do fornecedor', () => {
  const invalidOffers = [
    offer({ id: 'inativa', ativo: false, estoque: 20 }),
    offer({ id: 'bloqueada', allowed: false, estoque: 20 }),
    offer({ id: 'sem-custo', custo: 0, estoque: 20 }),
    offer({ id: 'sem-vinculo', supplierProductId: '', estoque: 20 }),
  ];
  assert.equal(calculateSupplierFulfillmentCapacity(unit, invalidOffers), 0);
});

test('oferta Hayamax não gera capacidade de fulfillment', () => {
  const hayamax = offer({
    supplierId: '2',
    allowed: !isBlockedDropshippingDsliteSupplier('2'),
    estoque: 20,
  });

  assert.equal(calculateSupplierFulfillmentCapacity(unit, [hayamax]), 0);
});

test('reserva reduz a capacidade do estoque interno', () => {
  const balance = calcularSaldoEstoqueInterno([
    {
      tipo: 'entrada_devolucao',
      quantidade: 5,
      situacao_estoque: 'liberado',
      estornada_em: null,
    },
    {
      tipo: 'saida_envio_interno',
      quantidade: 2,
      situacao_estoque: 'reservado',
      estornada_em: null,
    },
  ]);
  const beforeReservation = calculateInternalFulfillmentCapacity(
    unit,
    new Map([['produto', 5]]),
  );
  const afterReservation = calculateInternalFulfillmentCapacity(
    unit,
    new Map([['produto', balance]]),
  );
  assert.equal(beforeReservation, 5);
  assert.equal(afterReservation, 3);
});

test('kit respeita a quantidade e o componente limitante', () => {
  const kit = [
    { produtoId: 'a', quantidade: 2 },
    { produtoId: 'b', quantidade: 1 },
  ];
  const capacity = calculateInternalFulfillmentCapacity(
    kit,
    new Map([['a', 7], ['b', 5]]),
  );
  assert.equal(capacity, 3);
});

test('uma cesta de fornecedor exige todos os componentes na mesma origem', () => {
  const kit = [
    { produtoId: 'a', quantidade: 2 },
    { produtoId: 'b', quantidade: 1 },
  ];
  const offers = [
    offer({ id: 'a-1', produtoId: 'a', supplierId: 'f1', estoque: 8 }),
    offer({ id: 'b-1', produtoId: 'b', supplierId: 'f1', estoque: 3 }),
    offer({ id: 'a-2', produtoId: 'a', supplierId: 'f2', estoque: 20 }),
  ];
  assert.equal(calculateSupplierFulfillmentCapacity(kit, offers), 3);
});
