const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DSLITE_LABEL_FORM_FIELD,
  isDsliteCarrierAlreadyConfigured,
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
