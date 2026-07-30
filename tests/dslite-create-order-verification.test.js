const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canFallbackToSupplierlessCreate,
  isDsliteCreatedOrderVerified,
} = require('../src/lib/dslite/create-order-verification.ts');

test('confirma criação somente quando GET retorna o mesmo dsid', () => {
  assert.equal(isDsliteCreatedOrderVerified({ dsid: 391512 }, 391512), true);
  assert.equal(isDsliteCreatedOrderVerified({ dsid: 391513 }, 391512), false);
  assert.equal(isDsliteCreatedOrderVerified(null, 391512), false);
});

test('permite fallback somente após rejeição definitiva sem dsid', () => {
  assert.equal(canFallbackToSupplierlessCreate({
    failureType: 'invalid_response',
    parsedBody: { sucesso: 0, erros: 1, logs: [{ mensagem_conteudo: 'Lock wait timeout' }] },
  }), true);

  assert.equal(canFallbackToSupplierlessCreate({
    failureType: 'verification_failed',
    parsedBody: { sucesso: 1, erros: 0, logs: [{ dsid: 391512 }] },
  }), false);

  assert.equal(canFallbackToSupplierlessCreate({
    failureType: 'timeout',
    parsedBody: null,
  }), false);
});
