const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const warranty = require('../src/lib/product-warranty.ts');
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const category = [
  {
    id: 'WARRANTY_TYPE',
    values: [
      { id: '2230279', name: 'Garantia de fábrica' },
      { id: '2230280', name: 'Garantia do vendedor' },
    ],
  },
  { id: 'WARRANTY_TIME', allowed_units: [{ id: 'meses' }, { id: 'dias' }] },
];

test('aplica 12 meses de garantia de fábrica sem avaliação individual', () => {
  const result = warranty.warrantySaleTerms(category);
  assert.equal(result.compatible, true);
  assert.deepEqual(result.terms, [
    { id: 'WARRANTY_TYPE', value_id: '2230279', value_name: 'Garantia de fábrica' },
    { id: 'WARRANTY_TIME', value_name: '12 meses' },
  ]);
  assert.equal(warranty.factoryWarranty.revision, 'BNT-WARRANTY-FACTORY-12M-v1');
});

test('aceita prazo enumerado equivalente a um ano', () => {
  const result = warranty.warrantySaleTerms([
    category[0],
    { id: 'WARRANTY_TIME', values: [{ id: 'ONE_YEAR', name: '1 ano' }] },
  ]);
  assert.equal(result.compatible, true);
  assert.equal(result.terms[1].value_id, 'ONE_YEAR');
});

test('bloqueia apenas categoria que não representa a política fixa', () => {
  assert.equal(warranty.warrantySaleTerms([]).compatible, false);
  assert.equal(warranty.warrantySaleTerms([
    category[0],
    { id: 'WARRANTY_TIME', values: [{ id: 'SIX_MONTHS', name: '6 meses' }] },
  ]).compatible, false);
});

test('normaliza a descrição para a garantia comercial vigente', () => {
  const description = warranty.warrantyDescription('Produto resistente. Garantia do vendedor: 3 meses.');
  assert.doesNotMatch(description, /3 meses|vendedor/i);
  assert.match(description, /GARANTIA\nGarantia de fábrica: 12 meses\./);
  assert.equal(warranty.warrantyDescription(description), description);
});

test('identifica somente promessas contraditórias recebidas no formulário', () => {
  assert.equal(warranty.warrantyDescriptionConflicts('Produto novo.'), false);
  assert.equal(warranty.warrantyDescriptionConflicts('Garantia de fábrica: 12 meses.'), false);
  assert.equal(warranty.warrantyDescriptionConflicts('Garantia de fábrica: 1 ano.'), false);
  assert.equal(warranty.warrantyDescriptionConflicts('Garantia do vendedor: 12 meses.'), true);
  assert.equal(warranty.warrantyDescriptionConflicts('Sem garantia.'), true);
  assert.equal(warranty.warrantyDescriptionConflicts('Garantia: 6 meses.'), true);
});

test('fluxo de anúncio não consulta pesquisa ou avaliação de garantia por produto', () => {
  for (const relativePath of [
    'src/services/publication-preparation.ts',
    'src/services/publication-readback.ts',
    'src/app/api/ml/anuncio/schema/route.ts',
    'src/app/api/ml/anuncio/sugerir-campo/route.ts',
  ]) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /loadProductWarranty|prepareProductWarranty|get_product_warranty_snapshot/);
  }
  assert.equal(fs.existsSync(path.join(root, 'src/app/api/produtos/[id]/warranty/route.ts')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/services/product-warranty.ts')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/services/warranty-codex.ts')), false);
});
