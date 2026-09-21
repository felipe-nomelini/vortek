const assert = require('node:assert/strict');
const test = require('node:test');
const { kitGtinAbsenceReason } = require('../src/lib/ml-kit-gtin-reason.ts');

const attribute = { id: 'EMPTY_GTIN_REASON', values: [
  { id: '17055159', name: 'O produto é um kit ou pack' },
  { id: '17055160', name: 'O produto não tem código cadastrado' },
] };

test('kit confirmado sem GTIN usa o motivo oficial da categoria', () => {
  assert.deepEqual(kitGtinAbsenceReason({ kitStatus: 'ready', productGtin: '', attribute }),
    { value_id: '17055159', value_name: 'O produto é um kit ou pack' });
});

test('não inventa motivo para produto unitário, kit incerto ou categoria sem opção', () => {
  for (const kitStatus of ['not_kit', 'inconclusive']) {
    assert.equal(kitGtinAbsenceReason({ kitStatus, productGtin: '', attribute }), null);
  }
  assert.equal(kitGtinAbsenceReason({ kitStatus: 'ready', productGtin: '7891234567895', attribute }), null);
  assert.equal(kitGtinAbsenceReason({ kitStatus: 'ready', productGtin: '', attribute: { id: 'EMPTY_GTIN_REASON', values: [] } }), null);
});
