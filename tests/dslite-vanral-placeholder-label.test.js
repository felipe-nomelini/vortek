const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  allowsDslitePlaceholderLabel,
  isBkr1Supplier,
  isMksSupplier,
  usesThermalMlLabelSupplier,
} = require('../src/lib/supplier-balance.ts');

test('Vanral aceita etiqueta provisória DSLite', () => {
  assert.equal(allowsDslitePlaceholderLabel(97, 'VANRAL'), true);
  assert.equal(allowsDslitePlaceholderLabel(null, 'Vanral Distribuidora'), true);
});

test('fornecedor aposentado não aceita etiqueta provisória DSLite', () => {
  assert.equal(allowsDslitePlaceholderLabel(2, 'HAYAMAX-PR'), false);
});

test('MKS aceita a etiqueta provisória sem herdar as demais regras da BKR1', () => {
  assert.equal(isMksSupplier(115, 'MKS Distribuidora Ltda'), true);
  assert.equal(isMksSupplier(null, 'MKS Distribuidora'), true);
  assert.equal(allowsDslitePlaceholderLabel(115, 'MKS'), true);
  assert.equal(isBkr1Supplier(115, 'MKS'), false);
  assert.equal(usesThermalMlLabelSupplier(115, 'MKS'), false);
});

test('MKS reutiliza o PDF da BKR1 com origem e nome próprios', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'lib', 'dslite', 'placeholder-label.ts'),
    'utf8',
  );
  assert.match(source, /DSLITE_MKS_PLACEHOLDER_LABEL_SOURCE = 'placeholder_release_window_mks'/);
  assert.match(source, /DSLITE_MKS_PLACEHOLDER_LABEL_FILE_NAME = 'etiqueta_mks_aguardando_etiqueta_ml\.pdf'/);
  assert.match(source, /if \(isMksSupplier[\s\S]*?path: BKR1_PLACEHOLDER_LABEL_PATH[\s\S]*?supplierLabel: 'MKS'/);
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
