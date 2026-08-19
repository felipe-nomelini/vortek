const crypto = require('crypto');
const { plain, roundMoney } = require('./ml-p0-phase5a');

function normalize(value) {
  return plain(value).replace(/\s+/g, '');
}

function sha256Canonical(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function attributeValue(entity, id) {
  const attribute = (entity?.attributes || []).find((row) => String(row.id) === String(id));
  return attribute?.value_name || attribute?.value_id || null;
}

function extractShippingCost(quote) {
  const candidates = [
    quote?.senders?.[0]?.cost,
    quote?.coverage?.all_country?.list_cost,
    quote?.options?.[0]?.cost,
  ].map(Number).filter(Number.isFinite);
  return candidates[0] ?? null;
}

function calculateFinancial({ price, fee, shipping, cost, taxRate = 0.05 }) {
  const normalizedPrice = roundMoney(price);
  const commission = roundMoney(fee);
  const logistics = roundMoney(shipping);
  const productCost = roundMoney(cost);
  const tax = roundMoney(normalizedPrice * taxRate);
  const profit = roundMoney(normalizedPrice - commission - logistics - productCost - tax);
  return {
    price: normalizedPrice,
    commission,
    shipping: logistics,
    cost: productCost,
    tax,
    profit,
    margin_percent: normalizedPrice > 0 ? profit / normalizedPrice * 100 : 0,
  };
}

function titleClassification(title) {
  const normalized = normalize(title);
  const wrong = ['220v'].some((value) => normalized.includes(value));
  const required = {
    brand: normalized.includes(normalize('Ventisol')),
    model: normalized.includes(normalize('Turbo 6')),
    diameter: normalized.includes(normalize('40 cm')),
    voltage: normalized.includes(normalize('127V')),
    product_type: normalized.includes(normalize('Ventilador')) && normalized.includes(normalize('Mesa')),
  };
  if (wrong || !required.brand || !required.model || !required.diameter || !required.product_type) {
    return { status: 'GENERATED_TITLE_MATERIAL_ERROR', required, wrong_voltage: wrong };
  }
  if (!required.voltage) return { status: 'GENERATED_TITLE_WEAK', required, wrong_voltage: false };
  return { status: 'GENERATED_TITLE_OK', required, wrong_voltage: false };
}

function classifyRemoteIdentity(item, expected) {
  const sku = item?.seller_custom_field || attributeValue(item, 'SELLER_SKU');
  const remote = {
    gtin: attributeValue(item, 'GTIN'),
    catalog_product_id: String(item?.catalog_product_id || ''),
    voltage: attributeValue(item, 'VOLTAGE'),
    color: attributeValue(item, 'BLADES_COLOR'),
    diameter: attributeValue(item, 'DIAMETER'),
    type: attributeValue(item, 'FAN_TYPE'),
  };
  const fields = {
    sku: normalize(sku) === normalize(expected.sku),
    gtin: normalize(remote.gtin) === normalize(expected.gtin),
    catalog_product_id: remote.catalog_product_id === expected.catalog_product_id,
    brand: normalize(attributeValue(item, 'BRAND')) === normalize(expected.brand),
    model: normalize(attributeValue(item, 'MODEL')).includes(normalize(expected.model)),
    voltage: normalize(remote.voltage) === normalize(expected.voltage),
    color: normalize(remote.color) === normalize(expected.color),
    diameter: normalize(remote.diameter) === normalize(expected.diameter),
    type: normalize(remote.type) === normalize(expected.type),
  };
  const equivalent = fields.sku || fields.gtin || fields.catalog_product_id;
  const criticalConflicts = {
    gtin: Boolean(remote.gtin) && !fields.gtin,
    catalog_product_id: Boolean(remote.catalog_product_id) && !fields.catalog_product_id,
    voltage: Boolean(remote.voltage) && !fields.voltage,
    color: Boolean(remote.color) && !fields.color,
    diameter: Boolean(remote.diameter) && !fields.diameter,
    type: Boolean(remote.type) && !fields.type,
  };
  const possible = !equivalent
    && !Object.values(criticalConflicts).some(Boolean)
    && fields.brand && fields.model && fields.voltage;
  return { fields, critical_conflicts: criticalConflicts, equivalent, possible };
}

function classifyFinal({ catalogDrift, identityDrift, financialDrift, materialImageDrift, normalized }) {
  if (catalogDrift) return 'CANARY_CATALOG_LINK_DRIFT';
  if (identityDrift) return 'CANARY_IDENTITY_DRIFT';
  if (financialDrift) return 'CANARY_POST_FINANCIAL_DRIFT';
  if (materialImageDrift) return 'CANARY_IDENTITY_DRIFT';
  if (normalized) return 'CATALOG_CANARY_SUCCESS_NORMALIZED';
  return 'CATALOG_CANARY_SUCCESS';
}

function compareField(field, expected, remote, options = {}) {
  const match = options.numeric
    ? Math.abs(Number(expected) - Number(remote)) < 0.01
    : normalize(expected) === normalize(remote);
  return { field, expected, remote, status: match ? 'MATCH' : 'DIVERGENT', material: options.material !== false };
}

module.exports = {
  attributeValue,
  calculateFinancial,
  classifyRemoteIdentity,
  classifyFinal,
  compareField,
  extractShippingCost,
  normalize,
  sha256Canonical,
  titleClassification,
};
