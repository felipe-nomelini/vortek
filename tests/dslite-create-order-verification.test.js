const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyDsliteCreatePayload,
  extractDsliteNfeKeyFromXml,
  isDsliteCreatedOrderVerified,
  isDsliteLockWaitTimeout,
} = require('../src/lib/dslite/create-order-verification.ts');

test('confirma criação somente quando GET retorna o mesmo dsid', () => {
  assert.equal(isDsliteCreatedOrderVerified({ dsid: 391512 }, 391512), true);
  assert.equal(isDsliteCreatedOrderVerified({ dsid: 391513 }, 391512), false);
  assert.equal(isDsliteCreatedOrderVerified(null, 391512), false);
});

test('classifica SQL 1205 como lock interno sem dsid', () => {
  const body = {
    total: 1,
    sucesso: 0,
    erros: 1,
    logs: [{
      chave_acesso: '43260865850289000183550020000010621030416690',
      mensagem_conteudo: 'SQLSTATE[HY000]: General error: 1205 Lock wait timeout exceeded',
    }],
  };

  assert.equal(isDsliteLockWaitTimeout(body), true);
  assert.deepEqual(classifyDsliteCreatePayload(body), {
    accepted: false,
    lockTimeout: true,
    dsid: null,
    nfeKey: '43260865850289000183550020000010621030416690',
  });
});

test('aceita resposta oficial de sucesso sem dsid para reconciliação pela chave', () => {
  assert.deepEqual(classifyDsliteCreatePayload({
    total: 1,
    sucesso: 1,
    erros: 0,
    logs: [{ chave_acesso: '43260865850289000183550020000010631030416760' }],
  }), {
    accepted: true,
    lockTimeout: false,
    dsid: null,
    nfeKey: '43260865850289000183550020000010631030416760',
  });
});

test('preserva fluxo normal quando DSLite retorna dsid', () => {
  assert.deepEqual(classifyDsliteCreatePayload({
    total: 1,
    sucesso: 1,
    erros: 0,
    logs: [{ dsid: 391512, chave_acesso: '43260865850289000183550020000010621030416690' }],
  }), {
    accepted: true,
    lockTimeout: false,
    dsid: 391512,
    nfeKey: '43260865850289000183550020000010621030416690',
  });
});

test('extrai chave da NF pelo chNFe ou Id da infNFe', () => {
  const key = '43260865850289000183550020000010621030416690';
  assert.equal(extractDsliteNfeKeyFromXml(`<protNFe><chNFe>${key}</chNFe></protNFe>`), key);
  assert.equal(extractDsliteNfeKeyFromXml(`<infNFe Id="NFe${key}"></infNFe>`), key);
  assert.equal(extractDsliteNfeKeyFromXml('<nfeProc />'), null);
});
