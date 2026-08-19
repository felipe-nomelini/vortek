const crypto = require('crypto');

function plain(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function attributeValue(item, id) {
  const values = [];
  for (const attribute of item?.attributes || []) {
    if (attribute.id === id) values.push(attribute.value_name || attribute.value_id || '');
  }
  for (const variation of item?.variations || []) {
    for (const attribute of [...(variation.attribute_combinations || []), ...(variation.attributes || [])]) {
      if (attribute.id === id) values.push(attribute.value_name || attribute.value_id || '');
    }
  }
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function remoteMatch(item, candidate) {
  const skus = [item?.seller_custom_field, ...attributeValue(item, 'SELLER_SKU')].map(plain).filter(Boolean);
  const gtins = attributeValue(item, 'GTIN').map((value) => value.replace(/\D/g, '')).filter(Boolean);
  const brand = plain(attributeValue(item, 'BRAND')[0]);
  const model = plain(attributeValue(item, 'MODEL')[0]);
  const title = plain(item?.title);
  const skuMatch = skus.includes(plain(candidate.sku));
  const gtinMatch = gtins.includes(String(candidate.gtin));
  const catalogMatch = Boolean(candidate.catalog_product_id && item?.catalog_product_id === candidate.catalog_product_id);
  const modelMatch = Boolean(plain(candidate.model) && (model === plain(candidate.model) || title.includes(plain(candidate.model))));
  const brandMatch = Boolean(plain(candidate.brand) && (brand === plain(candidate.brand) || title.includes(plain(candidate.brand))));
  const distinguishingMatches = Object.entries(candidate.distinguishing_attributes || {}).map(([id, expected]) => {
    const remoteValues = attributeValue(item, id).map(plain);
    const expectedValues = (Array.isArray(expected) ? expected : [expected]).map(plain);
    const titleMatch = expectedValues.some((value) => value && title.includes(value));
    const attributeMatch = remoteValues.some((remoteValue) => expectedValues.some((value) => remoteValue === value || remoteValue.includes(value)));
    return { id, matched: titleMatch || attributeMatch, expected: expectedValues, remote: remoteValues };
  });
  const distinguishingMatch = distinguishingMatches.length > 0 && distinguishingMatches.every((row) => row.matched);
  const userProductMatch = Boolean(candidate.user_product_id && item?.user_product_id === candidate.user_product_id);
  let classification = 'NOT_MATCH';
  let confidence = 0;
  if (skuMatch || gtinMatch) { classification = 'EXACT_REMOTE_MATCH'; confidence = 100; }
  else if (catalogMatch) { classification = 'EXACT_REMOTE_MATCH'; confidence = 98; }
  else if (userProductMatch) { classification = 'EXACT_REMOTE_MATCH'; confidence = 98; }
  else if (brandMatch && modelMatch && distinguishingMatch) { classification = 'POSSIBLE_MATCH'; confidence = 85; }
  return { classification, confidence, evidence: { sku_match: skuMatch, gtin_match: gtinMatch, catalog_match: catalogMatch, user_product_match: userProductMatch, brand_match: brandMatch, model_match: modelMatch, distinguishing_match: distinguishingMatch, distinguishing_attributes: distinguishingMatches }, remote: { seller_skus: skus, gtins, brand, model } };
}

function finalState(gates) {
  if (gates.remote_exact) return 'BLOCK_REMOTE_EXISTING';
  if (gates.remote_possible) return 'MANUAL_IDENTITY';
  if (gates.local_duplicate) return 'BLOCK_LOCAL_DUPLICATE';
  if (gates.gtin_conflict) return 'MANUAL_GTIN';
  if (!gates.identity_confirmed) return 'MANUAL_IDENTITY';
  if (!gates.category_valid) return 'CATEGORY_MISMATCH';
  if (!gates.image_approved) return 'MANUAL_IMAGE';
  if (!gates.attributes_complete) return 'MANUAL_TECH';
  if (!gates.financial_approved) return 'FINANCIAL_NO_GO';
  if (gates.source_deferred) return 'SOURCE_DEFERRED';
  return 'MULTI_CANARY_READY';
}

function assertAuditPayload(payload) {
  if (!payload || typeof payload !== 'object') return true;
  if ('title' in payload || 'description' in payload || 'variations' in payload) return false;
  return Boolean(payload.family_name && payload.category_id && payload.price && payload.available_quantity && Array.isArray(payload.attributes));
}

module.exports = { assertAuditPayload, attributeValue, finalState, plain, remoteMatch, roundMoney, sha256 };
