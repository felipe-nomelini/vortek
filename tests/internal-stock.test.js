const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calcularSaldoEstoqueInterno,
  calcularEntradasVisiveisEstoqueInterno,
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
