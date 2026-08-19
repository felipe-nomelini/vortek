const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const {
  calculateFinancial,
  classifyFinal,
  classifyRemoteIdentity,
  extractShippingCost,
  sha256Canonical,
  titleClassification,
} = require('../scripts/lib/ml-p0-phase5c');

test('homologated phase 5B payload keeps authorized hash', () => {
  const report = JSON.parse(fs.readFileSync('reports/ml-p0-phase5b/full-payload.json', 'utf8'));
  assert.equal(sha256Canonical(report.payload), '17bbed8f4bdae44267e1134be13a1713036e3d6a08d233691b06e6f4d613620d');
});

test('financial calculation uses Mercado Livre rounded amounts', () => {
  const value = calculateFinancial({ price: 250.62, fee: 27.57, shipping: 39.75, cost: 132.55 });
  assert.equal(value.tax, 12.53);
  assert.equal(value.profit, 38.22);
  assert.ok(value.margin_percent >= 15.25);
});

test('shipping extraction prefers seller cost', () => {
  assert.equal(extractShippingCost({ senders: [{ cost: 18 }], coverage: { all_country: { list_cost: 39 } } }), 18);
  assert.equal(extractShippingCost({ coverage: { all_country: { list_cost: 39.75 } } }), 39.75);
});

test('generated title classification blocks wrong voltage', () => {
  assert.equal(titleClassification('Ventilador De Mesa Ventisol Turbo 6 40cm 127V').status, 'GENERATED_TITLE_OK');
  assert.equal(titleClassification('Ventilador De Mesa Ventisol Turbo 6 40cm').status, 'GENERATED_TITLE_WEAK');
  assert.equal(titleClassification('Ventilador De Mesa Ventisol Turbo 6 40cm 220V').status, 'GENERATED_TITLE_MATERIAL_ERROR');
});

test('final classification prioritizes catalog and identity drift', () => {
  assert.equal(classifyFinal({ catalogDrift: true }), 'CANARY_CATALOG_LINK_DRIFT');
  assert.equal(classifyFinal({ catalogDrift: false, identityDrift: true }), 'CANARY_IDENTITY_DRIFT');
  assert.equal(classifyFinal({ catalogDrift: false, identityDrift: false, financialDrift: false, materialImageDrift: false, normalized: true }), 'CATALOG_CANARY_SUCCESS_NORMALIZED');
});

test('remote similarity is not a possible duplicate when identifiers conflict', () => {
  const expected = { sku: 'VTK000392', gtin: '7898461970375', catalog_product_id: 'MLB15284402', brand: 'Ventisol', model: 'Turbo 6', voltage: '127V', color: 'Azul', diameter: '40 cm', type: 'De mesa' };
  const otherVariant = {
    seller_custom_field: 'VTK000353', catalog_product_id: 'MLB10484267',
    attributes: [
      { id: 'GTIN', value_name: '7898461970412' }, { id: 'BRAND', value_name: 'Ventisol' },
      { id: 'MODEL', value_name: 'Turbo 6' }, { id: 'VOLTAGE', value_name: '127V' },
      { id: 'BLADES_COLOR', value_name: 'Azul' }, { id: 'DIAMETER', value_name: '50 cm' },
      { id: 'FAN_TYPE', value_name: 'De mesa' },
    ],
  };
  const exact = { ...otherVariant, seller_custom_field: 'VTK000392' };
  assert.deepEqual({ equivalent: classifyRemoteIdentity(otherVariant, expected).equivalent, possible: classifyRemoteIdentity(otherVariant, expected).possible }, { equivalent: false, possible: false });
  assert.equal(classifyRemoteIdentity(exact, expected).equivalent, true);
});
