const crypto = require('crypto');

const TAX_RATE = 0.05;
const TARGET_MARGIN = 0.5;
const SAFETY_MARGIN = 0.505;

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeGtin(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

function attributeValue(entity, id) {
  const attribute = (entity?.attributes || []).find((row) => String(row.id) === String(id));
  if (!attribute) return null;
  if (attribute.value_name != null) return attribute.value_name;
  if (attribute.value_id != null) return attribute.value_id;
  return (attribute.values || []).map((row) => row.name).filter(Boolean).join(', ') || null;
}

function canonicalHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function financialAt({ price, commission, shipping, cost, taxRate = TAX_RATE }) {
  const normalizedPrice = roundMoney(price);
  const values = {
    price: normalizedPrice,
    commission: roundMoney(commission),
    shipping: roundMoney(shipping),
    cost: roundMoney(cost),
    tax: roundMoney(normalizedPrice * taxRate),
  };
  values.profit = roundMoney(values.price - values.commission - values.shipping - values.cost - values.tax);
  values.margin_percent = values.price > 0 ? Math.round((values.profit / values.price * 100) * 1e6) / 1e6 : 0;
  return values;
}

function nextProtectivePrice({ cost, shipping, commission, currentPrice, taxRate = TAX_RATE, safetyMargin = SAFETY_MARGIN }) {
  const effectiveFeeRate = Number(currentPrice) > 0 ? Number(commission) / Number(currentPrice) : 0.2;
  const denominator = 1 - effectiveFeeRate - taxRate - safetyMargin;
  if (!(denominator > 0.01)) throw new Error('protective_price_denominator_invalid');
  const mathematical = (Number(cost) + Number(shipping)) / denominator;
  const roundedTen = Math.ceil((mathematical + 0.1) / 10) * 10 - 0.1;
  return roundMoney(Math.max(roundedTen, Number(currentPrice)));
}

function extractShippingCost(data) {
  const values = [
    data?.senders?.[0]?.cost,
    data?.coverage?.all_country?.list_cost,
    data?.options?.[0]?.cost,
  ].map(Number).filter(Number.isFinite);
  return values[0] ?? null;
}

function mapCatalogAttribute(attribute) {
  const values = (attribute.values || []).filter((row) => row?.id || row?.name);
  if (values.length > 1) {
    return { id: attribute.id, values: values.map((row) => ({ ...(row.id ? { id: row.id } : {}), ...(row.name ? { name: row.name } : {}) })) };
  }
  return {
    id: attribute.id,
    ...(attribute.value_id ? { value_id: attribute.value_id } : {}),
    ...(attribute.value_name ? { value_name: attribute.value_name } : {}),
  };
}

function buildCatalogAttributes(catalogResult, categoryAttributes, sku) {
  const allowed = new Set((categoryAttributes || []).map((row) => row.id));
  const attributes = (catalogResult?.attributes || [])
    .filter((row) => allowed.has(row.id) && (row.value_id || row.value_name || row.values?.length))
    .map(mapCatalogAttribute);
  const byId = new Map(attributes.map((row) => [row.id, row]));
  byId.set('ITEM_CONDITION', { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' });
  byId.set('SELLER_SKU', { id: 'SELLER_SKU', value_name: sku });
  return [...byId.values()];
}

function requiredAttributeIds(categoryAttributes) {
  return (categoryAttributes || []).filter((row) => row.tags?.required || row.tags?.new_required || row.tags?.catalog_required || row.tags?.catalog_listing_required).map((row) => row.id);
}

function missingRequiredAttributes(attributes, requiredIds) {
  const sent = new Set((attributes || []).map((row) => row.id));
  return requiredIds.filter((id) => !sent.has(id));
}

function classifyRemoteIdentity(item, expected) {
  const actualSku = item?.seller_custom_field || attributeValue(item, 'SELLER_SKU');
  const fields = {
    seller: Number(item?.seller_id) === Number(expected.sellerId),
    sku: normalize(actualSku) === normalize(expected.sku),
    gtin: normalizeGtin(attributeValue(item, 'GTIN')) === normalizeGtin(expected.gtin),
    brand: normalize(attributeValue(item, 'BRAND')) === normalize(expected.brand),
    model: !expected.modelAliases?.length || expected.modelAliases.some((value) => normalize(attributeValue(item, 'MODEL')).includes(normalize(value))),
    category: item?.category_id === expected.categoryId,
    catalog: item?.catalog_product_id === expected.catalogProductId,
    catalog_listing: item?.catalog_listing === true,
    quantity: Number(item?.available_quantity) === Number(expected.quantity),
    listing_type: item?.listing_type_id === expected.listingTypeId,
    condition: item?.condition === 'new',
  };
  const critical = {};
  for (const [id, aliases] of Object.entries(expected.critical || {})) {
    critical[id] = aliases.some((value) => normalize(attributeValue(item, id)) === normalize(value));
  }
  return { fields, critical, passed: [...Object.values(fields), ...Object.values(critical)].every(Boolean) };
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildPersistenceSql({ product, item }) {
  const listingType = item.listing_type_id === 'gold_pro' || item.listing_type_id === 'gold_premium' ? 'premium' : 'classico';
  const status = item.status === 'active' ? 'ativo' : 'pausado';
  return `
\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('ml-p0:${product.sku}', 0));
create temp table phase6a_result(result text, listing_id uuid, transaction_id bigint) on commit preserve rows;
do $phase6a$
declare v_product public.produtos%rowtype; v_existing public.anuncios_ml%rowtype; v_listing_id uuid; v_count integer; v_updated integer;
begin
  select * into v_product from public.produtos where id=${sqlLiteral(product.id)}::uuid for update;
  if not found or v_product.sku<>${sqlLiteral(product.sku)} or regexp_replace(coalesce(v_product.gtin,''),'^0+','')<>regexp_replace(${sqlLiteral(product.gtin)},'^0+','') then raise exception 'BLOCK_PERSISTENCE:local_identity'; end if;
  perform 1 from public.anuncios_ml where ml_item_id=${sqlLiteral(item.id)} or produto_id=${sqlLiteral(product.id)}::uuid or sku=${sqlLiteral(product.sku)} for update;
  select count(*) into v_count from public.produtos where id<>${sqlLiteral(product.id)}::uuid and ml_item_id=${sqlLiteral(item.id)};
  if v_count>0 then raise exception 'BLOCK_PERSISTENCE:other_product'; end if;
  select * into v_existing from public.anuncios_ml where ml_item_id=${sqlLiteral(item.id)};
  if v_product.ml_item_id=${sqlLiteral(item.id)} and found and v_existing.produto_id=${sqlLiteral(product.id)}::uuid and v_existing.sku=${sqlLiteral(product.sku)} then
    insert into phase6a_result values('SAFE_PUBLICATION_PERSIST_SUCCESS',v_existing.id,txid_current()); return;
  end if;
  if v_product.ml_item_id is not null or found or v_product.ml_status<>'sem_anuncio'::public.ml_status then raise exception 'BLOCK_PERSISTENCE:concurrent_link'; end if;
  insert into public.anuncios_ml(ml_item_id,produto_id,sku,titulo,tipo,preco_ml,vendidos,visitas,status,catalogo,thumbnail,permalink)
  values(${sqlLiteral(item.id)},${sqlLiteral(product.id)}::uuid,${sqlLiteral(product.sku)},${sqlLiteral(item.title)},${sqlLiteral(listingType)},${Number(item.price).toFixed(2)},${Number(item.sold_quantity||0)},0,${sqlLiteral(status)}::public.ml_status,${item.catalog_listing===true?'true':'false'},${sqlLiteral(item.pictures?.[0]?.secure_url||item.thumbnail||null)},${sqlLiteral(item.permalink||null)}) returning id into v_listing_id;
  update public.produtos set ml_item_id=${sqlLiteral(item.id)},ml_status=${sqlLiteral(status)}::public.ml_status where id=${sqlLiteral(product.id)}::uuid and ml_item_id is null and ml_status='sem_anuncio'::public.ml_status;
  get diagnostics v_updated=row_count; if v_updated<>1 then raise exception 'BLOCK_PERSISTENCE:conditional_update'; end if;
  insert into phase6a_result values('SAFE_PUBLICATION_PERSIST_SUCCESS',v_listing_id,txid_current());
end $phase6a$;
commit;
select row_to_json(r) from (select * from phase6a_result) r;`;
}

module.exports = {
  SAFETY_MARGIN,
  TARGET_MARGIN,
  TAX_RATE,
  attributeValue,
  buildCatalogAttributes,
  buildPersistenceSql,
  canonicalHash,
  classifyRemoteIdentity,
  extractShippingCost,
  financialAt,
  missingRequiredAttributes,
  nextProtectivePrice,
  normalize,
  normalizeGtin,
  requiredAttributeIds,
  roundMoney,
  sqlLiteral,
};
