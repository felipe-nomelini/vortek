const { attributeValue, calculateFinancial, normalize } = require('./ml-p0-phase5c');

const EXPECTED = Object.freeze({
  sku: 'VTK000392',
  productId: 'eef0e527-8ef8-4a19-8132-9b1f670bb461',
  itemId: 'MLB7432322488',
  sellerId: 3294514937,
  userProductId: 'MLBU4772165100',
  familyId: '5623652722530511',
  gtin: '7898461970375',
  brand: 'Ventisol',
  model: 'Turbo 6',
  voltage: '127V',
  color: 'Azul',
  diameter: '40 cm',
  categoryId: 'MLB1645',
  catalogProductId: 'MLB15284402',
  listingTypeId: 'gold_special',
  quantity: 15,
  condition: 'new',
  cost: 132.55,
  priorShipping: 68.65,
  commissionRate: 0.11,
  taxRate: 0.05,
  protectiveMargin: 0.5,
  authorizedFloor: 599.90,
});

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function minimumProtectivePrice({ cost, shipping, commissionRate, taxRate, marginRate }) {
  const denominator = 1 - Number(commissionRate) - Number(taxRate) - Number(marginRate);
  if (!(denominator > 0)) throw new Error('invalid_protective_price_denominator');
  return Math.ceil(((Number(cost) + Number(shipping)) / denominator) * 100 - 1e-9) / 100;
}

function chooseProtectivePrice({ authorizedFloor, minimumPrice }) {
  return roundMoney(Math.max(Number(authorizedFloor), Number(minimumPrice)));
}

function validateIdentity(item, expected = EXPECTED) {
  const sellerSku = item?.seller_custom_field || attributeValue(item, 'SELLER_SKU');
  const fields = [
    ['item_id', expected.itemId, item?.id],
    ['seller_id', expected.sellerId, item?.seller_id],
    ['seller_sku', expected.sku, sellerSku],
    ['user_product_id', expected.userProductId, item?.user_product_id],
    ['family_id', String(expected.familyId), String(item?.family_id || '')],
    ['GTIN', expected.gtin, attributeValue(item, 'GTIN')],
    ['BRAND', expected.brand, attributeValue(item, 'BRAND')],
    ['MODEL', expected.model, attributeValue(item, 'MODEL')],
    ['VOLTAGE', expected.voltage, attributeValue(item, 'VOLTAGE')],
    ['BLADES_COLOR', expected.color, attributeValue(item, 'BLADES_COLOR')],
    ['DIAMETER', expected.diameter, attributeValue(item, 'DIAMETER')],
    ['category_id', expected.categoryId, item?.category_id],
    ['catalog_product_id', expected.catalogProductId, item?.catalog_product_id],
    ['listing_type_id', expected.listingTypeId, item?.listing_type_id],
    ['condition', expected.condition, item?.condition],
  ].map(([field, expectedValue, actual]) => ({
    field,
    expected: expectedValue,
    actual,
    status: normalize(expectedValue) === normalize(actual) ? 'MATCH' : 'DIVERGENT',
  }));
  return { fields, passed: fields.every((row) => row.status === 'MATCH') };
}

function normalizeQuality(performance) {
  const score = Number(performance?.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score * 100) / 100;
}

function collectQualityActions(performance) {
  const actions = [];
  const walk = (node, path = []) => {
    if (!node || typeof node !== 'object') return;
    const status = String(node.status || '').toUpperCase();
    if (status === 'PENDING') {
      actions.push({
        path: path.join('.'),
        key: node.key || null,
        title: node.title || node.wordings?.title || null,
        label: node.wordings?.label || null,
        mode: node.mode || null,
        progress: node.progress ?? null,
      });
    }
    for (const key of ['buckets', 'variables', 'rules']) {
      for (const [index, child] of (node[key] || []).entries()) walk(child, [...path, key, String(index)]);
    }
  };
  walk(performance, []);
  return actions;
}

function buildQualityInfo(performance, endpoint, checkedAt) {
  return {
    source: 'mercado_livre_performance',
    endpoint,
    entity_id: performance?.entity_id || null,
    entity_type: performance?.entity_type || null,
    score: normalizeQuality(performance),
    level: performance?.level || null,
    level_wording: performance?.level_wording || null,
    calculated_at: performance?.calculated_at || null,
    refreshed_at: checkedAt,
    pending_actions: collectQualityActions(performance),
  };
}

function financialAt({ price, fee, shipping, cost = EXPECTED.cost }) {
  return calculateFinancial({ price, fee, shipping, cost, taxRate: EXPECTED.taxRate });
}

function mapListingType(value) {
  return value === 'gold_pro' || value === 'gold_premium' ? 'premium' : 'classico';
}

function mapStatus(value) {
  return value === 'active' ? 'ativo' : 'pausado';
}

module.exports = {
  EXPECTED,
  buildQualityInfo,
  chooseProtectivePrice,
  collectQualityActions,
  financialAt,
  mapListingType,
  mapStatus,
  minimumProtectivePrice,
  normalizeQuality,
  roundMoney,
  validateIdentity,
};
