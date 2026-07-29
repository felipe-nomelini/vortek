const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calcularSaldoEstoqueInterno,
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
