create or replace function public.search_produtos_paginated(
  p_search text default null,
  p_supplier_dslite_ids text[] default null,
  p_product_active_status text default 'ativo',
  p_ml_status text default null,
  p_estoque text default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_price_field text default 'cost',
  p_page integer default 1,
  p_page_size integer default 100,
  p_sort_by text default 'sku',
  p_sort_order text default 'asc'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_price_field text := case
    when p_price_field in ('cost', 'suggestedPrice', 'profit') then p_price_field
    else 'cost'
  end;
begin
  if v_sort_by not in (
    'sku',
    'nome',
    'fornecedor',
    'estoque',
    'custo',
    'ml_fee',
    'ml_shipping',
    'suggested_price',
    'profit',
    'ml_status'
  ) then
    v_sort_by := 'sku';
    v_sort_order := 'asc';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with filtered as (
    select
      p.*,
      case
        when (1 - (0.04 + coalesce(p.ml_fee, 0.15) + 0.30)) > 0 then
          round(coalesce(
            p.custom_price,
            (coalesce(p.custo, 0) + coalesce(p.ml_shipping, 0)) / (1 - (0.04 + coalesce(p.ml_fee, 0.15) + 0.30))
          ) * 100) / 100
        else round(coalesce(p.custom_price, p.custo, 0) * 100) / 100
      end as display_price
    from public.produtos p
    where (
      coalesce(nullif(trim(p_search), ''), '') = ''
      or coalesce(p.fornecedor, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(p.nome, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(p.sku, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(p.gtin, '') ilike ('%' || trim(p_search) || '%')
      or exists (
        select 1
        from public.produto_fornecedor_ofertas so
        where so.produto_id = p.id
          and (
            coalesce(so.fornecedor_nome, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(so.sku_oferta, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(so.sku_fornecedor, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(so.nome, '') ilike ('%' || trim(p_search) || '%')
          )
      )
    )
      and (
        coalesce(array_length(p_supplier_dslite_ids, 1), 0) = 0
        or coalesce(p.dslite_fornecedor_id, '') = any(p_supplier_dslite_ids)
        or exists (
          select 1
          from public.produto_fornecedor_ofertas fo
          where fo.produto_id = p.id
            and fo.dslite_fornecedor_id = any(p_supplier_dslite_ids)
        )
      )
      and (v_active_status <> 'ativo' or p.ativo is not false)
      and (v_active_status <> 'inativo' or p.ativo is false)
      and (coalesce(nullif(trim(p_ml_status), ''), '') = '' or p.ml_status::text = p_ml_status)
      and (coalesce(nullif(trim(p_estoque), ''), '') <> 'com_estoque' or coalesce(p.estoque, 0) > 0)
      and (coalesce(nullif(trim(p_estoque), ''), '') <> 'sem_estoque' or coalesce(p.estoque, 0) = 0)
  ),
  priced as (
    select
      f.*,
      case
        when f.ml_status::text = 'sem_anuncio' then null
        else round((
          coalesce(f.display_price, 0)
          - coalesce(f.custo, 0)
          - coalesce(f.ml_shipping, 0)
          - (coalesce(f.display_price, 0) * 0.04)
          - (coalesce(f.display_price, 0) * coalesce(f.ml_fee, 0.15))
        ) * 100) / 100
      end as profit_value
    from filtered f
  ),
  price_filtered as (
    select *
    from priced p
    where (
      p_price_min is null
      or case
        when v_price_field = 'cost' then coalesce(p.custo, 0)
        when v_price_field = 'suggestedPrice' then coalesce(p.display_price, 0)
        else coalesce(p.profit_value, -999999999)
      end >= p_price_min
    )
      and (
        p_price_max is null
        or case
          when v_price_field = 'cost' then coalesce(p.custo, 0)
          when v_price_field = 'suggestedPrice' then coalesce(p.display_price, 0)
          else coalesce(p.profit_value, 999999999)
        end <= p_price_max
      )
  )
  select count(*) into v_total
  from price_filtered;

  with filtered as (
    select
      p.*,
      case
        when (1 - (0.04 + coalesce(p.ml_fee, 0.15) + 0.30)) > 0 then
          round(coalesce(
            p.custom_price,
            (coalesce(p.custo, 0) + coalesce(p.ml_shipping, 0)) / (1 - (0.04 + coalesce(p.ml_fee, 0.15) + 0.30))
          ) * 100) / 100
        else round(coalesce(p.custom_price, p.custo, 0) * 100) / 100
      end as display_price
    from public.produtos p
    where (
      coalesce(nullif(trim(p_search), ''), '') = ''
      or coalesce(p.fornecedor, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(p.nome, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(p.sku, '') ilike ('%' || trim(p_search) || '%')
      or coalesce(p.gtin, '') ilike ('%' || trim(p_search) || '%')
      or exists (
        select 1
        from public.produto_fornecedor_ofertas so
        where so.produto_id = p.id
          and (
            coalesce(so.fornecedor_nome, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(so.sku_oferta, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(so.sku_fornecedor, '') ilike ('%' || trim(p_search) || '%')
            or coalesce(so.nome, '') ilike ('%' || trim(p_search) || '%')
          )
      )
    )
      and (
        coalesce(array_length(p_supplier_dslite_ids, 1), 0) = 0
        or coalesce(p.dslite_fornecedor_id, '') = any(p_supplier_dslite_ids)
        or exists (
          select 1
          from public.produto_fornecedor_ofertas fo
          where fo.produto_id = p.id
            and fo.dslite_fornecedor_id = any(p_supplier_dslite_ids)
        )
      )
      and (v_active_status <> 'ativo' or p.ativo is not false)
      and (v_active_status <> 'inativo' or p.ativo is false)
      and (coalesce(nullif(trim(p_ml_status), ''), '') = '' or p.ml_status::text = p_ml_status)
      and (coalesce(nullif(trim(p_estoque), ''), '') <> 'com_estoque' or coalesce(p.estoque, 0) > 0)
      and (coalesce(nullif(trim(p_estoque), ''), '') <> 'sem_estoque' or coalesce(p.estoque, 0) = 0)
  ),
  priced as (
    select
      f.*,
      case
        when f.ml_status::text = 'sem_anuncio' then null
        else round((
          coalesce(f.display_price, 0)
          - coalesce(f.custo, 0)
          - coalesce(f.ml_shipping, 0)
          - (coalesce(f.display_price, 0) * 0.04)
          - (coalesce(f.display_price, 0) * coalesce(f.ml_fee, 0.15))
        ) * 100) / 100
      end as profit_value
    from filtered f
  ),
  price_filtered as (
    select *
    from priced p
    where (
      p_price_min is null
      or case
        when v_price_field = 'cost' then coalesce(p.custo, 0)
        when v_price_field = 'suggestedPrice' then coalesce(p.display_price, 0)
        else coalesce(p.profit_value, -999999999)
      end >= p_price_min
    )
      and (
        p_price_max is null
        or case
          when v_price_field = 'cost' then coalesce(p.custo, 0)
          when v_price_field = 'suggestedPrice' then coalesce(p.display_price, 0)
          else coalesce(p.profit_value, 999999999)
        end <= p_price_max
      )
  ),
  page_rows as (
    select *
    from price_filtered f
    order by
      case when v_sort_by = 'sku' and v_sort_order = 'asc' then f.sku end asc nulls last,
      case when v_sort_by = 'sku' and v_sort_order = 'desc' then f.sku end desc nulls last,
      case when v_sort_by = 'nome' and v_sort_order = 'asc' then f.nome end asc nulls last,
      case when v_sort_by = 'nome' and v_sort_order = 'desc' then f.nome end desc nulls last,
      case when v_sort_by = 'fornecedor' and v_sort_order = 'asc' then f.fornecedor end asc nulls last,
      case when v_sort_by = 'fornecedor' and v_sort_order = 'desc' then f.fornecedor end desc nulls last,
      case when v_sort_by = 'estoque' and v_sort_order = 'asc' then f.estoque end asc nulls last,
      case when v_sort_by = 'estoque' and v_sort_order = 'desc' then f.estoque end desc nulls last,
      case when v_sort_by = 'custo' and v_sort_order = 'asc' then f.custo end asc nulls last,
      case when v_sort_by = 'custo' and v_sort_order = 'desc' then f.custo end desc nulls last,
      case when v_sort_by = 'ml_fee' and v_sort_order = 'asc' then f.ml_fee end asc nulls last,
      case when v_sort_by = 'ml_fee' and v_sort_order = 'desc' then f.ml_fee end desc nulls last,
      case when v_sort_by = 'ml_shipping' and v_sort_order = 'asc' then f.ml_shipping end asc nulls last,
      case when v_sort_by = 'ml_shipping' and v_sort_order = 'desc' then f.ml_shipping end desc nulls last,
      case when v_sort_by = 'suggested_price' and v_sort_order = 'asc' then f.display_price end asc nulls last,
      case when v_sort_by = 'suggested_price' and v_sort_order = 'desc' then f.display_price end desc nulls last,
      case when v_sort_by = 'profit' and v_sort_order = 'asc' then f.profit_value end asc nulls last,
      case when v_sort_by = 'profit' and v_sort_order = 'desc' then f.profit_value end desc nulls last,
      case when v_sort_by = 'ml_status' and v_sort_order = 'asc' then f.ml_status::text end asc nulls last,
      case when v_sort_by = 'ml_status' and v_sort_order = 'desc' then f.ml_status::text end desc nulls last,
      f.sku asc,
      f.id asc
    offset v_offset
    limit v_page_size
  ),
  enriched as (
    select
      pr.*,
      coalesce(oc.offers_count, 0)::integer as offers_count,
      po.offer_json as preferred_offer
    from page_rows pr
    left join lateral (
      select count(*) as offers_count
      from public.produto_fornecedor_ofertas o
      where o.produto_id = pr.id
    ) oc on true
    left join lateral (
      select to_jsonb(o) as offer_json
      from public.produto_fornecedor_ofertas o
      where o.produto_id = pr.id
        and (
          (pr.oferta_preferencial_id is not null and o.id = pr.oferta_preferencial_id)
          or (
            pr.oferta_preferencial_id is null
            and nullif(trim(coalesce(pr.dslite_fornecedor_id, '')), '') is not null
            and o.dslite_fornecedor_id = pr.dslite_fornecedor_id
            and o.dslite_produto_id = pr.dslite_produto_id
          )
        )
      order by o.prioridade asc, o.custo asc, o.id asc
      limit 1
    ) po on true
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'product',
      to_jsonb(enriched) - 'offers_count' - 'preferred_offer' - 'display_price' - 'profit_value',
      'preferredOffer',
      preferred_offer,
      'offersCount',
      offers_count
    )
  ), '[]'::jsonb) into v_rows
  from enriched;

  return jsonb_build_object(
    'data', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;
