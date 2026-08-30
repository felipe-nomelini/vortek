const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DSLITE_LABEL_FORM_FIELD,
  isDsliteCarrierAlreadyConfigured,
  resolveDslitePurchasePageResult,
} = require('../src/lib/dslite/api-contract.ts');

test('envia etiqueta no campo multipart oficial da DSLite', () => {
  assert.equal(DSLITE_LABEL_FORM_FIELD, 'etiqueta');
});

test('reconhece transportadora DSLite já configurada', () => {
  assert.equal(isDsliteCarrierAlreadyConfigured(31, 31), true);
  assert.equal(isDsliteCarrierAlreadyConfigured('31', 31), true);
  assert.equal(isDsliteCarrierAlreadyConfigured(null, 31), false);
  assert.equal(isDsliteCarrierAlreadyConfigured(32, 31), false);
});

test('preserva timeout DSLite como falha observável', () => {
  assert.deepEqual(resolveDslitePurchasePageResult({
    data: null,
    failure: {
      code: 'dslite_timeout',
      message: 'DSLite excedeu o tempo limite de resposta',
      status: null,
    },
  }), {
    ok: false,
    data: null,
    error: {
      code: 'dslite_timeout',
      message: 'DSLite excedeu o tempo limite de resposta',
      upstream_status: null,
    },
    httpStatus: 504,
  });
});

test('preserva status HTTP da DSLite sem propagá-lo como sucesso', () => {
  const result = resolveDslitePurchasePageResult({
    data: null,
    failure: {
      code: 'dslite_http_error',
      message: 'DSLite respondeu HTTP 500',
      status: 500,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 502);
  assert.equal(result.error.upstream_status, 500);
});

test('rejeita payload de pedidos sem a lista oficial', () => {
  const result = resolveDslitePurchasePageResult({
    data: {},
    failure: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 502);
  assert.equal(result.error.code, 'dslite_pedidos_invalid_payload');
});

test('aceita resposta válida sem pedidos como resultado vazio real', () => {
  assert.deepEqual(resolveDslitePurchasePageResult({
    data: { pedidos: [], detalhesConsulta: { totalRegistros: 0 } },
    failure: null,
  }), {
    ok: true,
    data: { pedidos: [], detalhesConsulta: { totalRegistros: 0 } },
    error: null,
    httpStatus: 200,
  });
});
