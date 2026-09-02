begin;

set local lock_timeout = '5s';

create or replace function public.search_supplier_offers_paginated(
  p_page integer default 1,
  p_page_size integer default 100,
  p_search text default null,
  p_supplier_dslite_ids text[] default null,
  p_view text default 'operational',
  p_stock_status text default 'todos',
  p_preference text default 'todos',
  p_sort_by text default 'cost',
  p_sort_order text default 'asc'
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
  v_offset integer;
  v_view text := case
    when p_view in ('operational', 'alternatives', 'problems', 'historical', 'all') then p_view
    else 'operational'
  end;
  v_stock_status text := case
    when p_stock_status in ('todos', 'com_estoque', 'sem_estoque') then p_stock_status
    else 'todos'
  end;
  v_preference text := case
    when p_preference in ('todos', 'preferenciais', 'alternativas') then p_preference
    else 'todos'
  end;
  v_sort_by text := case
    when p_sort_by in ('sku', 'offer', 'product', 'supplier', 'stock', 'cost', 'status', 'last_sync') then p_sort_by
    else 'cost'
  end;
  v_sort_order text := case when p_sort_order = 'desc' then 'desc' else 'asc' end;
  v_result jsonb;
begin
  v_offset := (v_page - 1) * v_page_size;

  with base as (
    select
      offer.id as offer_id,
      product.id as product_id,
      product.sku as product_sku,
      product.nome as product_name,
      product.ativo as product_active,
      product.oferta_preferencial_id,
      product.fornecedor_preferencial_manual,
      product.dslite_fornecedor_id as preferred_supplier_dslite_id,
      product.dslite_produto_id as preferred_product_dslite_id,
      offer.nome as offer_name,
      coalesce(nullif(trim(offer.sku_oferta), ''), nullif(trim(offer.sku_fornecedor), ''), offer.dslite_produto_id) as supplier_sku,
      offer.dslite_fornecedor_id as supplier_dslite_id,
      coalesce(
        nullif(trim(supplier.apelido), ''),
        nullif(trim(offer.fornecedor_nome), ''),
        'Fornecedor DSLite ' || offer.dslite_fornecedor_id
      ) as supplier_name,
      coalesce(supplier.ativo, false) as supplier_active,
      offer.payment_mode,
      offer.estoque::integer as stock,
      offer.lead_time_dias as lead_time_days,
      offer.custo as cost,
      offer.ativo as offer_active,
      offer.last_sync_at,
      case
        when product.oferta_preferencial_id is not null then offer.id = product.oferta_preferencial_id
        else offer.dslite_fornecedor_id = product.dslite_fornecedor_id
          and offer.dslite_produto_id = product.dslite_produto_id
      end as preferred,
      case when product.fornecedor_preferencial_manual then 'manual' else 'automatic' end as preference_mode
    from public.produto_fornecedor_ofertas offer
    join public.produtos product on product.id = offer.produto_id
    left join public.fornecedores supplier on supplier.dslite_id = offer.dslite_fornecedor_id
  ),
  classified as (
    select
      base.*,
      case
        when not base.supplier_active or base.payment_mode = 'balance_account' then 'historical'
        when not base.offer_active then 'offer_inactive'
        when not base.product_active then 'product_inactive'
        when coalesce(base.cost, 0) <= 0 then 'invalid_cost'
        when coalesce(base.stock, 0) <= 0 then 'out_of_stock'
        else 'eligible'
      end as status
    from base
  ),
  enriched as (
    select
      classified.*,
      count(*) filter (where classified.status = 'eligible') over (partition by classified.product_id)::integer
        as eligible_offer_count,
      min(classified.cost) filter (where classified.status = 'eligible') over (partition by classified.product_id)
        as lowest_eligible_cost
    from classified
  ),
  common_filtered as (
    select
      enriched.*,
      case
        when enriched.lowest_eligible_cost is null then null
        else round((enriched.cost - enriched.lowest_eligible_cost)::numeric, 2)
      end as cost_delta_amount,
      case
        when coalesce(enriched.lowest_eligible_cost, 0) <= 0 then null
        else round(((enriched.cost - enriched.lowest_eligible_cost) / enriched.lowest_eligible_cost * 100)::numeric, 2)
      end as cost_delta_percent
    from enriched
    where (
      coalesce(nullif(trim(p_search), ''), '') = ''
      or position(lower(trim(p_search)) in lower(concat_ws(
        ' ', enriched.offer_name, enriched.supplier_sku, enriched.product_name,
        enriched.product_sku, enriched.supplier_name
      ))) > 0
    )
      and (
        coalesce(cardinality(p_supplier_dslite_ids), 0) = 0
        or enriched.supplier_dslite_id = any(p_supplier_dslite_ids)
      )
      and (v_stock_status <> 'com_estoque' or enriched.stock > 0)
      and (v_stock_status <> 'sem_estoque' or enriched.stock <= 0)
      and (v_preference <> 'preferenciais' or enriched.preferred)
      and (v_preference <> 'alternativas' or not enriched.preferred)
  ),
  view_filtered as (
    select *
    from common_filtered offer
    where
      (v_view = 'all')
      or (v_view = 'operational' and offer.status = 'eligible')
      or (v_view = 'alternatives' and offer.status = 'eligible' and not offer.preferred)
      or (v_view = 'problems' and offer.status not in ('eligible', 'historical'))
      or (v_view = 'historical' and offer.status = 'historical')
  ),
  ordered as (
    select
      offer.*,
      row_number() over (order by
        case when v_sort_by = 'sku' and v_sort_order = 'asc' then offer.supplier_sku end asc nulls last,
        case when v_sort_by = 'sku' and v_sort_order = 'desc' then offer.supplier_sku end desc nulls last,
        case when v_sort_by = 'offer' and v_sort_order = 'asc' then offer.offer_name end asc nulls last,
        case when v_sort_by = 'offer' and v_sort_order = 'desc' then offer.offer_name end desc nulls last,
        case when v_sort_by = 'product' and v_sort_order = 'asc' then offer.product_name end asc nulls last,
        case when v_sort_by = 'product' and v_sort_order = 'desc' then offer.product_name end desc nulls last,
        case when v_sort_by = 'supplier' and v_sort_order = 'asc' then offer.supplier_name end asc nulls last,
        case when v_sort_by = 'supplier' and v_sort_order = 'desc' then offer.supplier_name end desc nulls last,
        case when v_sort_by = 'stock' and v_sort_order = 'asc' then offer.stock end asc nulls last,
        case when v_sort_by = 'stock' and v_sort_order = 'desc' then offer.stock end desc nulls last,
        case when v_sort_by = 'cost' and v_sort_order = 'asc' then offer.cost end asc nulls last,
        case when v_sort_by = 'cost' and v_sort_order = 'desc' then offer.cost end desc nulls last,
        case when v_sort_by = 'status' and v_sort_order = 'asc' then offer.status end asc nulls last,
        case when v_sort_by = 'status' and v_sort_order = 'desc' then offer.status end desc nulls last,
        case when v_sort_by = 'last_sync' and v_sort_order = 'asc' then offer.last_sync_at end asc nulls last,
        case when v_sort_by = 'last_sync' and v_sort_order = 'desc' then offer.last_sync_at end desc nulls last,
        offer.offer_id asc
      ) as sort_position
    from view_filtered offer
  ),
  page_rows as (
    select * from ordered
    where sort_position > v_offset
      and sort_position <= v_offset + v_page_size
  ),
  supplier_options as (
    select distinct on (base.supplier_dslite_id)
      base.supplier_dslite_id,
      base.supplier_name,
      base.supplier_active
    from base
    order by base.supplier_dslite_id, base.supplier_name
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(jsonb_build_object(
        'offerId', row.offer_id,
        'productId', row.product_id,
        'productSku', row.product_sku,
        'productName', row.product_name,
        'offerName', row.offer_name,
        'supplierSku', row.supplier_sku,
        'supplierDsliteId', row.supplier_dslite_id,
        'supplierName', row.supplier_name,
        'paymentMode', row.payment_mode,
        'stock', row.stock,
        'leadTimeDays', row.lead_time_days,
        'cost', row.cost,
        'lowestEligibleCost', row.lowest_eligible_cost,
        'costDeltaAmount', row.cost_delta_amount,
        'costDeltaPercent', row.cost_delta_percent,
        'status', row.status,
        'preferred', row.preferred,
        'preferenceMode', row.preference_mode,
        'eligibleOfferCount', row.eligible_offer_count,
        'lastSyncAt', row.last_sync_at
      ) order by row.sort_position)
      from page_rows row
    ), '[]'::jsonb),
    'total', (select count(*) from view_filtered),
    'page', v_page,
    'pageSize', v_page_size,
    'metrics', jsonb_build_object(
      'totalLinked', (select count(*) from common_filtered),
      'eligible', (select count(*) from common_filtered where status = 'eligible'),
      'problems', (select count(*) from common_filtered where status not in ('eligible', 'historical')),
      'historical', (select count(*) from common_filtered where status = 'historical'),
      'productsWithAlternatives', (
        select count(distinct product_id) from common_filtered where eligible_offer_count > 1
      )
    ),
    'queueCounts', jsonb_build_object(
      'operational', (select count(*) from common_filtered where status = 'eligible'),
      'alternatives', (select count(*) from common_filtered where status = 'eligible' and not preferred),
      'problems', (select count(*) from common_filtered where status not in ('eligible', 'historical')),
      'historical', (select count(*) from common_filtered where status = 'historical'),
      'all', (select count(*) from common_filtered)
    ),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', option.supplier_dslite_id,
        'dsliteId', option.supplier_dslite_id,
        'label', option.supplier_name,
        'active', option.supplier_active
      ) order by option.supplier_name)
      from supplier_options option
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.search_supplier_offers_paginated(integer, integer, text, text[], text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.search_supplier_offers_paginated(integer, integer, text, text[], text, text, text, text, text)
  to service_role;

comment on function public.search_supplier_offers_paginated(integer, integer, text, text[], text, text, text, text, text) is
  'BNT-D09: lista paginada de ofertas externas com elegibilidade, preferência e comparação por produto.';

commit;
