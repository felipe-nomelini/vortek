const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveDestIePolicy } = require('../src/lib/fiscal/ie-policy.ts');

test('IE confirmada pela SEFAZ prevalece sobre não contribuinte informado pelo ML', () => {
  const policy = resolveDestIePolicy({
    documento: '12345678000199',
    billingIe: '123456789',
    taxpayerTypeMlRaw: 'Não contribuinte',
  });

  assert.equal(policy.iePolicyResolved, 'contribuinte');
  assert.equal(policy.indicadorIe, 1);
  assert.equal(policy.ieRequired, true);
  assert.equal(policy.iePresent, true);
});

test('CNPJ sem IE confirmada preserva política de não contribuinte', () => {
  const policy = resolveDestIePolicy({
    documento: '12345678000199',
    billingIe: null,
    taxpayerTypeMlRaw: 'Não contribuinte',
  });

  assert.equal(policy.iePolicyResolved, 'nao_contribuinte');
  assert.equal(policy.indicadorIe, 9);
  assert.equal(policy.ieRequired, false);
});
