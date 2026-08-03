const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveBrasilNfeInternalIdentifier,
  selectBrasilNfeNoteByInternalIdentifier,
} = require('../src/lib/fiscal/brasil-nfe-identifier.ts');

test('ignora nota mais recente de outro pedido', () => {
  const selected = selectBrasilNfeNoteByInternalIdentifier([
    { IdentificadorInterno: 'VORTEK-200', Chave: 'chave-errada', DtEmissao: '2026-08-03T12:00:00Z' },
    { IdentificadorInterno: 'VORTEK-100', Chave: 'chave-certa', DtEmissao: '2026-08-01T12:00:00Z' },
  ], 'VORTEK-100');
  assert.equal(selected?.Chave, 'chave-certa');
});

test('não aceita resposta sem identificador exato', () => {
  const selected = selectBrasilNfeNoteByInternalIdentifier([
    { IdentificadorInterno: 'VORTEK-200', Chave: 'chave-errada' },
  ], 'VORTEK-100');
  assert.equal(selected, null);
});

test('usa identificador do pack para carrinho com múltiplas orders', () => {
  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '2000017675239822',
    mlPackId: '2000014280061837',
    mlBundleType: 'cart',
  }), 'VORTEK-PACK-2000014280061837');
});

test('usa identificador do kit virtual e preserva override explícito', () => {
  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '200',
    mlPackId: '300',
    mlBundleType: 'virtual_kit',
  }), 'VORTEK-KIT-300');

  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '200',
    mlPackId: '300',
    mlBundleType: 'cart',
    identifierOverride: 'VORTEK-CUSTOM-1',
  }), 'VORTEK-CUSTOM-1');
});

test('mantém identificador por order fora de grupo operacional', () => {
  assert.equal(resolveBrasilNfeInternalIdentifier({
    pedidoId: 'uuid-order',
    pedidoNumero: '200001',
    mlPackId: '300001',
    mlBundleType: null,
  }), 'VORTEK-200001');
});
