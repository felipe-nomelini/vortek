const crypto = require('crypto');

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function plain(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function normalizeGtin(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return [8, 12, 13, 14].includes(digits.length) ? digits : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function tokens(value) {
  return new Set(plain(value).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((token) => token.length >= 2));
}

function titleSimilarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

function parsePackCount(value, attributes = []) {
  const normalized = plain(value);
  const patterns = [
    /\bkit\s+(?:de\s+)?(\d{1,3})\b/,
    /\b(\d{1,3})\s+(?:jogos?|unidades?|pecas?|pilhas?|cordas?)\b/,
    /\b(?:com|c\/)\s*(\d{1,3})\b/,
    /\bpack\s+(?:de\s+)?(\d{1,3})\b/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return Number(match[1]);
  }
  const attr = attributes.find((row) => row.id === 'UNITS_PER_PACK');
  const attrNumber = Number(String(attr?.value_name ?? attr?.value_id ?? '').replace(',', '.'));
  if (Number.isFinite(attrNumber) && attrNumber > 0) return attrNumber;
  return 1;
}

function itemAttributes(item, variation = null) {
  return [...(item.attributes || []), ...(variation?.attributes || []), ...(variation?.attribute_combinations || [])];
}

function attributeValue(attributes, id) {
  const row = (attributes || []).find((attribute) => attribute.id === id);
  return text(row?.value_name ?? row?.value_id);
}

function bestVariation(item, local) {
  let best = null;
  for (const variation of item.variations || []) {
    const attributes = itemAttributes(item, variation);
    const sku = text(variation.seller_custom_field || attributeValue(attributes, 'SELLER_SKU'));
    const gtin = normalizeGtin(attributeValue(attributes, 'GTIN') || attributeValue(attributes, 'EAN'));
    let score = 0;
    if (sku && sku === text(local.sku)) score += 2;
    if (gtin && gtin === normalizeGtin(local.gtin)) score += 1;
    if (!best || score > best.score) best = { variation, score };
  }
  return best?.score ? best.variation : null;
}

function remoteIdentity(item, local = {}) {
  const variation = bestVariation(item, local);
  const attributes = itemAttributes(item, variation);
  const gtins = [...new Set(attributes
    .filter((row) => ['GTIN', 'EAN', 'UPC', 'JAN', 'ISBN'].includes(row.id))
    .map((row) => normalizeGtin(row.value_name ?? row.value_id)).filter(Boolean))];
  const skus = [...new Set([
    item.seller_custom_field,
    attributeValue(item.attributes, 'SELLER_SKU'),
    variation?.seller_custom_field,
    attributeValue(attributes, 'SELLER_SKU'),
  ].map(text).filter(Boolean))];
  return {
    item_id: text(item.id),
    variation_id: variation?.id ? String(variation.id) : '',
    seller_skus: skus,
    gtins,
    brand: attributeValue(attributes, 'BRAND'),
    model: attributeValue(attributes, 'MODEL') || attributeValue(attributes, 'DETAILED_MODEL'),
    catalog_product_id: text(variation?.catalog_product_id || item.catalog_product_id),
    user_product_id: text(variation?.user_product_id || item.user_product_id),
    pack_count: parsePackCount(item.title, attributes),
    attributes,
  };
}

function compareRemoteMatch({ local, item, expectedCatalogProductId = '', linkedProduct = null }) {
  const remote = remoteIdentity(item, local);
  const localGtin = normalizeGtin(local.gtin);
  const localBrand = plain(local.brand);
  const localModel = plain(local.model);
  const localPack = Number(local.pack_count || parsePackCount(local.title));
  const similarity = titleSimilarity(local.title, item.title);
  const skuMatch = remote.seller_skus.includes(text(local.sku));
  const gtinMatch = Boolean(localGtin && remote.gtins.includes(localGtin));
  const gtinConflict = Boolean(localGtin && remote.gtins.length && !gtinMatch);
  const catalogMatch = Boolean(expectedCatalogProductId && remote.catalog_product_id === expectedCatalogProductId);
  const brandMatch = Boolean(localBrand && plain(remote.brand || item.title).includes(localBrand));
  const modelMatch = Boolean(localModel && plain(`${remote.model} ${item.title}`).includes(localModel));
  const packMatch = localPack === remote.pack_count;
  const linkedIdentityMatch = !linkedProduct || (
    (!localGtin || normalizeGtin(linkedProduct.gtin) === localGtin) &&
    (!localBrand || plain(linkedProduct.marca) === localBrand)
  );

  let confidence = 0;
  if (skuMatch) confidence += 50;
  if (gtinMatch) confidence += 45;
  if (catalogMatch) confidence += 25;
  if (brandMatch) confidence += 10;
  if (modelMatch) confidence += 15;
  confidence += Math.round(similarity * 15);
  if (packMatch) confidence += 10;
  if (gtinConflict) confidence -= 50;
  if (!packMatch) confidence -= 50;
  confidence = Math.max(0, Math.min(100, confidence));
  if (packMatch && brandMatch && modelMatch && similarity >= 0.55 && !gtinConflict) confidence = Math.max(confidence, 95);
  if (gtinMatch && packMatch && !gtinConflict) confidence = Math.max(confidence, 95);
  if (catalogMatch && packMatch && brandMatch && !gtinConflict) confidence = Math.max(confidence, 95);

  let matchType = 'NOT_MATCH';
  if (gtinConflict || !packMatch) matchType = 'NOT_MATCH';
  else if (remote.variation_id && (skuMatch || gtinMatch)) matchType = 'VARIATION_MATCH';
  else if (skuMatch || gtinMatch) matchType = 'EXACT_MATCH';
  else if (catalogMatch && confidence >= 80) matchType = 'CATALOG_MATCH';
  else if (confidence >= 95) matchType = 'STRONG_MATCH';
  else if (confidence >= 60) matchType = 'POSSIBLE_MATCH';
  if (!linkedIdentityMatch && ['EXACT_MATCH', 'CATALOG_MATCH', 'STRONG_MATCH', 'VARIATION_MATCH'].includes(matchType)) {
    matchType = 'WRONG_LOCAL_LINK';
  }

  return {
    match_type: matchType,
    confidence,
    evidence: {
      sku_match: skuMatch,
      gtin_match: gtinMatch,
      gtin_conflict: gtinConflict,
      catalog_match: catalogMatch,
      brand_match: brandMatch,
      model_match: modelMatch,
      title_similarity: Number(similarity.toFixed(4)),
      pack_match: packMatch,
      local_pack_count: localPack,
      remote_pack_count: remote.pack_count,
      linked_identity_match: linkedIdentityMatch,
      variation_id: remote.variation_id || null,
    },
    remote_identity: remote,
  };
}

function localDuplicateConfidence(a, b) {
  const gtinA = normalizeGtin(a.gtin);
  const gtinB = normalizeGtin(b.gtin);
  const gtinMatch = Boolean(gtinA && gtinA === gtinB);
  const brandMatch = Boolean(plain(a.marca) && plain(a.marca) === plain(b.marca));
  const modelMatch = Boolean(plain(a.model) && plain(a.model) === plain(b.model));
  const supplierMatch = Boolean(a.dslite_fornecedor_id && b.dslite_fornecedor_id && String(a.dslite_fornecedor_id) === String(b.dslite_fornecedor_id));
  const dsliteMatch = Boolean(supplierMatch && a.dslite_produto_id && String(a.dslite_produto_id) === String(b.dslite_produto_id));
  const imagesA = new Set((a.imagens || []).map(text));
  const imageMatch = (b.imagens || []).some((url) => imagesA.has(text(url)));
  const packMatch = parsePackCount(a.nome) === parsePackCount(b.nome);
  const similarity = titleSimilarity(a.nome, b.nome);
  let confidence = gtinMatch ? 70 : 0;
  if (brandMatch) confidence += 10;
  if (modelMatch) confidence += 10;
  if (dsliteMatch) confidence += 30;
  if (imageMatch) confidence += 10;
  confidence += Math.round(similarity * 10);
  if (!packMatch) confidence -= 45;
  return {
    confidence: Math.max(0, Math.min(100, confidence)),
    gtin_match: gtinMatch,
    model_match: modelMatch,
    supplier_match: supplierMatch,
    image_match: imageMatch,
    pack_match: packMatch,
    title_similarity: Number(similarity.toFixed(4)),
  };
}

function canonicalRank(product) {
  return Number(product.sold_quantity || 0) * 1000000
    + Number(product.active_remote_count || 0) * 100000
    + Number(Boolean(normalizeGtin(product.gtin))) * 10000
    + Number(product.quality_score || 0) * 100
    + Number(Boolean(product.oferta_preferencial_id)) * 10
    + Math.max(0, 10 - Number(product.age_rank || 10));
}

function chooseCanonicalProduct(a, b) {
  const rankA = canonicalRank(a);
  const rankB = canonicalRank(b);
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return String(a.created_at || '') <= String(b.created_at || '') ? a : b;
}

function chooseRecommendedAction({ equivalentMatches, maxConfidence, hasLocalDuplicate, gates, sourceDeferred, categoryMismatch, manualIdentity, manualTech, manualImage }) {
  if (equivalentMatches > 0) return hasLocalDuplicate ? 'BLOCK_DUPLICATE' : maxConfidence >= 95 ? 'LINK_EXISTING' : 'MANUAL_LINK_REVIEW';
  if (categoryMismatch) return 'CATEGORY_MISMATCH';
  if (manualIdentity) return 'MANUAL_IDENTITY';
  if (manualImage) return 'MANUAL_IMAGE';
  if (manualTech) return 'MANUAL_TECH';
  if (sourceDeferred) return 'SOURCE_DEFERRED';
  const ready = gates.identity >= 95 && gates.documentation >= 90 && gates.publication >= 90
    && gates.duplicateRisk <= 10 && gates.category && gates.attributes && gates.image;
  return ready ? 'READY_FOR_CREATE' : 'MANUAL_TECH';
}

function toCsv(headers, rows) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))]
    .map((row) => row.map(escape).join(',')).join('\n') + '\n';
}

module.exports = {
  attributeValue,
  chooseCanonicalProduct,
  chooseRecommendedAction,
  compareRemoteMatch,
  itemAttributes,
  localDuplicateConfidence,
  normalizeGtin,
  parsePackCount,
  plain,
  remoteIdentity,
  sha256,
  text,
  titleSimilarity,
  toCsv,
};
