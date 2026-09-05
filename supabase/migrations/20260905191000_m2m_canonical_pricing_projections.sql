-- M2M-PRC-03: projeções SQL leem a memória, sem fórmula de margem.
begin;
set local lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.search_produtos_paginated(p_search text DEFAULT NULL::text, p_supplier_dslite_ids text[] DEFAULT NULL::text[], p_include_internal boolean DEFAULT false, p_product_active_status text DEFAULT 'ativo'::text, p_ml_status text DEFAULT NULL::text, p_estoque text DEFAULT NULL::text, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_price_field text DEFAULT 'cost'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 100, p_sort_by text DEFAULT 'sku'::text, p_sort_order text DEFAULT 'asc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      (select e.price from public.current_pricing_evaluations e where e.produto_id=produto.id and e.scenario=case when produto.ml_item_id is null then 'target' else 'current' end and e.ml_item_id is not distinct from produto.ml_item_id order by e.evaluated_at desc limit 1) as display_price
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
      (select e.result from public.current_pricing_evaluations e where e.produto_id=filtered.id and e.scenario=case when filtered.ml_item_id is null then 'target' else 'current' end and e.ml_item_id is not distinct from filtered.ml_item_id order by e.evaluated_at desc limit 1) as profit_value
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
CREATE OR REPLACE FUNCTION public.search_produtos_resumo(p_search text DEFAULT NULL::text, p_supplier_dslite_ids text[] DEFAULT NULL::text[], p_include_internal boolean DEFAULT false, p_product_active_status text DEFAULT 'ativo'::text, p_ml_status text DEFAULT NULL::text, p_estoque text DEFAULT NULL::text, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_price_field text DEFAULT 'cost'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      (select e.price from public.current_pricing_evaluations e where e.produto_id=p.id and e.scenario=case when p.ml_item_id is null then 'target' else 'current' end and e.ml_item_id is not distinct from p.ml_item_id order by e.evaluated_at desc limit 1) as display_price
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
      (select e.result from public.current_pricing_evaluations e where e.produto_id=b.id and e.scenario=case when b.ml_item_id is null then 'target' else 'current' end and e.ml_item_id is not distinct from b.ml_item_id order by e.evaluated_at desc limit 1) as profit_value
    from base b
    where (
      p_price_min is null
      or case
        when v_price_field = 'cost' then coalesce(b.custo, 0)
        when v_price_field = 'suggestedPrice' then coalesce(b.display_price, 0)
        else coalesce(
          (select e.result from public.current_pricing_evaluations e where e.produto_id=b.id and e.scenario=case when b.ml_item_id is null then 'target' else 'current' end and e.ml_item_id is not distinct from b.ml_item_id order by e.evaluated_at desc limit 1),
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
            (select e.result from public.current_pricing_evaluations e where e.produto_id=b.id and e.scenario=case when b.ml_item_id is null then 'target' else 'current' end and e.ml_item_id is not distinct from b.ml_item_id order by e.evaluated_at desc limit 1),
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
    avg(profit_value) filter (where profit_value is not null)
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
    'lucroMedio', round(v_lucro_medio * 100) / 100
  );
end;
$function$;
commit;
