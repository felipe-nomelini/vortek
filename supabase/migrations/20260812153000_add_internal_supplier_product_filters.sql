set local lock_timeout = '5s';

drop function if exists public.search_produtos_paginated(
  text, text[], text, text, text, numeric, numeric, text, integer, integer, text, text
);

drop function if exists public.search_produtos_resumo(
  text, text[], text, text, text, numeric, numeric, text
);

create or replace function public.search_produtos_paginated(
  p_search text default null,
  p_supplier_dslite_ids text[] default null,
  p_include_internal boolean default false,
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
    'sku', 'nome', 'fornecedor', 'estoque', 'custo', 'ml_fee',
    'ml_shipping', 'suggested_price', 'profit', 'ml_status'
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
      case
        when (1 - (0.04 + coalesce(produto.ml_fee, 0.15) + 0.30)) > 0 then
          round(coalesce(
            produto.custom_price,
            (coalesce(produto.custo, 0) + coalesce(produto.ml_shipping, 0))
              / (1 - (0.04 + coalesce(produto.ml_fee, 0.15) + 0.30))
          ) * 100) / 100
        else round(coalesce(produto.custom_price, produto.custo, 0) * 100) / 100
      end as display_price
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
  priced as (
    select
      filtered.*,
      case
        when filtered.ml_status_operacional = 'sem_anuncio' then null
        else round((
          coalesce(filtered.display_price, 0)
          - coalesce(filtered.custo, 0)
          - coalesce(filtered.ml_shipping, 0)
          - (coalesce(filtered.display_price, 0) * 0.04)
          - (coalesce(filtered.display_price, 0) * coalesce(filtered.ml_fee, 0.15))
        ) * 100) / 100
      end as profit_value
    from filtered
  ),
  price_filtered as (
    select *
    from priced produto
    where (
      p_price_min is null
      or case
        when v_price_field = 'cost' then coalesce(produto.custo, 0)
        when v_price_field = 'suggestedPrice' then coalesce(produto.display_price, 0)
        else coalesce(produto.profit_value, -999999999)
      end >= p_price_min
    )
      and (
        p_price_max is null
        or case
          when v_price_field = 'cost' then coalesce(produto.custo, 0)
          when v_price_field = 'suggestedPrice' then coalesce(produto.display_price, 0)
          else coalesce(produto.profit_value, 999999999)
        end <= p_price_max
      )
  ),
  page_rows as (
    select *
    from price_filtered produto
    order by
      case when v_sort_by = 'sku' and v_sort_order = 'asc' then produto.sku end asc nulls last,
      case when v_sort_by = 'sku' and v_sort_order = 'desc' then produto.sku end desc nulls last,
      case when v_sort_by = 'nome' and v_sort_order = 'asc' then produto.nome end asc nulls last,
      case when v_sort_by = 'nome' and v_sort_order = 'desc' then produto.nome end desc nulls last,
      case when v_sort_by = 'fornecedor' and v_sort_order = 'asc' then produto.fornecedor_operacional end asc nulls last,
      case when v_sort_by = 'fornecedor' and v_sort_order = 'desc' then produto.fornecedor_operacional end desc nulls last,
      case when v_sort_by = 'estoque' and v_sort_order = 'asc' then produto.estoque_operacional end asc nulls last,
      case when v_sort_by = 'estoque' and v_sort_order = 'desc' then produto.estoque_operacional end desc nulls last,
      case when v_sort_by = 'custo' and v_sort_order = 'asc' then produto.custo end asc nulls last,
      case when v_sort_by = 'custo' and v_sort_order = 'desc' then produto.custo end desc nulls last,
      case when v_sort_by = 'ml_fee' and v_sort_order = 'asc' then produto.ml_fee end asc nulls last,
      case when v_sort_by = 'ml_fee' and v_sort_order = 'desc' then produto.ml_fee end desc nulls last,
      case when v_sort_by = 'ml_shipping' and v_sort_order = 'asc' then produto.ml_shipping end asc nulls last,
      case when v_sort_by = 'ml_shipping' and v_sort_order = 'desc' then produto.ml_shipping end desc nulls last,
      case when v_sort_by = 'suggested_price' and v_sort_order = 'asc' then produto.display_price end asc nulls last,
      case when v_sort_by = 'suggested_price' and v_sort_order = 'desc' then produto.display_price end desc nulls last,
      case when v_sort_by = 'profit' and v_sort_order = 'asc' then produto.profit_value end asc nulls last,
      case when v_sort_by = 'profit' and v_sort_order = 'desc' then produto.profit_value end desc nulls last,
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
    (select count(*) from price_filtered),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product',
          (
            to_jsonb(enriched)
              - 'offers_count'
              - 'preferred_offer'
              - 'display_price'
              - 'profit_value'
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
$$;

create or replace function public.search_produtos_resumo(
  p_search text default null,
  p_supplier_dslite_ids text[] default null,
  p_include_internal boolean default false,
  p_product_active_status text default 'ativo',
  p_ml_status text default null,
  p_estoque text default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_price_field text default 'cost'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint := 0;
  v_com_estoque bigint := 0;
  v_sem_anuncio bigint := 0;
  v_receita_potencial numeric := 0;
  v_lucro_medio numeric := 0;
  v_active_status text := case
    when p_product_active_status in ('ativo', 'inativo', 'todos') then p_product_active_status
    else 'ativo'
  end;
  v_price_field text := case
    when p_price_field in ('cost', 'suggestedPrice', 'profit') then p_price_field
    else 'cost'
  end;
begin
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
  base as (
    select
      p.*,
      coalesce(internal.saldo_interno, 0) as saldo_interno,
      greatest(coalesce(p.estoque, 0), coalesce(internal.saldo_interno, 0)) as estoque_operacional,
      case
        when (1 - (0.04 + coalesce(p.ml_fee, 0.15) + 0.30)) > 0 then
          round(coalesce(
            p.custom_price,
            (coalesce(p.custo, 0) + coalesce(p.ml_shipping, 0)) / (1 - (0.04 + coalesce(p.ml_fee, 0.15) + 0.30))
          ) * 100) / 100
        else round(coalesce(p.custom_price, p.custo, 0) * 100) / 100
      end as display_price
    from public.produtos p
    left join internal_balances internal on internal.produto_id = p.id
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
        (
          coalesce(array_length(p_supplier_dslite_ids, 1), 0) = 0
          and not coalesce(p_include_internal, false)
        )
        or coalesce(p.dslite_fornecedor_id, '') = any(p_supplier_dslite_ids)
        or exists (
          select 1
          from public.produto_fornecedor_ofertas fo
          where fo.produto_id = p.id
            and fo.dslite_fornecedor_id = any(p_supplier_dslite_ids)
        )
        or (
          coalesce(p_include_internal, false)
          and coalesce(internal.saldo_interno, 0) > 0
        )
      )
      and (v_active_status <> 'ativo' or p.ativo is not false)
      and (v_active_status <> 'inativo' or p.ativo is false)
      and (coalesce(nullif(trim(p_ml_status), ''), '') = '' or p.ml_status::text = p_ml_status)
      and (coalesce(nullif(trim(p_estoque), ''), '') <> 'com_estoque' or greatest(coalesce(p.estoque, 0), coalesce(internal.saldo_interno, 0)) > 0)
      and (coalesce(nullif(trim(p_estoque), ''), '') <> 'sem_estoque' or greatest(coalesce(p.estoque, 0), coalesce(internal.saldo_interno, 0)) = 0)
  ),
  filtered as (
    select
      b.*,
      case
        when b.ml_status::text = 'sem_anuncio' then null
        else round((
          coalesce(b.display_price, 0)
          - coalesce(b.custo, 0)
          - coalesce(b.ml_shipping, 0)
          - (coalesce(b.display_price, 0) * 0.04)
          - (coalesce(b.display_price, 0) * coalesce(b.ml_fee, 0.15))
        ) * 100) / 100
      end as profit_value
    from base b
    where (
      p_price_min is null
      or case
        when v_price_field = 'cost' then coalesce(b.custo, 0)
        when v_price_field = 'suggestedPrice' then coalesce(b.display_price, 0)
        else coalesce(
          case
            when b.ml_status::text = 'sem_anuncio' then null
            else round((
              coalesce(b.display_price, 0)
              - coalesce(b.custo, 0)
              - coalesce(b.ml_shipping, 0)
              - (coalesce(b.display_price, 0) * 0.04)
              - (coalesce(b.display_price, 0) * coalesce(b.ml_fee, 0.15))
            ) * 100) / 100
          end,
          -999999999
        )
      end >= p_price_min
    )
      and (
        p_price_max is null
        or case
          when v_price_field = 'cost' then coalesce(b.custo, 0)
          when v_price_field = 'suggestedPrice' then coalesce(b.display_price, 0)
          else coalesce(
            case
              when b.ml_status::text = 'sem_anuncio' then null
              else round((
                coalesce(b.display_price, 0)
                - coalesce(b.custo, 0)
                - coalesce(b.ml_shipping, 0)
                - (coalesce(b.display_price, 0) * 0.04)
                - (coalesce(b.display_price, 0) * coalesce(b.ml_fee, 0.15))
              ) * 100) / 100
            end,
            999999999
          )
        end <= p_price_max
      )
  )
  select
    count(*),
    count(*) filter (where coalesce(estoque_operacional, 0) > 0),
    count(*) filter (where ml_status::text = 'sem_anuncio'),
    coalesce(sum(coalesce(display_price, 0) * coalesce(estoque_operacional, 0)), 0),
    coalesce(avg(profit_value) filter (where profit_value is not null), 0)
  into
    v_total,
    v_com_estoque,
    v_sem_anuncio,
    v_receita_potencial,
    v_lucro_medio
  from filtered;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'comEstoque', coalesce(v_com_estoque, 0),
    'semAnuncio', coalesce(v_sem_anuncio, 0),
    'receitaPotencial', round(coalesce(v_receita_potencial, 0) * 100) / 100,
    'lucroMedio', round(coalesce(v_lucro_medio, 0) * 100) / 100
  );
end;
$$;

revoke all on function public.search_produtos_paginated(
  text, text[], boolean, text, text, text, numeric, numeric, text, integer, integer, text, text
) from public;

grant execute on function public.search_produtos_paginated(
  text, text[], boolean, text, text, text, numeric, numeric, text, integer, integer, text, text
) to authenticated, service_role;

revoke all on function public.search_produtos_resumo(
  text, text[], boolean, text, text, text, numeric, numeric, text
) from public;

grant execute on function public.search_produtos_resumo(
  text, text[], boolean, text, text, text, numeric, numeric, text
) to authenticated, service_role;

