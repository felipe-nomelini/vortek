const { EXPECTED, mapListingType, mapStatus } = require('./ml-p0-phase5d');

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildTransactionSql(item) {
  const price = Number(item.price).toFixed(2);
  const catalog = item.catalog_listing === true ? 'true' : 'false';
  return `
\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('ml-p0:${EXPECTED.sku}', 0));
create temp table phase5d1_result (
  result text not null,
  listing_id uuid,
  product_ml_item_id text,
  transaction_id bigint
) on commit preserve rows;

do $phase5d1$
declare
  v_product public.produtos%rowtype;
  v_existing public.anuncios_ml%rowtype;
  v_listing_id uuid;
  v_conflicts integer;
  v_updated integer;
begin
  select * into v_product
  from public.produtos
  where id = '${EXPECTED.productId}'::uuid
  for update;

  if not found or v_product.sku <> '${EXPECTED.sku}' or coalesce(v_product.gtin, '') <> '${EXPECTED.gtin}' then
    raise exception 'LOCAL_PERSIST_ABORT_IDENTITY_DRIFT:local_product';
  end if;

  perform 1 from public.anuncios_ml
  where ml_item_id = '${EXPECTED.itemId}'
     or produto_id = '${EXPECTED.productId}'::uuid
     or sku = '${EXPECTED.sku}'
  for update;

  select count(*) into v_conflicts
  from public.produtos
  where id <> '${EXPECTED.productId}'::uuid and ml_item_id = '${EXPECTED.itemId}';
  if v_conflicts > 0 then raise exception 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK:other_product'; end if;

  select count(*) into v_conflicts
  from public.anuncios_ml
  where (produto_id = '${EXPECTED.productId}'::uuid or sku = '${EXPECTED.sku}')
    and ml_item_id <> '${EXPECTED.itemId}';
  if v_conflicts > 0 then raise exception 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK:other_listing'; end if;

  select * into v_existing from public.anuncios_ml where ml_item_id = '${EXPECTED.itemId}';
  if v_product.ml_item_id = '${EXPECTED.itemId}'
     and found
     and v_existing.produto_id = '${EXPECTED.productId}'::uuid
     and v_existing.sku = '${EXPECTED.sku}' then
    insert into phase5d1_result values ('LOCAL_PERSIST_ALREADY_CONSISTENT', v_existing.id, v_product.ml_item_id, txid_current());
    return;
  end if;

  if v_product.ml_item_id is not null or found or v_product.ml_status <> 'sem_anuncio'::public.ml_status then
    raise exception 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK:partial_or_existing_link';
  end if;

  insert into public.anuncios_ml (
    ml_item_id, produto_id, sku, titulo, tipo, preco_ml, vendidos, visitas,
    status, catalogo, thumbnail, permalink
  ) values (
    '${EXPECTED.itemId}', '${EXPECTED.productId}'::uuid, '${EXPECTED.sku}', ${sqlLiteral(item.title)},
    ${sqlLiteral(mapListingType(item.listing_type_id))}, ${price}, ${Number(item.sold_quantity || 0)}, 0,
    ${sqlLiteral(mapStatus(item.status))}::public.ml_status, ${catalog},
    ${sqlLiteral(item.pictures?.[0]?.secure_url || item.thumbnail || null)}, ${sqlLiteral(item.permalink || null)}
  ) returning id into v_listing_id;

  update public.produtos
  set ml_item_id = '${EXPECTED.itemId}', ml_status = 'ativo'::public.ml_status
  where id = '${EXPECTED.productId}'::uuid
    and sku = '${EXPECTED.sku}'
    and ml_item_id is null
    and ml_status = 'sem_anuncio'::public.ml_status;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'LOCAL_PERSIST_TRANSACTION_FAILED:conditional_update'; end if;

  insert into phase5d1_result values ('SAFE_PUBLICATION_PERSIST_SUCCESS', v_listing_id, '${EXPECTED.itemId}', txid_current());
end
$phase5d1$;
commit;

select row_to_json(r) from (
  select result, listing_id, product_ml_item_id, transaction_id, true as committed
  from phase5d1_result
) r;`;
}

function localReadbackSql() {
  return `
select json_build_object(
  'read_at', clock_timestamp(),
  'product', (select row_to_json(p) from (
    select id,sku,nome,gtin,ml_item_id,ml_status,estoque,custo,altura,largura,profundidade,peso_bruto,updated_at
    from public.produtos where id='${EXPECTED.productId}'::uuid
  ) p),
  'item_listings', coalesce((select json_agg(row_to_json(a) order by a.created_at) from (
    select id,ml_item_id,produto_id,sku,titulo,tipo,preco_ml,vendidos,visitas,qualidade,qualidade_info,status,catalogo,thumbnail,permalink,created_at,updated_at
    from public.anuncios_ml where ml_item_id='${EXPECTED.itemId}' order by created_at
  ) a),'[]'::json),
  'product_listings', coalesce((select json_agg(row_to_json(a) order by a.created_at) from (
    select id,ml_item_id,produto_id,sku,titulo,preco_ml,status,catalogo,created_at
    from public.anuncios_ml where produto_id='${EXPECTED.productId}'::uuid or sku='${EXPECTED.sku}' order by created_at
  ) a),'[]'::json),
  'products_pointing_to_item', coalesce((select json_agg(row_to_json(p)) from (
    select id,sku,ml_item_id,ml_status from public.produtos where ml_item_id='${EXPECTED.itemId}'
  ) p),'[]'::json)
);`;
}

function compareLocalRemote(local, item) {
  const listing = local.item_listings?.[0] || null;
  const fields = [
    ['ml_item_id', EXPECTED.itemId, local.product?.ml_item_id],
    ['SKU', EXPECTED.sku, listing?.sku],
    ['produto_id', EXPECTED.productId, listing?.produto_id],
    ['title', item?.title, listing?.titulo],
    ['price', Number(item?.price), Number(listing?.preco_ml)],
    ['status', mapStatus(item?.status), listing?.status],
    ['listing_type', mapListingType(item?.listing_type_id), listing?.tipo],
    ['catalogo', item?.catalog_listing === true, listing?.catalogo],
    ['permalink', item?.permalink || null, listing?.permalink || null],
  ].map(([field, remote, localValue]) => ({
    field,
    local: localValue,
    remote,
    status: String(localValue) === String(remote) ? 'MATCH' : 'DIVERGENT',
  }));
  const uniqueness = {
    product_links: local.products_pointing_to_item?.length || 0,
    item_listings: local.item_listings?.length || 0,
    product_listings: local.product_listings?.length || 0,
  };
  const unique = Object.values(uniqueness).every((count) => count === 1);
  return { fields, uniqueness, unique, material_drift: !unique || fields.some((row) => row.status === 'DIVERGENT') };
}

module.exports = { buildTransactionSql, compareLocalRemote, localReadbackSql, sqlLiteral };
