const assert = require('node:assert/strict');
const test = require('node:test');
const { buildFamilyNameUpdate } = require('../scripts/lib/ml-family-name-batch');
const {
  ROWS,
  TITLE_PATTERN,
  sanitizeFamilyName,
} = require('../scripts/lib/ml-seo-resgate-v1');

test('operação contém 72 MLBs únicos e títulos sanitizados válidos', () => {
  assert.equal(ROWS.length, 72);
  assert.equal(new Set(ROWS.map((row) => row.mlItemId)).size, 72);

  for (const row of ROWS) {
    assert.match(row.familyName, TITLE_PATTERN, row.mlItemId);
    assert.ok(row.familyName.length < 60, `${row.mlItemId}: ${row.familyName.length}`);
  }
});

test('claims sem prova são removidos sem destruir dados factuais', () => {
  assert.equal(
    sanitizeFamilyName('Bateria CR2032 3V Original Nova Premium Qualidade NF'),
    'Bateria CR2032 3V',
  );
  assert.equal(
    sanitizeFamilyName('Cafeteira Arno Preferita Inox 750ml 220V Original NF'),
    'Cafeteira Arno Preferita Inox 750ml 220V',
  );
  for (const row of ROWS) {
    assert.doesNotMatch(row.familyName, /\b(?:NF|Nova|Original|Premium|Qualidade)\b/i, row.mlItemId);
  }
});

test('operação usa family_name e nunca envia title', () => {
  assert.deepEqual(buildFamilyNameUpdate('MLB123', 'Nome Seguro'), {
    pathname: '/items/MLB123/family_name',
    body: { family_name: 'Nome Seguro' },
  });
});
