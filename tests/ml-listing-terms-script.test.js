const assert = require('node:assert/strict');
const test = require('node:test');

const {
  KNOWN_PAIRS,
  OPERATION_KEY,
  PROTECTED_SURVIVORS,
  brandsEquivalent,
  buildBulkPath,
  gtinKey,
  manifestHash,
} = require('../scripts/ml-listing-terms-under70');

test('manifesto destrutivo contém os oito pares confirmados pela inspeção', () => {
  assert.equal(OPERATION_KEY, 'ml-under70-terms-20260913-v1');
  assert.equal(KNOWN_PAIRS.length, 8);
  assert.equal(new Set(KNOWN_PAIRS.flatMap((pair) => [pair.standardId, pair.catalogId])).size, 16);
  assert.deepEqual(KNOWN_PAIRS.map((pair) => pair.sku), [
    'VTK012448', 'VTK012044', 'VTK012651', 'VTK012444', 'VTK017218', 'VTK017345',
    'VTK012141', 'VTK017875',
  ]);
  assert.deepEqual(PROTECTED_SURVIVORS.map((row) => row.itemId), ['MLB5199882917', 'MLB7602525364']);
});

test('consulta múltipla usa somente /items/bulk e limita vinte itens', () => {
  const path = buildBulkPath(['MLB1', 'MLB2']);
  assert.match(path, /^\/items\/bulk\?ids=MLB1,MLB2&attributes=/);
  assert.match(decodeURIComponent(path), /body\.listing_type_id/);
  assert.throws(() => buildBulkPath(Array.from({ length: 21 }, (_, index) => `MLB${index}`)), /1 a 20/);
});

test('hash do manifesto é determinístico e muda com a ação', () => {
  const row = {
    ml_item_id: 'MLB1', action: 'normalize', reason: 'target', is_canary: false,
    before_state: { status: 'active', price: 50 },
    desired_state: { listing_type_id: 'gold_special', free_shipping: false },
  };
  assert.equal(manifestHash([row]), manifestHash([{ ...row }]));
  assert.equal(
    manifestHash([row]),
    manifestHash([{ ...row, desired_state: { free_shipping: false, listing_type_id: 'gold_special' } }]),
  );
  assert.notEqual(manifestHash([row]), manifestHash([{ ...row, action: 'noop' }]));
});

test('normaliza representações equivalentes de GTIN e marca sem ocultar divergências', () => {
  assert.equal(gtinKey('06940651411555'), gtinKey('6940651411555'));
  assert.equal(brandsEquivalent('C3Tech', 'C3 Tech'), true);
  assert.equal(brandsEquivalent('Furukawa', 'Sohoplus Furukawa'), true);
  assert.equal(brandsEquivalent('Rayovac', 'Panasonic'), false);
  assert.equal(brandsEquivalent('FBG', 'Aquário'), false);
});
