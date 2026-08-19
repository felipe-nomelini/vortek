const { plain, roundMoney, sha256 } = require('./ml-p0-phase5a');

function normalize(value) {
  return plain(value).replace(/\s+/g, '');
}

function catalogAttributeValues(product, ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  return (product?.attributes || [])
    .filter((attribute) => wanted.has(String(attribute.id)))
    .map((attribute) => attribute.value_name || attribute.value_id || '')
    .filter(Boolean);
}

function compareCatalogIdentity(product, expected) {
  const fields = Object.entries(expected).map(([field, definition]) => {
    const values = catalogAttributeValues(product, definition.ids);
    const aliases = definition.aliases.map(normalize);
    const match = values.some((value) => aliases.some((alias) => normalize(value) === alias));
    return { field, critical: definition.critical !== false, ids: definition.ids, expected: definition.aliases, catalog_values: values, match };
  });
  const gtin = fields.find((row) => row.field === 'gtin');
  const voltage = fields.find((row) => row.field === 'voltage');
  let gate = 'CATALOG_EXACT_MATCH';
  if (gtin && !gtin.match) gate = 'CATALOG_GTIN_CONFLICT';
  else if (voltage && !voltage.match) gate = 'VOLTAGE_CONFLICT';
  else if (fields.some((row) => row.critical && !row.match)) gate = 'CATALOG_IDENTITY_CONFLICT';
  return { gate, confidence: gate === 'CATALOG_EXACT_MATCH' ? 100 : 0, fields };
}

function calculateFinancial(price, feeAmount, shipping, cost, taxRate = 0.05) {
  const tax = roundMoney(Number(price) * taxRate);
  const profit = roundMoney(Number(price) - Number(feeAmount) - Number(shipping) - Number(cost) - tax);
  return { price: roundMoney(price), commission: roundMoney(feeAmount), shipping: roundMoney(shipping), cost: roundMoney(cost), tax, profit, margin_percent: Number(price) > 0 ? profit / Number(price) * 100 : 0 };
}

function classifyFinal(gates) {
  if (gates.remote_match) return 'CANARY_ABORT_REMOTE_MATCH';
  if (gates.catalog_gate === 'CATALOG_GTIN_CONFLICT') return 'CATALOG_GTIN_CONFLICT';
  if (gates.catalog_gate === 'VOLTAGE_CONFLICT') return 'VOLTAGE_CONFLICT';
  if (gates.catalog_gate !== 'CATALOG_EXACT_MATCH' && gates.catalog_gate !== 'CATALOG_VARIATION_MATCH') return 'CATALOG_IDENTITY_CONFLICT';
  if (!gates.category_valid) return 'CATEGORY_MISMATCH';
  if (!gates.attributes_complete) return 'MANUAL_TECH';
  if (!gates.images_approved) return 'MANUAL_IMAGE';
  if (!gates.financial_approved) return 'FINANCIAL_NO_GO';
  if (gates.competition === 'MARGIN_OK_NOT_COMPETITIVE') return 'MARGIN_OK_NOT_COMPETITIVE';
  return 'CATALOG_CANARY_PREPUBLISH_READY';
}

function assertCatalogPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if ('title' in payload || 'description' in payload || 'variations' in payload) return false;
  return payload.category_id === 'MLB1645'
    && payload.catalog_product_id === 'MLB15284402'
    && payload.catalog_listing === true
    && Boolean(payload.family_name)
    && Number(payload.price) > 0
    && Number(payload.available_quantity) > 0;
}

module.exports = { assertCatalogPayload, calculateFinancial, catalogAttributeValues, classifyFinal, compareCatalogIdentity, normalize, sha256 };
