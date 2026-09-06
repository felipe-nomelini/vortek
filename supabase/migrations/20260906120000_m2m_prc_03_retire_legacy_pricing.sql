-- M2M-PRC-03: banco fornece dados; somente pricing-economy calcula economia.
-- DEV exclusivamente: ensaiar com ROLLBACK antes da aplicação.
-- Histórico de faixas preservado, sem autoridade decisória.
drop function public.search_produtos_paginated(numeric,text,text[],boolean,text,text,text,numeric,numeric,text,integer,integer,text,text);
drop function public.search_produtos_resumo(numeric,text,text[],boolean,text,text,text,numeric,numeric,text);
drop function public.save_commercial_pricing_configuration(numeric,numeric,numeric,jsonb,jsonb);

CREATE OR REPLACE FUNCTION public.search_produtos_paginated(p_search text DEFAULT NULL::text, p_supplier_dslite_ids text[] DEFAULT NULL::text[], p_include_internal boolean DEFAULT false, p_product_active_status text DEFAULT 'ativo'::text, p_ml_status text DEFAULT NULL::text, p_estoque text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 100, p_sort_by text DEFAULT 'sku'::text, p_sort_order text DEFAULT 'asc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
  v_offset integer := 0;
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_sort_by text := coalesce(nullif(trim(p_sort_by), ''), 'sku');
  v_sort_order text := case when lower(coalesce(p_sort_order, '')) = 'desc' then 'desc' else 'asc' end;
  v_active_status text := case
    when p_product_active_status in ('ativo', 'inativo', 'todos') then p_product_active_status
    else 'ativo'
  end;
begin
  if v_sort_by not in (
    'sku', 'nome', 'fornecedor', 'estoque', 'ml_status'
  ) then
    v_sort_by := 'sku';
    v_sort_order := 'asc';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with internal_balances as (
    select
      movimento.produto_id,
      greatest(sum(
        case
          when movimento.tipo = 'entrada_devolucao'
            and movimento.situacao_estoque = 'liberado'
          then movimento.quantidade
          when movimento.tipo = 'saida_envio_interno'
            and movimento.estornada_em is null
          then -movimento.quantidade
          else 0
        end
      ), 0)::integer as saldo_interno
    from public.estoque_interno_movimentacoes movimento
    group by movimento.produto_id
  ),
  listing_ranked as (
    select
      snapshot.produto_id,
      snapshot.ml_item_id,
      lower(coalesce(snapshot.status, '')) as status,
      row_number() over (
        partition by snapshot.produto_id
        order by
          case lower(coalesce(snapshot.status, ''))
            when 'active' then 0
            when 'paused' then 2
            else 4
          end + case when snapshot.catalog_listing then 1 else 0 end,
          snapshot.synced_at desc,
          snapshot.ml_item_id
      ) as listing_rank
    from public.catalogo_ml_snapshot snapshot
    where snapshot.produto_id is not null
  ),
  operational_listings as (
    select produto_id, ml_item_id, status
    from listing_ranked
    where listing_rank = 1
  ),
  base as (
    select
      produto.*,
      coalesce(internal.saldo_interno, 0) as saldo_interno,
      greatest(coalesce(produto.estoque, 0), coalesce(internal.saldo_interno, 0)) as estoque_operacional,
      case
        when coalesce(internal.saldo_interno, 0) > 0 then 'Estoque Interno'
        else produto.fornecedor
      end as fornecedor_operacional,
      coalesce(listing.ml_item_id, produto.ml_item_id) as ml_item_id_operacional,
      case
        when listing.status = 'active' then 'ativo'
        when listing.ml_item_id is not null then 'pausado'
        else produto.ml_status::text
      end as ml_status_operacional,
      null::numeric as display_price
    from public.produtos produto
    left join internal_balances internal on internal.produto_id = produto.id
    left join operational_listings listing on listing.produto_id = produto.id
  ),
  filtered as (
    select *
    from base produto
    where (
      coalesce(nullif(trim(p_search), ''), '') = ''
      or coalesce(produto.fornecedor_operacional, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(produto.nome, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(produto.sku, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(produto.gtin, '') ilike ('%' || trim(p_search) || '%')
      or exists (
        select 1
        from public.produto_fornecedor_ofertas oferta
        where oferta.produto_id = produto.id
          and (
            coalesce(oferta.fornecedor_nome, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(oferta.sku_oferta, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(oferta.sku_fornecedor, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(oferta.nome, '') ilike ('%' || trim(p_search) || '%')
          )
      )
    )
      and (
        (
          coalesce(array_length(p_supplier_dslite_ids, 1), 0) = 0
          and not coalesce(p_include_internal, false)
        )
        or coalesce(produto.dslite_fornecedor_id, '') = any(p_supplier_dslite_ids)
        or exists (
          select 1
          from public.produto_fornecedor_ofertas oferta
          where oferta.produto_id = produto.id
            and oferta.dslite_fornecedor_id = any(p_supplier_dslite_ids)
        )
        or (
          coalesce(p_include_internal, false)
          and produto.saldo_interno > 0
        )
      )
      and (v_active_status <> 'ativo' or produto.ativo is not false)
      and (v_active_status <> 'inativo' or produto.ativo is false)
      and (
        coalesce(nullif(trim(p_ml_status), ''), '') = ''
        or produto.ml_status_operacional = p_ml_status
      )
      and (
        coalesce(nullif(trim(p_estoque), ''), '') <> 'com_estoque'
        or produto.estoque_operacional > 0
      )
      and (
        coalesce(nullif(trim(p_estoque), ''), '') <> 'sem_estoque'
        or produto.estoque_operacional = 0
      )
  ),
  page_rows as (
    select *
    from filtered produto
    order by
      case when v_sort_by = 'sku' and v_sort_order = 'asc' then produto.sku end asc nulls last,
      case when v_sort_by = 'sku' and v_sort_order = 'desc' then produto.sku end desc nulls last,
      case when v_sort_by = 'nome' and v_sort_order = 'asc' then produto.nome end asc nulls last,
      case when v_sort_by = 'nome' and v_sort_order = 'desc' then produto.nome end desc nulls last,
      case when v_sort_by = 'fornecedor' and v_sort_order = 'asc' then produto.fornecedor_operacional end asc nulls last,
      case when v_sort_by = 'fornecedor' and v_sort_order = 'desc' then produto.fornecedor_operacional end desc nulls last,
      case when v_sort_by = 'estoque' and v_sort_order = 'asc' then produto.estoque_operacional end asc nulls last,
      case when v_sort_by = 'estoque' and v_sort_order = 'desc' then produto.estoque_operacional end desc nulls last,
      case when v_sort_by = 'ml_status' and v_sort_order = 'asc' then produto.ml_status_operacional end asc nulls last,
      case when v_sort_by = 'ml_status' and v_sort_order = 'desc' then produto.ml_status_operacional end desc nulls last,
      produto.sku asc,
      produto.id asc
    offset v_offset
    limit v_page_size
  ),
  enriched as (
    select
      produto.*,
      coalesce(offer_count.offers_count, 0)::integer as offers_count,
      preferred.offer_json as preferred_offer
    from page_rows produto
    left join lateral (
      select count(*) as offers_count
      from public.produto_fornecedor_ofertas oferta
      where oferta.produto_id = produto.id
    ) offer_count on true
    left join lateral (
      select to_jsonb(oferta) as offer_json
      from public.produto_fornecedor_ofertas oferta
      where oferta.produto_id = produto.id
        and (
          (produto.oferta_preferencial_id is not null and oferta.id = produto.oferta_preferencial_id)
          or (
            produto.oferta_preferencial_id is null
            and nullif(trim(coalesce(produto.dslite_fornecedor_id, '')), '') is not null
            and oferta.dslite_fornecedor_id = produto.dslite_fornecedor_id
            and oferta.dslite_produto_id = produto.dslite_produto_id
          )
        )
      order by oferta.prioridade asc, oferta.custo asc, oferta.id asc
      limit 1
    ) preferred on true
  )
  select
    (select count(*) from filtered),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product',
          (
            to_jsonb(enriched)
              - 'offers_count'
              - 'preferred_offer'
              - 'display_price'
              - 'saldo_interno'
              - 'estoque_operacional'
              - 'fornecedor_operacional'
              - 'ml_item_id_operacional'
              - 'ml_status_operacional'
          ) || jsonb_build_object(
            'estoque', enriched.estoque_operacional,
            'fornecedor', enriched.fornecedor_operacional,
            'ml_item_id', enriched.ml_item_id_operacional,
            'ml_status', enriched.ml_status_operacional,
            'estoque_interno', enriched.saldo_interno
          ),
          'preferredOffer', enriched.preferred_offer,
          'offersCount', enriched.offers_count
        )
      )
      from enriched
    ), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object(
    'data', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_commercial_pricing_configuration(p_ml_fee_fallback_rate numeric, p_unspecified_shipping_cost numeric, p_inactive_cost_threshold numeric, p_quantity_tiers jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_quantity_count integer;
begin
  if p_ml_fee_fallback_rate is null or p_ml_fee_fallback_rate < 0 or p_ml_fee_fallback_rate >= 1 then
    raise exception 'Taxa fallback do ML inválida';
  end if;
  if p_unspecified_shipping_cost is null or p_inactive_cost_threshold is null or p_unspecified_shipping_cost < 0 or p_inactive_cost_threshold <= 0 then
    raise exception 'Proteções comerciais inválidas';
  end if;
  if p_quantity_tiers is null or jsonb_typeof(p_quantity_tiers) <> 'array'
    or jsonb_array_length(p_quantity_tiers) < 1
    or jsonb_array_length(p_quantity_tiers) > 5 then
    raise exception 'São obrigatórias de uma a cinco faixas por quantidade';
  end if;

  with tiers as (
    select
      (entry->>'position')::smallint as position,
      (entry->>'minPurchaseUnit')::smallint as min_purchase_unit,
      (entry->>'discountPercentage')::numeric as discount_percentage
    from jsonb_array_elements(p_quantity_tiers) entry
  )
  select count(*) into v_quantity_count
  from tiers tier
  where tier.position between 1 and 5
    and tier.min_purchase_unit between 1 and 100
    and tier.discount_percentage > 0 and tier.discount_percentage < 100;

  if v_quantity_count <> jsonb_array_length(p_quantity_tiers)
    or (select count(distinct (entry->>'position')::smallint) from jsonb_array_elements(p_quantity_tiers) entry) <> v_quantity_count
    or (select sum((entry->>'position')::smallint) from jsonb_array_elements(p_quantity_tiers) entry)
      <> (v_quantity_count * (v_quantity_count + 1) / 2)
    or exists (
      select 1
      from (
        select
          (entry->>'position')::smallint as position,
          (entry->>'minPurchaseUnit')::smallint as min_purchase_unit,
          (entry->>'discountPercentage')::numeric as discount_percentage
        from jsonb_array_elements(p_quantity_tiers) entry
      ) tier
      left join (
        select
          (entry->>'position')::smallint as position,
          (entry->>'minPurchaseUnit')::smallint as min_purchase_unit,
          (entry->>'discountPercentage')::numeric as discount_percentage
        from jsonb_array_elements(p_quantity_tiers) entry
      ) previous on previous.position = tier.position - 1
      where tier.position > 1
        and (tier.min_purchase_unit <= previous.min_purchase_unit
          or tier.discount_percentage <= previous.discount_percentage)
    ) then
    raise exception 'Faixas por quantidade devem ser sequenciais e progressivas';
  end if;

  update public.configuracoes
  set
    pricing_ml_fee_fallback_rate = p_ml_fee_fallback_rate,
    pricing_unspecified_shipping_cost = p_unspecified_shipping_cost,
    product_inactive_cost_threshold = p_inactive_cost_threshold,
    updated_at = now()
  where id = '00000000-0000-0000-0000-000000000001'::uuid;
  if not found then raise exception 'Configuração principal não encontrada'; end if;

  delete from public.ml_quantity_pricing_tiers;
  insert into public.ml_quantity_pricing_tiers (
    position, min_purchase_unit, discount_percentage, updated_at
  )
  select
    (entry->>'position')::smallint,
    (entry->>'minPurchaseUnit')::smallint,
    (entry->>'discountPercentage')::numeric,
    now()
  from jsonb_array_elements(p_quantity_tiers) entry;
end;
$function$;

drop function private.rule_02_projected_price(numeric,numeric,numeric,numeric,numeric);
revoke all on function public.search_produtos_paginated(text,text[],boolean,text,text,text,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.search_produtos_paginated(text,text[],boolean,text,text,text,integer,integer,text,text) to service_role;
revoke all on function public.save_commercial_pricing_configuration(numeric,numeric,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.save_commercial_pricing_configuration(numeric,numeric,numeric,jsonb) to service_role;
comment on table public.pricing_cost_tiers is 'Histórico legado; não governa novas decisões de pricing.';
comment on column public.configuracoes.margem_lucro is 'Histórico legado; não governa novas decisões de pricing.';
-- O resumo/filtro econômico de Anúncios pertence ao servidor canônico.
CREATE OR REPLACE FUNCTION public.search_ml_listings_paginated(p_tax_rate numeric, p_page integer DEFAULT 1, p_page_size integer DEFAULT 100, p_search text DEFAULT NULL::text, p_focus text DEFAULT 'all'::text, p_quality text DEFAULT 'all'::text, p_catalog text DEFAULT 'all'::text, p_profitability text DEFAULT 'all'::text, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_sort_by text DEFAULT 'title'::text, p_sort_order text DEFAULT 'asc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
  if coalesce(p_profitability, 'all') <> 'all' or p_sort_by = 'profit' then
    raise exception 'Filtros econômicos devem usar a memória canônica no servidor';
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
      null::numeric as profit,
      null::numeric as margin_percent,
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
$function$;
notify pgrst, 'reload schema';
