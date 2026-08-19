const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DESCRIPTION,
  classifyWrite,
  compareDescription,
  validateDescription,
} = require('../scripts/lib/ml-p0-phase4c');

test('approved description is evidence-safe and within ML limit', () => {
  const validation = validateDescription(DESCRIPTION);
  assert.equal(validation.valid, true);
  assert.equal(validation.failures.length, 0);
  assert.ok(validation.characters < 5000);
});

test('description comparison permits only formatting normalization', () => {
  assert.equal(compareDescription(DESCRIPTION, DESCRIPTION).result, 'MATCH');
  assert.equal(compareDescription(DESCRIPTION, `${DESCRIPTION.replace(/\n/g, '\r\n')}\n`).result, 'NORMALIZED_BY_ML');
  assert.equal(compareDescription(DESCRIPTION, DESCRIPTION.replace('2600 mAh', '2500 mAh')).result, 'MATERIAL_TEXT_DRIFT');
});

test('write response is classified without retry semantics', () => {
  assert.equal(classifyWrite(201), 'DESCRIPTION_POST_SUCCESS');
  assert.equal(classifyWrite(400), 'DESCRIPTION_VALIDATION_ERROR');
  assert.equal(classifyWrite(405), 'DESCRIPTION_ENDPOINT_MISMATCH');
  assert.equal(classifyWrite(500), 'DESCRIPTION_API_ERROR');
});
