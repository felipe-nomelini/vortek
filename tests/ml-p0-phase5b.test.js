const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCatalogPayload, calculateFinancial, classifyFinal, compareCatalogIdentity } = require('../scripts/lib/ml-p0-phase5b');

const catalog = {
  attributes: [
    { id: 'BRAND', value_name: 'Ventisol' }, { id: 'MODEL', value_name: 'Turbo 6' }, { id: 'GTIN', value_name: '7898461970375' },
    { id: 'VOLTAGE', value_name: '127V' }, { id: 'BLADES_COLOR', value_name: 'Azul' }, { id: 'DIAMETER', value_name: '40 cm' },
  ],
};
const expected = {
  brand: { ids: ['BRAND'], aliases: ['Ventisol'] }, model: { ids: ['MODEL'], aliases: ['Turbo 6'] }, gtin: { ids: ['GTIN'], aliases: ['7898461970375'] },
  voltage: { ids: ['VOLTAGE'], aliases: ['127 V', '127V'] }, color: { ids: ['BLADES_COLOR'], aliases: ['Azul'] }, diameter: { ids: ['DIAMETER'], aliases: ['40cm', '40 cm'] },
};

test('catalog identity is exact only when critical variation matches', () => {
  assert.equal(compareCatalogIdentity(catalog, expected).gate, 'CATALOG_EXACT_MATCH');
  assert.equal(compareCatalogIdentity({ ...catalog, attributes: catalog.attributes.map((row) => row.id === 'VOLTAGE' ? { ...row, value_name: '220V' } : row) }, expected).gate, 'VOLTAGE_CONFLICT');
});

test('financial calculation applies rounded commission, shipping and tax', () => {
  const row = calculateFinancial(269.23, 43.08, 39.75, 132.55);
  assert.deepEqual({ tax: row.tax, profit: row.profit }, { tax: 13.46, profit: 40.39 });
});

test('catalog payload forbids legacy title, description and variations', () => {
  const payload = { family_name: 'Ventilador de Mesa Ventisol Turbo 6 40 cm', category_id: 'MLB1645', catalog_product_id: 'MLB15284402', catalog_listing: true, price: 270, available_quantity: 15 };
  assert.equal(assertCatalogPayload(payload), true);
  assert.equal(assertCatalogPayload({ ...payload, title: 'forbidden' }), false);
});

test('competition state blocks READY without changing margin gate', () => {
  const gates = { remote_match: false, catalog_gate: 'CATALOG_EXACT_MATCH', category_valid: true, attributes_complete: true, images_approved: true, financial_approved: true, competition: 'MARGIN_OK_NOT_COMPETITIVE' };
  assert.equal(classifyFinal(gates), 'MARGIN_OK_NOT_COMPETITIVE');
  assert.equal(classifyFinal({ ...gates, competition: 'COMPETITIVE' }), 'CATALOG_CANARY_PREPUBLISH_READY');
});
