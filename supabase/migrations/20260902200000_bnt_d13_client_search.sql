begin;

set local lock_timeout = '5s';

create index if not exists idx_pedidos_buyer_ml_id_sale_date
  on public.pedidos (buyer_ml_id, data_venda desc nulls last, data desc)
  where nullif(btrim(coalesce(buyer_ml_id, '')), '') is not null;

create or replace function public.search_clientes_paginated(
  p_page integer default 1,
  p_page_size integer default 100,
  p_search text default null,
  p_person_type text default null,
  p_sort_by text default 'name',
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
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_search_digits text := nullif(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
  v_person_type text := case when p_person_type in ('F', 'J') then p_person_type else null end;
  v_sort_by text := case
    when p_sort_by in ('name', 'ml_id', 'person_type', 'document', 'location', 'orders') then p_sort_by
    else 'name'
  end;
  v_sort_order text := case when p_sort_order = 'desc' then 'desc' else 'asc' end;
  v_result jsonb;
begin
  v_offset := (v_page - 1) * v_page_size;

  with order_counts as (
    select
      pedido.buyer_ml_id,
      count(*)::integer as order_count
    from public.pedidos pedido
    where nullif(btrim(coalesce(pedido.buyer_ml_id, '')), '') is not null
    group by pedido.buyer_ml_id
  ),
  latest_addresses as (
    select distinct on (pedido.buyer_ml_id)
      pedido.buyer_ml_id,
      pedido.billing_endereco
    from public.pedidos pedido
    where nullif(btrim(coalesce(pedido.buyer_ml_id, '')), '') is not null
      and pedido.billing_endereco is not null
    order by
      pedido.buyer_ml_id,
      pedido.data_venda desc nulls last,
      pedido.data desc,
      pedido.id desc
  ),
  base as (
    select
      cliente.id,
      cliente.nome,
      cliente.tipo_pessoa,
      cliente.documento,
      cliente.endereco,
      cliente.email,
      cliente.telefone,
      cliente.ml_id,
      cliente.ml_nickname,
      coalesce(order_count.order_count, 0) as order_count,
      nullif(btrim(latest_address.billing_endereco ->> 'city_name'), '') as city,
      nullif(upper(btrim(latest_address.billing_endereco ->> 'state_id')), '') as state
    from public.clientes cliente
    left join order_counts order_count on order_count.buyer_ml_id = cliente.ml_id
    left join latest_addresses latest_address on latest_address.buyer_ml_id = cliente.ml_id
  ),
  filtered as (
    select client.*
    from base client
    where (v_person_type is null or client.tipo_pessoa = v_person_type)
      and (
        v_search is null
        or position(lower(v_search) in lower(concat_ws(
          ' ',
          client.nome,
          client.documento,
          client.ml_id,
          client.ml_nickname,
          client.email,
          client.telefone,
          client.endereco,
          client.city,
          client.state
        ))) > 0
        or (
          v_search_digits is not null
          and position(v_search_digits in regexp_replace(coalesce(client.documento, ''), '[^0-9]', '', 'g')) > 0
        )
      )
  ),
  ranked as (
    select
      client.*,
      row_number() over (
        order by
          case when v_sort_by = 'name' and v_sort_order = 'asc' then lower(client.nome) end asc nulls last,
          case when v_sort_by = 'name' and v_sort_order = 'desc' then lower(client.nome) end desc nulls last,
          case when v_sort_by = 'ml_id' and v_sort_order = 'asc' then client.ml_id end asc nulls last,
          case when v_sort_by = 'ml_id' and v_sort_order = 'desc' then client.ml_id end desc nulls last,
          case when v_sort_by = 'person_type' and v_sort_order = 'asc' then client.tipo_pessoa end asc nulls last,
          case when v_sort_by = 'person_type' and v_sort_order = 'desc' then client.tipo_pessoa end desc nulls last,
          case when v_sort_by = 'document' and v_sort_order = 'asc' then client.documento end asc nulls last,
          case when v_sort_by = 'document' and v_sort_order = 'desc' then client.documento end desc nulls last,
          case when v_sort_by = 'location' and v_sort_order = 'asc' then lower(coalesce(client.city, client.state, client.endereco)) end asc nulls last,
          case when v_sort_by = 'location' and v_sort_order = 'desc' then lower(coalesce(client.city, client.state, client.endereco)) end desc nulls last,
          case when v_sort_by = 'orders' and v_sort_order = 'asc' then client.order_count end asc nulls last,
          case when v_sort_by = 'orders' and v_sort_order = 'desc' then client.order_count end desc nulls last,
          lower(client.nome) asc,
          client.id asc
      ) as row_number
    from filtered client
  ),
  page_rows as (
    select *
    from ranked
    where row_number > v_offset
      and row_number <= v_offset + v_page_size
  ),
  summary as (
    select
      count(*)::integer as total,
      count(*) filter (where cliente.tipo_pessoa = 'F')::integer as pf,
      count(*) filter (where cliente.tipo_pessoa = 'J')::integer as pj
    from public.clientes cliente
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', client.id,
          'name', client.nome,
          'personType', client.tipo_pessoa,
          'document', client.documento,
          'address', client.endereco,
          'email', client.email,
          'phone', client.telefone,
          'mlId', client.ml_id,
          'mlNickname', client.ml_nickname,
          'orderCount', client.order_count,
          'city', client.city,
          'state', client.state
        ) order by client.row_number
      )
      from page_rows client
    ), '[]'::jsonb),
    'page', v_page,
    'pageSize', v_page_size,
    'total', (select count(*)::integer from filtered),
    'summary', jsonb_build_object(
      'total', (select total from summary),
      'pf', (select pf from summary),
      'pj', (select pj from summary)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.search_clientes_paginated(integer, integer, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.search_clientes_paginated(integer, integer, text, text, text, text)
  to service_role;

comment on function public.search_clientes_paginated(integer, integer, text, text, text, text)
  is 'Lista clientes com resumo global, localização e contagem de pedidos pelo buyer_ml_id oficial.';

commit;
