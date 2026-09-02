begin;

set local lock_timeout = '5s';

create or replace function public.search_ml_listings_paginated(
  p_tax_rate numeric,
  p_page integer default 1,
  p_page_size integer default 100,
  p_search text default null,
  p_focus text default 'all',
  p_quality text default 'all',
  p_catalog text default 'all',
  p_profitability text default 'all',
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_sort_by text default 'title',
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
  v_focus text := case
    when p_focus in ('all', 'active', 'paused', 'quality_risk', 'price_review') then p_focus
    else 'all'
  end;
  v_quality text := case
    when p_quality in ('all', 'risk', 'good', 'perfect', 'unavailable') then p_quality
    else 'all'
  end;
  v_catalog text := case
    when p_catalog in ('all', 'standard', 'catalog', 'winning', 'competing', 'losing') then p_catalog
    else 'all'
  end;
  v_profitability text := case
    when p_profitability in ('all', 'positive', 'negative', 'unknown') then p_profitability
    else 'all'
  end;
  v_sort_by text := case
    when p_sort_by in ('item', 'product', 'price', 'profit', 'sold', 'visits', 'quality', 'status', 'catalog') then p_sort_by
    else 'product'
  end;
  v_sort_order text := case when p_sort_order = 'desc' then 'desc' else 'asc' end;
  v_result jsonb;
begin
  if p_tax_rate is null or p_tax_rate < 0.04 or p_tax_rate >= 1 then
    raise exception 'p_tax_rate inválida para precificação';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with base as (
    select
      listing.ml_item_id as item_id,
      listing.produto_id as product_id,
      coalesce(nullif(trim(product.sku), ''), nullif(trim(listing.sku), '')) as product_sku,
      coalesce(nullif(trim(product.nome), ''), nullif(trim(listing.titulo), ''), listing.ml_item_id) as product_name,
      listing.titulo as listing_title,
      coalesce(listing.thumbnail, snapshot.thumbnail, product.imagens[1]) as thumbnail,
      coalesce(listing.permalink, snapshot.permalink) as permalink,
      listing.tipo as listing_type,
      coalesce(snapshot.catalog_listing, listing.catalogo, false) as catalog_listing,
      snapshot.catalog_product_id,
      snapshot.related_item_id,
      listing.preco_ml::numeric as price,
      product.custo::numeric as cost,
      coalesce(product.ml_shipping, 0)::numeric as shipping,
      coalesce(product.ml_fee, 0)::numeric as ml_fee,
      listing.vendidos::integer as sold,
      listing.visitas::integer as visits,
      listing.qualidade::numeric as quality_score,
      case
        when listing.qualidade_info ->> 'source' = 'mercado_livre_performance' then true
        else false
      end as quality_available,
      case
        when listing.qualidade_info ->> 'source' = 'mercado_livre_performance' then
          coalesce(
            nullif(trim(listing.qualidade_info ->> 'dica'), ''),
            (
              select nullif(trim(issue ->> 'nome'), '')
              from jsonb_array_elements(coalesce(listing.qualidade_info -> 'itens', '[]'::jsonb)) issue
              where coalesce((issue ->> 'ok')::boolean, false) = false
              order by coalesce((issue ->> 'pontos')::numeric, 0) asc
              limit 1
            )
          )
        else null
      end as quality_primary_issue,
      listing.qualidade_info as quality_info,
      lower(coalesce(
        nullif(trim(snapshot.status), ''),
        case listing.status::text when 'ativo' then 'active' when 'pausado' then 'paused' else listing.status::text end
      )) as observed_status,
      listing.status::text as local_status,
      listing.ml_sync_block_reason,
      listing.ml_sync_blocked_until,
      listing.ml_sync_last_error,
      snapshot.buy_box_status,
      snapshot.buy_box_winning,
      snapshot.price_to_win::numeric,
      snapshot.synced_at as catalog_synced_at,
      listing.updated_at as listing_synced_at,
      listing.ml_item_id = product.ml_item_id as is_operational,
      latest_outbox.id as outbox_id,
      latest_outbox.status as outbox_status,
      latest_outbox.desired_status::text as outbox_desired_status,
      latest_outbox.desired_price::numeric as outbox_desired_price,
      latest_outbox.last_error as outbox_error,
      latest_outbox.created_at as outbox_created_at
    from public.anuncios_ml listing
    left join public.produtos product on product.id = listing.produto_id
    left join public.catalogo_ml_snapshot snapshot on snapshot.ml_item_id = listing.ml_item_id
    left join lateral (
      select outbox.id, outbox.status, outbox.desired_status, outbox.desired_price,
        outbox.last_error, outbox.created_at
      from public.anuncios_ml_outbox outbox
      where outbox.ml_item_id = listing.ml_item_id
      order by outbox.created_at desc
      limit 1
    ) latest_outbox on true
  ),
  computed as (
    select
      base.*,
      case
        when base.price <= 0 or base.cost is null then null
        else round((base.price - base.cost - base.shipping - (base.price * p_tax_rate) - (base.price * base.ml_fee))::numeric, 2)
      end as profit,
      case
        when base.price <= 0 or base.cost is null then null
        else round(((base.price - base.cost - base.shipping - (base.price * p_tax_rate) - (base.price * base.ml_fee)) / base.price * 100)::numeric, 2)
      end as margin_percent,
      case
        when not base.catalog_listing then 'sem_catalogo'
        when coalesce(base.buy_box_winning, false)
          or lower(coalesce(base.buy_box_status, '')) in ('winning', 'sharing_first_place') then 'ganhando'
        when lower(coalesce(base.buy_box_status, '')) = 'competing' then 'competindo'
        else 'perdendo'
      end as catalog_status,
      base.catalog_listing
        and not (
          coalesce(base.buy_box_winning, false)
          or lower(coalesce(base.buy_box_status, '')) in ('winning', 'sharing_first_place')
        )
        and coalesce(base.price_to_win, 0) > 0 as price_review
    from base
  ),
  common_filtered as (
    select *
    from computed listing
    where (
      coalesce(nullif(trim(p_search), ''), '') = ''
      or position(lower(trim(p_search)) in lower(concat_ws(
        ' ', listing.item_id, listing.product_sku, listing.product_name, listing.listing_title
      ))) > 0
    )
      and (p_price_min is null or listing.price >= p_price_min)
      and (p_price_max is null or listing.price <= p_price_max)
      and (
        v_quality = 'all'
        or (v_quality = 'risk' and listing.quality_available and listing.quality_score < 80)
        or (v_quality = 'good' and listing.quality_available and listing.quality_score >= 80 and listing.quality_score < 100)
        or (v_quality = 'perfect' and listing.quality_available and listing.quality_score >= 100)
        or (v_quality = 'unavailable' and not listing.quality_available)
      )
      and (
        v_catalog = 'all'
        or (v_catalog = 'standard' and not listing.catalog_listing)
        or (v_catalog = 'catalog' and listing.catalog_listing)
        or (v_catalog = 'winning' and listing.catalog_status = 'ganhando')
        or (v_catalog = 'competing' and listing.catalog_status = 'competindo')
        or (v_catalog = 'losing' and listing.catalog_status = 'perdendo')
      )
      and (
        v_profitability = 'all'
        or (v_profitability = 'positive' and listing.profit >= 0)
        or (v_profitability = 'negative' and listing.profit < 0)
        or (v_profitability = 'unknown' and listing.profit is null)
      )
  ),
  focus_filtered as (
    select *
    from common_filtered listing
    where v_focus = 'all'
      or (v_focus = 'active' and listing.observed_status = 'active')
      or (v_focus = 'paused' and listing.observed_status = 'paused')
      or (v_focus = 'quality_risk' and listing.quality_available and listing.quality_score < 80)
      or (v_focus = 'price_review' and listing.price_review)
  ),
  ordered as (
    select listing.*,
      row_number() over (order by
        case when v_sort_by = 'item' and v_sort_order = 'asc' then listing.item_id end asc nulls last,
        case when v_sort_by = 'item' and v_sort_order = 'desc' then listing.item_id end desc nulls last,
        case when v_sort_by = 'product' and v_sort_order = 'asc' then listing.product_name end asc nulls last,
        case when v_sort_by = 'product' and v_sort_order = 'desc' then listing.product_name end desc nulls last,
        case when v_sort_by = 'price' and v_sort_order = 'asc' then listing.price end asc nulls last,
        case when v_sort_by = 'price' and v_sort_order = 'desc' then listing.price end desc nulls last,
        case when v_sort_by = 'profit' and v_sort_order = 'asc' then listing.profit end asc nulls last,
        case when v_sort_by = 'profit' and v_sort_order = 'desc' then listing.profit end desc nulls last,
        case when v_sort_by = 'sold' and v_sort_order = 'asc' then listing.sold end asc nulls last,
        case when v_sort_by = 'sold' and v_sort_order = 'desc' then listing.sold end desc nulls last,
        case when v_sort_by = 'visits' and v_sort_order = 'asc' then listing.visits end asc nulls last,
        case when v_sort_by = 'visits' and v_sort_order = 'desc' then listing.visits end desc nulls last,
        case when v_sort_by = 'quality' and v_sort_order = 'asc' then listing.quality_score end asc nulls last,
        case when v_sort_by = 'quality' and v_sort_order = 'desc' then listing.quality_score end desc nulls last,
        case when v_sort_by = 'status' and v_sort_order = 'asc' then listing.observed_status end asc nulls last,
        case when v_sort_by = 'status' and v_sort_order = 'desc' then listing.observed_status end desc nulls last,
        case when v_sort_by = 'catalog' and v_sort_order = 'asc' then listing.catalog_status end asc nulls last,
        case when v_sort_by = 'catalog' and v_sort_order = 'desc' then listing.catalog_status end desc nulls last,
        listing.item_id asc
      ) as sort_position
    from focus_filtered listing
  ),
  page_rows as (
    select * from ordered
    where sort_position > v_offset and sort_position <= v_offset + v_page_size
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemId', row.item_id,
        'productId', row.product_id,
        'productSku', row.product_sku,
        'productName', row.product_name,
        'listingTitle', row.listing_title,
        'thumbnail', row.thumbnail,
        'permalink', row.permalink,
        'listingType', case when row.catalog_listing then 'catalog' else 'standard' end,
        'catalogProductId', row.catalog_product_id,
        'relatedItemId', row.related_item_id,
        'price', row.price,
        'profit', row.profit,
        'marginPercent', row.margin_percent,
        'sold', row.sold,
        'visits', row.visits,
        'qualityScore', row.quality_score,
        'qualityAvailable', row.quality_available,
        'qualityPrimaryIssue', row.quality_primary_issue,
        'qualityInfo', row.quality_info,
        'observedStatus', row.observed_status,
        'localStatus', row.local_status,
        'blockReason', row.ml_sync_block_reason,
        'blockedUntil', row.ml_sync_blocked_until,
        'lastError', row.ml_sync_last_error,
        'catalogStatus', row.catalog_status,
        'priceToWin', row.price_to_win,
        'catalogSyncedAt', row.catalog_synced_at,
        'listingSyncedAt', row.listing_synced_at,
        'isOperational', row.is_operational,
        'latestPublish', case when row.outbox_id is null then null else jsonb_build_object(
          'id', row.outbox_id,
          'status', row.outbox_status,
          'desiredStatus', row.outbox_desired_status,
          'desiredPrice', row.outbox_desired_price,
          'error', row.outbox_error,
          'createdAt', row.outbox_created_at
        ) end
      ) order by row.sort_position)
      from page_rows row
    ), '[]'::jsonb),
    'total', (select count(*) from focus_filtered),
    'page', v_page,
    'pageSize', v_page_size,
    'metrics', jsonb_build_object(
      'total', (select count(*) from common_filtered),
      'active', (select count(*) from common_filtered where observed_status = 'active'),
      'paused', (select count(*) from common_filtered where observed_status = 'paused'),
      'qualityRisk', (select count(*) from common_filtered where quality_available and quality_score < 80),
      'priceReview', (select count(*) from common_filtered where price_review)
    ),
    'queueCounts', jsonb_build_object(
      'all', (select count(*) from common_filtered),
      'active', (select count(*) from common_filtered where observed_status = 'active'),
      'paused', (select count(*) from common_filtered where observed_status = 'paused'),
      'qualityRisk', (select count(*) from common_filtered where quality_available and quality_score < 80),
      'priceReview', (select count(*) from common_filtered where price_review)
    ),
    'lastSyncedAt', (select max(greatest(listing_synced_at, coalesce(catalog_synced_at, listing_synced_at))) from common_filtered)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.search_ml_listings_paginated(numeric, integer, integer, text, text, text, text, text, numeric, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.search_ml_listings_paginated(numeric, integer, integer, text, text, text, text, text, numeric, numeric, text, text)
  to service_role;

comment on function public.search_ml_listings_paginated(numeric, integer, integer, text, text, text, text, text, numeric, numeric, text, text) is
  'BNT-D11: central operacional paginada de anúncios ML, qualidade, rentabilidade, publicação e catálogo.';

commit;
