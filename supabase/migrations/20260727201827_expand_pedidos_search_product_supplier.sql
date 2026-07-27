create or replace function public.search_pedidos_paginated(
  p_search text default null,
  p_status public.pedido_status default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_page integer default 1,
  p_page_size integer default 100,
  p_sort_by text default 'data',
  p_sort_order text default 'desc'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
  v_offset integer := 0;
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_sort_by text := coalesce(nullif(trim(p_sort_by), ''), 'data');
  v_sort_order text := case
    when lower(coalesce(p_sort_order, '')) = 'asc' then 'asc'
    else 'desc'
  end;
  v_search text := trim(coalesce(p_search, ''));
  v_search_pattern text := '%' || trim(coalesce(p_search, '')) || '%';
begin
  if v_sort_by not in (
    'numero',
    'data',
    'cliente',
    'total',
    'rastreio',
    'situacao',
    'nota_fiscal_numero',
    'pedido_compra',
    'lucro'
  ) then
    v_sort_by := 'data';
    v_sort_order := 'desc';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with filtered as (
    select p.*
    from public.pedidos p
    where (
      v_search = ''
      or p.numero::text ilike v_search_pattern
      or coalesce(p.contato_nome, '') ilike v_search_pattern
      or coalesce(p.ml_order_id, '') ilike v_search_pattern
      or coalesce(p.ml_pack_id, '') ilike v_search_pattern
      or exists (
        select 1
        from public.pedido_itens pi
        where pi.pedido_id = p.id
          and (
            coalesce(pi.seller_sku, '') ilike v_search_pattern
            or coalesce(pi.titulo, '') ilike v_search_pattern
          )
      )
      or exists (
        select 1
        from public.compras c
        where c.dsid = p.dslite_id
          and (
            coalesce(c.produto_sku, '') ilike v_search_pattern
            or coalesce(c.produto_descricao, '') ilike v_search_pattern
            or coalesce(c.fornecedor_nome, '') ilike v_search_pattern
          )
      )
      or exists (
        select 1
        from public.pedido_itens pi
        join public.produtos produto
          on upper(trim(produto.sku)) = upper(trim(pi.seller_sku))
          or (
            nullif(trim(produto.sku), '') is not null
            and upper(trim(pi.seller_sku)) like ('%' || upper(trim(produto.sku)))
          )
        where pi.pedido_id = p.id
          and (
            coalesce(produto.sku, '') ilike v_search_pattern
            or coalesce(produto.nome, '') ilike v_search_pattern
            or coalesce(produto.fornecedor, '') ilike v_search_pattern
          )
      )
    )
      and (p_status is null or p.situacao = p_status)
      and (p_date_from is null or coalesce(p.data_venda, p.data) >= p_date_from)
      and (p_date_to is null or coalesce(p.data_venda, p.data) <= p_date_to)
      and (p_price_min is null or p.total >= p_price_min)
      and (p_price_max is null or p.total <= p_price_max)
  )
  select count(*) into v_total
  from filtered;

  with filtered as (
    select p.*
    from public.pedidos p
    where (
      v_search = ''
      or p.numero::text ilike v_search_pattern
      or coalesce(p.contato_nome, '') ilike v_search_pattern
      or coalesce(p.ml_order_id, '') ilike v_search_pattern
      or coalesce(p.ml_pack_id, '') ilike v_search_pattern
      or exists (
        select 1
        from public.pedido_itens pi
        where pi.pedido_id = p.id
          and (
            coalesce(pi.seller_sku, '') ilike v_search_pattern
            or coalesce(pi.titulo, '') ilike v_search_pattern
          )
      )
      or exists (
        select 1
        from public.compras c
        where c.dsid = p.dslite_id
          and (
            coalesce(c.produto_sku, '') ilike v_search_pattern
            or coalesce(c.produto_descricao, '') ilike v_search_pattern
            or coalesce(c.fornecedor_nome, '') ilike v_search_pattern
          )
      )
      or exists (
        select 1
        from public.pedido_itens pi
        join public.produtos produto
          on upper(trim(produto.sku)) = upper(trim(pi.seller_sku))
          or (
            nullif(trim(produto.sku), '') is not null
            and upper(trim(pi.seller_sku)) like ('%' || upper(trim(produto.sku)))
          )
        where pi.pedido_id = p.id
          and (
            coalesce(produto.sku, '') ilike v_search_pattern
            or coalesce(produto.nome, '') ilike v_search_pattern
            or coalesce(produto.fornecedor, '') ilike v_search_pattern
          )
      )
    )
      and (p_status is null or p.situacao = p_status)
      and (p_date_from is null or coalesce(p.data_venda, p.data) >= p_date_from)
      and (p_date_to is null or coalesce(p.data_venda, p.data) <= p_date_to)
      and (p_price_min is null or p.total >= p_price_min)
      and (p_price_max is null or p.total <= p_price_max)
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows)), '[]'::jsonb) into v_rows
  from (
    select *
    from filtered p
    order by
      case when v_sort_by = 'numero' and v_sort_order = 'asc' then p.numero end asc nulls last,
      case when v_sort_by = 'numero' and v_sort_order = 'desc' then p.numero end desc nulls last,
      case when v_sort_by = 'data' and v_sort_order = 'asc' then coalesce(p.data_venda, p.data) end asc nulls last,
      case when v_sort_by = 'data' and v_sort_order = 'desc' then coalesce(p.data_venda, p.data) end desc nulls last,
      case when v_sort_by = 'cliente' and v_sort_order = 'asc' then coalesce(nullif(trim(p.billing_nome), ''), nullif(trim(regexp_replace(coalesce(p.contato_nome, ''), '\s+\([^)]+\)\s*$', '')), ''), '') end asc nulls last,
      case when v_sort_by = 'cliente' and v_sort_order = 'desc' then coalesce(nullif(trim(p.billing_nome), ''), nullif(trim(regexp_replace(coalesce(p.contato_nome, ''), '\s+\([^)]+\)\s*$', '')), ''), '') end desc nulls last,
      case when v_sort_by = 'total' and v_sort_order = 'asc' then p.total end asc nulls last,
      case when v_sort_by = 'total' and v_sort_order = 'desc' then p.total end desc nulls last,
      case when v_sort_by = 'rastreio' and v_sort_order = 'asc' then coalesce(p.rastreio, '') end asc nulls last,
      case when v_sort_by = 'rastreio' and v_sort_order = 'desc' then coalesce(p.rastreio, '') end desc nulls last,
      case when v_sort_by = 'situacao' and v_sort_order = 'asc' then coalesce(p.situacao::text, '') end asc nulls last,
      case when v_sort_by = 'situacao' and v_sort_order = 'desc' then coalesce(p.situacao::text, '') end desc nulls last,
      case when v_sort_by = 'nota_fiscal_numero' and v_sort_order = 'asc' then case when coalesce(p.nota_fiscal_numero, '') ~ '^\d+$' then p.nota_fiscal_numero::bigint end end asc nulls last,
      case when v_sort_by = 'nota_fiscal_numero' and v_sort_order = 'desc' then case when coalesce(p.nota_fiscal_numero, '') ~ '^\d+$' then p.nota_fiscal_numero::bigint end end desc nulls last,
      case when v_sort_by = 'pedido_compra' and v_sort_order = 'asc' then case when nullif(trim(coalesce(p.dslite_id, '')), '') is not null then 1 else 0 end end asc nulls last,
      case when v_sort_by = 'pedido_compra' and v_sort_order = 'desc' then case when nullif(trim(coalesce(p.dslite_id, '')), '') is not null then 1 else 0 end end desc nulls last,
      case when v_sort_by = 'lucro' and v_sort_order = 'asc' then p.lucro end asc nulls last,
      case when v_sort_by = 'lucro' and v_sort_order = 'desc' then p.lucro end desc nulls last,
      coalesce(p.data_venda, p.data) desc,
      p.id desc
    offset v_offset
    limit v_page_size
  ) as page_rows;

  return jsonb_build_object(
    'data', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size
  );
end;
$$;

revoke execute on function public.search_pedidos_paginated(
  text,
  public.pedido_status,
  timestamptz,
  timestamptz,
  numeric,
  numeric,
  integer,
  integer,
  text,
  text
) from public, anon;

grant execute on function public.search_pedidos_paginated(
  text,
  public.pedido_status,
  timestamptz,
  timestamptz,
  numeric,
  numeric,
  integer,
  integer,
  text,
  text
) to authenticated, service_role;
