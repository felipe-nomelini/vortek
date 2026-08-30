const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  allowsDslitePlaceholderLabel,
} = require('../src/lib/supplier-balance.ts');

test('Vanral aceita etiqueta provisória DSLite', () => {
  assert.equal(allowsDslitePlaceholderLabel(97, 'VANRAL'), true);
  assert.equal(allowsDslitePlaceholderLabel(null, 'Vanral Distribuidora'), true);
});

test('fornecedor aposentado não aceita etiqueta provisória DSLite', () => {
  assert.equal(allowsDslitePlaceholderLabel(2, 'HAYAMAX-PR'), false);
});

test('PDF provisório Vanral existe e é válido', () => {
  const pdfPath = path.join(
    process.cwd(),
    'public',
    'dslite',
    'labels',
    'etiqueta_vanral_aguardando_etiqueta_ml.pdf',
  );
  const pdf = fs.readFileSync(pdfPath);
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(pdf.length > 1000);
});
