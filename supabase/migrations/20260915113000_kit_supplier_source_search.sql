-- Kits usam produto_kits.fornecedor_dslite_id como origem externa autoritativa.
-- A assinatura, o formato JSON, os grants e o search_path da RPC são preservados.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.search_produtos_paginated(
  p_search text default null::text,
  p_supplier_dslite_ids text[] default null::text[],
  p_include_internal boolean default false,
  p_product_active_status text default 'ativo'::text,
  p_ml_status text default null::text,
  p_estoque text default null::text,
  p_page integer default 1,
  p_page_size integer default 100,
  p_sort_by text default 'sku'::text,
  p_sort_order text default 'asc'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'pg_temp'
as $function$
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
  if v_sort_by not in ('sku', 'nome', 'fornecedor', 'estoque', 'ml_status') then
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
      kit.fornecedor_dslite_id as kit_fornecedor_dslite_id,
      kit.sku_origem as kit_sku_origem,
      coalesce(internal.saldo_interno, 0) as saldo_interno,
      greatest(coalesce(produto.estoque, 0), coalesce(internal.saldo_interno, 0)) as estoque_operacional,
      case
        when coalesce(internal.saldo_interno, 0) > 0 then 'Estoque Interno'
        when kit.produto_id is not null then coalesce(kit_supplier.apelido, produto.fornecedor)
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
    left join public.produto_kits kit
      on kit.produto_id = produto.id
      and kit.ativo is true
    left join public.fornecedores kit_supplier
      on kit_supplier.dslite_id = kit.fornecedor_dslite_id
      and kit_supplier.ativo is true
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
      or coalesce(produto.kit_sku_origem, '') ilike ('%' || trim(p_search) || '%')
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
        or coalesce(produto.kit_fornecedor_dslite_id, '') = any(p_supplier_dslite_ids)
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
              - 'kit_fornecedor_dslite_id'
              - 'kit_sku_origem'
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

revoke all on function public.search_produtos_paginated(text,text[],boolean,text,text,text,integer,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.search_produtos_paginated(text,text[],boolean,text,text,text,integer,integer,text,text)
  to service_role;
