const assert = require('node:assert/strict');
const test = require('node:test');
const {
  KNOWN_FIELD_NOT_UPDATABLE,
  QUALITY_60_OVERRIDE,
  ROWS,
  TITLE_PATTERN,
  buildFamilyNameUpdate,
  normalizeFamilyName,
} = require('../scripts/lib/ml-family-name-batch');

test('lote consolidado contém 76 MLBs únicos e títulos válidos', () => {
  assert.equal(ROWS.length, 76);
  assert.equal(new Set(ROWS.map((row) => row.mlItemId)).size, 76);

  for (const row of ROWS) {
    assert.match(row.familyName, TITLE_PATTERN, row.mlItemId);
    assert.ok(row.familyName.length < 60, `${row.mlItemId}: ${row.familyName.length}`);
  }
});

test('títulos consolidados removem claims sem evidência', () => {
  const forbidden = /\b(?:Original|Nova|NF|Top)\b/i;
  for (const row of ROWS.slice(40)) assert.doesNotMatch(row.familyName, forbidden, row.mlItemId);
});

test('atualização usa endpoint family_name e nunca envia title', () => {
  assert.deepEqual(buildFamilyNameUpdate('MLB123', 'Nome Seguro'), {
    pathname: '/items/MLB123/family_name',
    body: { family_name: 'Nome Seguro' },
  });
});

test('lote preserva bloqueios conhecidos e override aprovado de qualidade 60', () => {
  assert.equal(KNOWN_FIELD_NOT_UPDATABLE.size, 6);
  assert.deepEqual([...QUALITY_60_OVERRIDE], ['MLB4894821149']);
  assert.equal(normalizeFamilyName('Bateria CR2032 3V'), normalizeFamilyName('Bateria Cr2032 3v'));
});
