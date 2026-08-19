const crypto = require('crypto');

const EXPECTED = Object.freeze({
  sku: 'VTK000486',
  productId: 'e232fe84-9f89-4d22-9737-8d444e5f7db9',
  itemId: 'MLB7432157712',
  sellerId: 3294514937,
  userProductId: 'MLBU4771606790',
  familyId: '4094059417953552',
  gtin: '4904530109270',
  brand: 'Toshiba',
  model: 'TNHC-6GAE4 CB',
  categoryId: 'MLB11290',
  productType: 'Pilha',
  inputVoltage: '127/220V',
  price: 187.22,
  quantity: 15,
  listingTypeId: 'gold_pro',
  condition: 'new',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function attribute(item, id) {
  const row = (item?.attributes || []).find((entry) => entry.id === id);
  return String(row?.value_name || row?.value_id || '').trim();
}

function stableRemoteCommercialState(item, userProduct, family) {
  const attributes = (item?.attributes || [])
    .map((row) => ({ id: row.id, value_id: row.value_id ?? null, value_name: row.value_name ?? null }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const pictures = (item?.pictures || []).map((row) => ({
    id: row.id,
    secure_url: row.secure_url || null,
  }));
  return {
    item_id: item?.id || null,
    seller_id: item?.seller_id ?? null,
    seller_sku: item?.seller_custom_field || attribute(item, 'SELLER_SKU') || null,
    user_product_id: item?.user_product_id || userProduct?.id || null,
    family_id: String(item?.family_id || userProduct?.family_id || family?.family_id || ''),
    family_name: item?.family_name || userProduct?.family_name || null,
    title: item?.title || null,
    status: item?.status || null,
    price: Number(item?.price),
    available_quantity: Number(item?.available_quantity),
    sold_quantity: Number(item?.sold_quantity),
    category_id: item?.category_id || null,
    listing_type_id: item?.listing_type_id || null,
    condition: item?.condition || null,
    shipping: item?.shipping || null,
    catalog_listing: item?.catalog_listing === true,
    catalog_product_id: item?.catalog_product_id || null,
    permalink: item?.permalink || null,
    pictures,
    attributes,
  };
}

function remoteCommercialHash(item, userProduct, family) {
  return sha256(JSON.stringify(stableRemoteCommercialState(item, userProduct, family)));
}

function compareStableRemoteState(previous, current) {
  const fields = [];
  for (const field of Object.keys(previous)) {
    if (field === 'pictures' || field === 'attributes') continue;
    if (JSON.stringify(previous[field]) !== JSON.stringify(current[field])) {
      fields.push({ field, previous: previous[field], current: current[field], status: 'DIVERGENT' });
    }
  }
  const maxPictures = Math.max(previous.pictures?.length || 0, current.pictures?.length || 0);
  for (let index = 0; index < maxPictures; index += 1) {
    if (JSON.stringify(previous.pictures?.[index]) !== JSON.stringify(current.pictures?.[index])) {
      fields.push({ field: `pictures[${index}]`, previous: previous.pictures?.[index] || null, current: current.pictures?.[index] || null, status: 'DIVERGENT' });
    }
  }
  const previousAttrs = new Map((previous.attributes || []).map((row) => [row.id, row]));
  const currentAttrs = new Map((current.attributes || []).map((row) => [row.id, row]));
  for (const id of new Set([...previousAttrs.keys(), ...currentAttrs.keys()])) {
    if (JSON.stringify(previousAttrs.get(id)) !== JSON.stringify(currentAttrs.get(id))) {
      fields.push({ field: `attributes.${id}`, previous: previousAttrs.get(id) || null, current: currentAttrs.get(id) || null, status: 'DIVERGENT' });
    }
  }
  return { fields, drift: fields.length > 0 };
}

function validateRemoteIdentity(item, userProduct, family, expected = EXPECTED) {
  const actual = stableRemoteCommercialState(item, userProduct, family);
  const checks = [
    ['item_id', expected.itemId, actual.item_id],
    ['seller_id', expected.sellerId, actual.seller_id],
    ['seller_sku', expected.sku, actual.seller_sku],
    ['user_product_id', expected.userProductId, actual.user_product_id],
    ['family_id', String(expected.familyId), actual.family_id],
    ['GTIN', expected.gtin, attribute(item, 'GTIN')],
    ['BRAND', expected.brand, attribute(item, 'BRAND')],
    ['MODEL', expected.model, attribute(item, 'MODEL')],
    ['category_id', expected.categoryId, actual.category_id],
  ].map(([field, expectedValue, remote]) => ({
    field,
    expected: expectedValue,
    remote,
    status: String(remote) === String(expectedValue) ? 'MATCH' : 'DIVERGENT',
    material: true,
  }));

  const commercialChecks = [
    ['status', 'active', actual.status],
    ['price', expected.price, actual.price],
    ['available_quantity', expected.quantity, actual.available_quantity],
    ['listing_type_id', expected.listingTypeId, actual.listing_type_id],
    ['condition', expected.condition, actual.condition],
    ['PRODUCT_TYPE', expected.productType, attribute(item, 'PRODUCT_TYPE')],
    ['INPUT_VOLTAGE', expected.inputVoltage, attribute(item, 'INPUT_VOLTAGE')],
    ['shipping.mode', 'me2', item?.shipping?.mode],
  ].map(([field, expectedValue, remote]) => ({
    field,
    expected: expectedValue,
    remote,
    status: String(remote) === String(expectedValue) ? 'MATCH' : 'DIVERGENT',
    material: true,
  }));

  return {
    identity: checks,
    commercial: commercialChecks,
    identityMismatch: checks.some((row) => row.status !== 'MATCH'),
    commercialDrift: commercialChecks.some((row) => row.status !== 'MATCH'),
  };
}

function mapListingType(listingTypeId) {
  if (listingTypeId === 'gold_pro' || listingTypeId === 'gold_premium') return 'premium';
  if (listingTypeId === 'gold_special' || listingTypeId === 'free') return 'classico';
  return String(listingTypeId || 'classico');
}

function mapStatus(status) {
  return status === 'active' ? 'ativo' : 'pausado';
}

function buildListingPayload(item, expected = EXPECTED) {
  return {
    ml_item_id: expected.itemId,
    produto_id: expected.productId,
    sku: expected.sku,
    titulo: item.title,
    tipo: mapListingType(item.listing_type_id),
    preco_ml: Number(item.price),
    vendidos: Number(item.sold_quantity || 0),
    status: mapStatus(item.status),
    catalogo: item.catalog_listing === true,
    thumbnail: item.pictures?.[0]?.secure_url || item.thumbnail || null,
    permalink: item.permalink || null,
  };
}

function classifyLocalState({ product, productBySku, itemListings, productListings, skuListings, otherProducts }, expected = EXPECTED) {
  const exactListing = itemListings.find((row) => row.produto_id === expected.productId && row.sku === expected.sku);
  const foreignItemListing = itemListings.some((row) => row.produto_id !== expected.productId || row.sku !== expected.sku);
  const otherListing = [...productListings, ...skuListings].some((row) => row.ml_item_id !== expected.itemId);
  const foreignProduct = otherProducts.some((row) => row.id !== expected.productId);

  if (!product || product.id !== expected.productId || product.sku !== expected.sku || !productBySku || productBySku.id !== expected.productId) {
    return { state: 'IDENTITY_MISMATCH', exactListing: exactListing || null };
  }
  if (product.ml_item_id === expected.itemId && exactListing && !foreignItemListing && !otherListing && !foreignProduct) {
    return { state: 'ALREADY_CONSISTENT', exactListing };
  }
  if (product.ml_item_id || foreignItemListing || otherListing || foreignProduct || exactListing) {
    return { state: 'CONCURRENT_LINK', exactListing: exactListing || null };
  }
  return { state: 'CLEAR', exactListing: null };
}

function buildLocalRemoteDiff(product, listing, item, expected = EXPECTED) {
  const fields = [
    ['ml_item_id', expected.itemId, product?.ml_item_id],
    ['SKU', expected.sku, listing?.sku],
    ['produto_id', expected.productId, listing?.produto_id],
    ['title', item?.title, listing?.titulo],
    ['price', Number(item?.price), Number(listing?.preco_ml)],
    ['status', mapStatus(item?.status), listing?.status],
    ['listing_type', mapListingType(item?.listing_type_id), listing?.tipo],
    ['catalogo', item?.catalog_listing === true, listing?.catalogo],
    ['permalink', item?.permalink || null, listing?.permalink || null],
  ].map(([field, remote, local]) => ({
    field,
    local,
    remote,
    status: String(local) === String(remote) ? 'MATCH' : 'DIVERGENT',
  }));
  return { fields, material_drift: fields.some((row) => row.status === 'DIVERGENT') };
}

module.exports = {
  EXPECTED,
  attribute,
  buildListingPayload,
  buildLocalRemoteDiff,
  classifyLocalState,
  compareStableRemoteState,
  mapListingType,
  mapStatus,
  remoteCommercialHash,
  stableRemoteCommercialState,
  validateRemoteIdentity,
};
