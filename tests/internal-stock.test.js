const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calcularSaldoEstoqueInterno,
  calcularEntradasVisiveisEstoqueInterno,
  expandirItensReservaEstoqueInterno,
} = require('../src/lib/estoque-interno-saldo.ts');

test('saída estornada não reduz o saldo interno', () => {
  assert.equal(calcularSaldoEstoqueInterno([
    {
      tipo: 'entrada_devolucao',
      quantidade: 1,
      situacao_estoque: 'liberado',
      estornada_em: null,
    },
    {
      tipo: 'saida_envio_interno',
      quantidade: 1,
      estornada_em: '2026-07-29T21:00:00.000Z',
    },
  ]), 1);
});

test('saída ativa continua reduzindo o saldo interno', () => {
  assert.equal(calcularSaldoEstoqueInterno([
    {
      tipo: 'entrada_devolucao',
      quantidade: 1,
      situacao_estoque: 'liberado',
      estornada_em: null,
    },
    {
      tipo: 'saida_envio_interno',
      quantidade: 1,
      estornada_em: null,
    },
  ]), 0);
});

test('reserva ativa reduz o saldo disponível antes do despacho', () => {
  assert.equal(calcularSaldoEstoqueInterno([
    {
      tipo: 'entrada_devolucao',
      quantidade: 2,
      situacao_estoque: 'liberado',
      estornada_em: null,
    },
    {
      tipo: 'saida_envio_interno',
      quantidade: 1,
      estado_envio_interno: 'reservado',
      estornada_em: null,
    },
  ]), 1);
});

test('saída consumida remove produto da lista de liberados', () => {
  const entradas = calcularEntradasVisiveisEstoqueInterno([
    {
      id: 'entrada-1',
      produto_id: 'produto-1',
      quantidade: 1,
      situacao_estoque: 'liberado',
      created_at: '2026-07-20T10:00:00.000Z',
    },
  ], [
    { produto_id: 'produto-1', quantidade: 1 },
  ]);

  assert.deepEqual(entradas, []);
});

test('saída parcial reduz quantidade liberada usando FIFO', () => {
  const entradas = calcularEntradasVisiveisEstoqueInterno([
    {
      id: 'entrada-nova',
      produto_id: 'produto-1',
      quantidade: 2,
      situacao_estoque: 'liberado',
      created_at: '2026-07-21T10:00:00.000Z',
    },
    {
      id: 'entrada-antiga',
      produto_id: 'produto-1',
      quantidade: 2,
      situacao_estoque: 'liberado',
      created_at: '2026-07-20T10:00:00.000Z',
    },
  ], [
    { produto_id: 'produto-1', quantidade: 3 },
  ]);

  assert.deepEqual(entradas, [{
    id: 'entrada-nova',
    produto_id: 'produto-1',
    quantidade: 1,
    situacao_estoque: 'liberado',
    created_at: '2026-07-21T10:00:00.000Z',
  }]);
});

test('saídas não alteram itens em revisão', () => {
  const entrada = {
    id: 'entrada-revisao',
    produto_id: 'produto-1',
    quantidade: 1,
    situacao_estoque: 'revisao',
    created_at: '2026-07-20T10:00:00.000Z',
  };

  assert.deepEqual(
    calcularEntradasVisiveisEstoqueInterno([entrada], [
      { produto_id: 'produto-1', quantidade: 1 },
    ]),
    [entrada],
  );
});

test('kit reserva todos os componentes com as quantidades corretas', () => {
  const itens = expandirItensReservaEstoqueInterno([
    { produtoId: 'kit-1', sku: 'KIT-1', quantidade: 2 },
  ], new Map([
    ['kit-1', {
      ativo: true,
      componentes: [
        { produtoId: 'produto-a', sku: 'A', ativo: true, quantidade: 2 },
        { produtoId: 'produto-b', sku: 'B', ativo: true, quantidade: 1 },
      ],
    }],
  ]));

  assert.deepEqual(itens, [
    { produtoId: 'produto-a', sku: 'A', quantidade: 4 },
    { produtoId: 'produto-b', sku: 'B', quantidade: 2 },
  ]);
});

test('componente repetido entre kit e item avulso é agregado', () => {
  const itens = expandirItensReservaEstoqueInterno([
    { produtoId: 'kit-1', sku: 'KIT-1', quantidade: 1 },
    { produtoId: 'produto-a', sku: 'A', quantidade: 3 },
  ], new Map([
    ['kit-1', {
      ativo: true,
      componentes: [
        { produtoId: 'produto-a', sku: 'A', ativo: true, quantidade: 2 },
      ],
    }],
  ]));

  assert.deepEqual(itens, [
    { produtoId: 'produto-a', sku: 'A', quantidade: 5 },
  ]);
});

test('kit sem componente válido falha sem produzir reserva parcial', () => {
  assert.throws(() => expandirItensReservaEstoqueInterno([
    { produtoId: 'kit-1', sku: 'KIT-1', quantidade: 1 },
  ], new Map([
    ['kit-1', {
      ativo: true,
      componentes: [
        { produtoId: 'produto-a', sku: '', ativo: false, quantidade: 1 },
      ],
    }],
  ])), /Componente indisponível/);
});
