const assert = require('node:assert/strict');
const test = require('node:test');

const { selectBrasilNfeNoteByInternalIdentifier } = require('../src/lib/fiscal/brasil-nfe-identifier.ts');

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
