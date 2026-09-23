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

test('MKS mantém PDF provisório e usa ZPL para a etiqueta real na DSLite', () => {
  assert.equal(isMksSupplier(115, 'MKS Distribuidora Ltda'), true);
  assert.equal(isMksSupplier(null, 'MKS Distribuidora'), true);
  assert.equal(allowsDslitePlaceholderLabel(115, 'MKS'), true);
  assert.equal(isBkr1Supplier(115, 'MKS'), false);
  assert.equal(usesThermalMlLabelSupplier(115, 'MKS'), true);
  assert.equal(usesThermalMlLabelSupplier(null, 'MKS Distribuidora'), true);
  assert.equal(usesThermalMlLabelSupplier(97, 'Vanral'), true);
  assert.equal(usesThermalMlLabelSupplier(108, 'BKR1'), true);
  assert.equal(usesThermalMlLabelSupplier(133, 'Evolusom'), false);
});

test('ambas as rotas DSLite aplicam formato térmico somente à etiqueta real', () => {
  for (const route of ['pedido', 'etiqueta-auto']) {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'api', 'dslite', route, 'route.ts'),
      'utf8',
    );
    assert.match(source, /usesThermalMlLabelSupplier\(/);
    assert.match(source, /usarEtiquetaTermica \? ["']zpl2["'] : ["']pdf["']/);
    assert.match(source, /usarEtiquetaTermica\s*\? ["']etiqueta_ml\.zpl["']\s*: ["']etiqueta_ml\.pdf["']/);
    assert.match(source, /usarEtiquetaTermica\s*\? ["']text\/plain["']\s*: ["']application\/pdf["']/);
    assert.match(source, /enviarEtiqueta\(/);
  }
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
