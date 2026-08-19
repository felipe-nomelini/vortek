const {
  attributeValue,
  normalize,
  normalizeGtin,
} = require('./ml-p0-phase6a');

function buildManualAttributes(config, categoryAttributes, sku) {
  const allowed = new Set((categoryAttributes || []).map((row) => row.id));
  const attributes = (config.manualAttributes || []).filter((row) => allowed.has(row.id));
  const byId = new Map(attributes.map((row) => [row.id, row]));
  byId.set('ITEM_CONDITION', { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' });
  byId.set('SELLER_SKU', { id: 'SELLER_SKU', value_name: sku });
  return [...byId.values()];
}

function entityGtinValues(entity) {
  const attribute = (entity?.attributes || []).find((row) => row.id === 'GTIN');
  if (!attribute) return [];
  return [attribute.value_name, attribute.value_id, ...(attribute.values || []).flatMap((row) => [row.name, row.id])]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[;,]/))
    .map(normalizeGtin)
    .filter(Boolean);
}

function entityHasGtin(entity, expected) {
  const normalized = normalizeGtin(expected);
  return entityGtinValues(entity).includes(normalized);
}

function classifyRemoteIdentity(item, expected) {
  const actualSku = item?.seller_custom_field || attributeValue(item, 'SELLER_SKU');
  const fields = {
    seller: Number(item?.seller_id) === Number(expected.sellerId),
    sku: normalize(actualSku) === normalize(expected.sku),
    gtin: entityHasGtin(item, expected.gtin),
    brand: normalize(attributeValue(item, 'BRAND')) === normalize(expected.brand),
    model: !expected.modelAliases?.length || expected.modelAliases.some((value) => normalize(attributeValue(item, 'MODEL')).includes(normalize(value))),
    category: item?.category_id === expected.categoryId,
    quantity: Number(item?.available_quantity) === Number(expected.quantity),
    listing_type: item?.listing_type_id === expected.listingTypeId,
    condition: item?.condition === 'new',
  };
  if (expected.catalogProductId) {
    fields.catalog = item?.catalog_product_id === expected.catalogProductId;
    fields.catalog_listing = item?.catalog_listing === true;
  }
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
create temp table phase6b_result(result text, listing_id uuid, transaction_id bigint) on commit preserve rows;
do $phase6b$
declare v_product public.produtos%rowtype; v_existing public.anuncios_ml%rowtype; v_listing_id uuid; v_count integer; v_updated integer; v_existing_found boolean := false;
begin
  select * into v_product from public.produtos where id=${sqlLiteral(product.id)}::uuid for update;
  if not found or v_product.sku<>${sqlLiteral(product.sku)} or regexp_replace(coalesce(v_product.gtin,''),'^0+','')<>regexp_replace(${sqlLiteral(product.gtin)},'^0+','') then raise exception 'BLOCK_PERSISTENCE:local_identity'; end if;
  perform 1 from public.anuncios_ml where ml_item_id=${sqlLiteral(item.id)} or produto_id=${sqlLiteral(product.id)}::uuid or sku=${sqlLiteral(product.sku)} for update;
  select count(*) into v_count from public.produtos where id<>${sqlLiteral(product.id)}::uuid and ml_item_id=${sqlLiteral(item.id)};
  if v_count>0 then raise exception 'BLOCK_PERSISTENCE:other_product'; end if;
  select * into v_existing from public.anuncios_ml where ml_item_id=${sqlLiteral(item.id)};
  v_existing_found := found;
  if v_product.ml_item_id=${sqlLiteral(item.id)} and v_existing_found and v_existing.produto_id=${sqlLiteral(product.id)}::uuid and v_existing.sku=${sqlLiteral(product.sku)} then
    insert into phase6b_result values('SAFE_PUBLICATION_PERSIST_SUCCESS',v_existing.id,txid_current()); return;
  end if;
  if v_product.ml_item_id is not null or v_existing_found or v_product.ml_status<>'sem_anuncio'::public.ml_status then raise exception 'BLOCK_PERSISTENCE:concurrent_link'; end if;
  insert into public.anuncios_ml(ml_item_id,produto_id,sku,titulo,tipo,preco_ml,vendidos,visitas,status,catalogo,thumbnail,permalink)
  values(${sqlLiteral(item.id)},${sqlLiteral(product.id)}::uuid,${sqlLiteral(product.sku)},${sqlLiteral(item.title)},${sqlLiteral(listingType)},${Number(item.price).toFixed(2)},${Number(item.sold_quantity || 0)},0,${sqlLiteral(status)}::public.ml_status,${item.catalog_listing === true ? 'true' : 'false'},${sqlLiteral(item.pictures?.[0]?.secure_url || item.thumbnail || null)},${sqlLiteral(item.permalink || null)}) returning id into v_listing_id;
  update public.produtos set ml_item_id=${sqlLiteral(item.id)},ml_status=${sqlLiteral(status)}::public.ml_status where id=${sqlLiteral(product.id)}::uuid and ml_item_id is null and ml_status='sem_anuncio'::public.ml_status;
  get diagnostics v_updated=row_count; if v_updated<>1 then raise exception 'BLOCK_PERSISTENCE:conditional_update'; end if;
  insert into phase6b_result values('SAFE_PUBLICATION_PERSIST_SUCCESS',v_listing_id,txid_current());
end $phase6b$;
commit;
select row_to_json(r) from (select * from phase6b_result) r;`;
}

module.exports = {
  buildManualAttributes,
  buildPersistenceSql,
  classifyRemoteIdentity,
  entityGtinValues,
  entityHasGtin,
};
