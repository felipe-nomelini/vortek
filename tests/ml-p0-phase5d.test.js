const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED,
  buildQualityInfo,
  chooseProtectivePrice,
  minimumProtectivePrice,
  validateIdentity,
} = require('../scripts/lib/ml-p0-phase5d');

test('calcula o primeiro centavo com margem protetiva de 50%', () => {
  const minimum = minimumProtectivePrice({
    cost: 132.55, shipping: 68.65, commissionRate: 0.11, taxRate: 0.05, marginRate: 0.5,
  });
  assert.equal(minimum, 591.77);
  assert.equal(chooseProtectivePrice({ authorizedFloor: 599.90, minimumPrice: minimum }), 599.90);
});

test('qualidade oficial preserva score e ações pendentes', () => {
  const info = buildQualityInfo({
    entity_id: EXPECTED.userProductId, score: 64, level: 'Basic',
    buckets: [{ key: 'A', status: 'PENDING', rules: [{ key: 'DESCRIPTION', status: 'PENDING', wordings: { title: 'Adicione descrição' } }] }],
  }, `/user-product/${EXPECTED.userProductId}/performance`, '2026-08-16T00:00:00Z');
  assert.equal(info.score, 64);
  assert.equal(info.pending_actions.length, 2);
});

test('identidade bloqueia mudança de voltagem', () => {
  const attributes = [
    ['SELLER_SKU', EXPECTED.sku], ['GTIN', EXPECTED.gtin], ['BRAND', EXPECTED.brand],
    ['MODEL', EXPECTED.model], ['VOLTAGE', '220V'], ['BLADES_COLOR', EXPECTED.color], ['DIAMETER', EXPECTED.diameter],
  ].map(([id, value_name]) => ({ id, value_name }));
  const result = validateIdentity({
    id: EXPECTED.itemId, seller_id: EXPECTED.sellerId, user_product_id: EXPECTED.userProductId,
    family_id: Number(EXPECTED.familyId), category_id: EXPECTED.categoryId,
    catalog_product_id: EXPECTED.catalogProductId, listing_type_id: EXPECTED.listingTypeId,
    condition: EXPECTED.condition, attributes,
  });
  assert.equal(result.passed, false);
  assert.equal(result.fields.find((row) => row.field === 'VOLTAGE').status, 'DIVERGENT');
});
