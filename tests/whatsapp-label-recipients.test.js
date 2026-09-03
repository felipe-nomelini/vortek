const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE,
  filterPendingSupplierLabelWhatsappRecipients,
  resolveSupplierLabelWhatsappRecipients,
} = require('../src/lib/supplier-balance.ts');

test('envia etiqueta oficial da Evolusom ao principal e ao número adicional', () => {
  assert.deepEqual(
    resolveSupplierLabelWhatsappRecipients({
      primaryPhone: '(44) 99999-6463',
      fornecedorId: '133',
      usePlaceholderLabel: false,
    }),
    [
      { key: 'primary', phoneNumber: '44999996463' },
      { key: 'evolusom_additional', phoneNumber: EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE },
    ],
  );
});

test('não envia etiqueta genérica da Evolusom ao número adicional', () => {
  assert.deepEqual(
    resolveSupplierLabelWhatsappRecipients({
      primaryPhone: '5544999996463',
      fornecedorId: '133',
      usePlaceholderLabel: true,
    }),
    [{ key: 'primary', phoneNumber: '5544999996463' }],
  );
});

test('não adiciona destinatário para outros fornecedores', () => {
  assert.deepEqual(
    resolveSupplierLabelWhatsappRecipients({
      primaryPhone: '5544999996463',
      fornecedorId: '108',
      usePlaceholderLabel: false,
    }),
    [{ key: 'primary', phoneNumber: '5544999996463' }],
  );
});

test('não duplica envio quando o principal já é o número adicional', () => {
  assert.deepEqual(
    resolveSupplierLabelWhatsappRecipients({
      primaryPhone: EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE,
      fornecedorId: '133',
      usePlaceholderLabel: false,
    }),
    [{ key: 'primary', phoneNumber: EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE }],
  );
});

test('não duplica o número adicional quando o principal está sem DDI', () => {
  assert.deepEqual(
    resolveSupplierLabelWhatsappRecipients({
      primaryPhone: '4432206495',
      fornecedorId: '133',
      usePlaceholderLabel: false,
    }),
    [{ key: 'primary', phoneNumber: '4432206495' }],
  );
});

test('retentativa seleciona somente o destinatário ainda não confirmado', () => {
  const recipients = resolveSupplierLabelWhatsappRecipients({
    primaryPhone: '5544999996463',
    fornecedorId: '133',
    usePlaceholderLabel: false,
  });

  assert.deepEqual(
    filterPendingSupplierLabelWhatsappRecipients(recipients, ['primary']),
    [{ key: 'evolusom_additional', phoneNumber: EVOLUSOM_OFFICIAL_LABEL_ADDITIONAL_PHONE }],
  );
  assert.deepEqual(
    filterPendingSupplierLabelWhatsappRecipients(recipients, ['evolusom_additional']),
    [{ key: 'primary', phoneNumber: '5544999996463' }],
  );
});
