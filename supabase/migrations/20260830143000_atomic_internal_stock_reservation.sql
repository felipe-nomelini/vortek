begin;

set local lock_timeout = '5s';

alter table public.estoque_interno_movimentacoes
  add column if not exists estado_envio_interno text,
  add column if not exists despachado_em timestamptz;

-- As saídas anteriores a esta migration já representavam mercadoria despachada.
update public.estoque_interno_movimentacoes movimento
set
  estado_envio_interno = 'despachado',
  despachado_em = coalesce(pedido.envio_interno_at, movimento.created_at)
from public.pedidos pedido
where movimento.pedido_id = pedido.id
  and movimento.tipo = 'saida_envio_interno'
  and movimento.estado_envio_interno is null;

update public.estoque_interno_movimentacoes movimento
set
  estado_envio_interno = 'despachado',
  despachado_em = movimento.created_at
where movimento.tipo = 'saida_envio_interno'
  and movimento.estado_envio_interno is null;

alter table public.estoque_interno_movimentacoes
  drop constraint if exists estoque_interno_movimentacoes_estado_envio_check;

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_estado_envio_check
  check (
    (
      tipo = 'saida_envio_interno'
      and estado_envio_interno in ('reservado', 'despachado')
      and (
        (estado_envio_interno = 'reservado' and despachado_em is null)
        or (estado_envio_interno = 'despachado' and despachado_em is not null)
      )
    )
    or (
      tipo <> 'saida_envio_interno'
      and estado_envio_interno is null
      and despachado_em is null
    )
  );

comment on column public.estoque_interno_movimentacoes.estado_envio_interno is
  'Estado do compromisso de estoque de uma venda interna: reservado ou despachado.';

comment on column public.estoque_interno_movimentacoes.despachado_em is
  'Momento em que a reserva foi convertida em saída física após o despacho.';

create index if not exists idx_estoque_interno_reservas_ativas
  on public.estoque_interno_movimentacoes (produto_id, pedido_id)
  where tipo = 'saida_envio_interno'
    and estado_envio_interno = 'reservado'
    and estornada_em is null;

drop function if exists public.select_order_fulfillment(uuid, text);

create function public.select_order_fulfillment(
  p_pedido_id uuid,
  p_source text,
  p_items jsonb
) returns table (
  fulfillment_source text,
  fulfillment_selected_at timestamptz,
  selected_now boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_source text := nullif(trim(p_source), '');
  v_selected_now boolean := false;
  v_item record;
  v_available bigint;
  v_existing_count integer := 0;
  v_reservation_mismatch boolean := false;
begin
  if v_source is null or v_source not in ('internal', 'supplier') then
    raise exception using
      errcode = '22023',
      message = 'invalid_fulfillment_source';
  end if;

  select pedido.*
  into v_pedido
  from public.pedidos pedido
  where pedido.id = p_pedido_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'order_not_found';
  end if;

  if v_source = 'internal' and nullif(trim(v_pedido.dslite_id), '') is not null then
    raise exception using
      errcode = 'P0001',
      message = 'fulfillment_conflict:supplier';
  end if;

  if v_source = 'supplier' and v_pedido.envio_interno_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'fulfillment_conflict:internal';
  end if;

  if v_pedido.fulfillment_source is not null
    and v_pedido.fulfillment_source <> v_source then
    raise exception using
      errcode = 'P0001',
      message = 'fulfillment_conflict:' || v_pedido.fulfillment_source;
  end if;

  if v_source = 'internal' then
    if p_items is null
      or jsonb_typeof(p_items) <> 'array'
      or jsonb_array_length(p_items) = 0 then
      raise exception using
        errcode = '22023',
        message = 'invalid_internal_stock_items';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(p_items) as item(
        produto_id uuid,
        sku text,
        quantidade integer
      )
      where item.produto_id is null
        or item.quantidade is null
        or item.quantidade <= 0
    ) then
      raise exception using
        errcode = '22023',
        message = 'invalid_internal_stock_items';
    end if;

    -- Todos os fluxos adquirem os locks na mesma ordem para evitar deadlock.
    for v_item in
      select
        item.produto_id,
        min(nullif(trim(item.sku), '')) as sku,
        sum(item.quantidade)::bigint as quantidade
      from jsonb_to_recordset(p_items) as item(
        produto_id uuid,
        sku text,
        quantidade integer
      )
      group by item.produto_id
      order by item.produto_id
    loop
      if v_item.quantidade > 2147483647 then
        raise exception using
          errcode = '22023',
          message = 'invalid_internal_stock_items';
      end if;

      perform produto.id
      from public.produtos produto
      where produto.id = v_item.produto_id
      for update;

      if not found then
        raise exception using
          errcode = 'P0002',
          message = 'internal_stock_product_not_found:' || v_item.produto_id::text;
      end if;
    end loop;

    select count(*)::integer
    into v_existing_count
    from public.estoque_interno_movimentacoes movimento
    where movimento.pedido_id = p_pedido_id
      and movimento.tipo = 'saida_envio_interno'
      and movimento.estornada_em is null;

    if v_existing_count > 0 then
      with expected as (
        select
          item.produto_id,
          sum(item.quantidade)::bigint as quantidade
        from jsonb_to_recordset(p_items) as item(
          produto_id uuid,
          sku text,
          quantidade integer
        )
        group by item.produto_id
      ), existing as (
        select
          movimento.produto_id,
          sum(movimento.quantidade)::bigint as quantidade
        from public.estoque_interno_movimentacoes movimento
        where movimento.pedido_id = p_pedido_id
          and movimento.tipo = 'saida_envio_interno'
          and movimento.estornada_em is null
        group by movimento.produto_id
      )
      select exists (
        select 1
        from expected
        full join existing using (produto_id)
        where expected.produto_id is null
          or existing.produto_id is null
          or expected.quantidade <> existing.quantidade
      )
      into v_reservation_mismatch;

      if v_reservation_mismatch then
        raise exception using
          errcode = 'P0001',
          message = 'internal_stock_reservation_conflict';
      end if;
    else
      -- Os locks de produto mantidos acima serializam a leitura do saldo e a reserva.
      for v_item in
        select
          item.produto_id,
          coalesce(min(nullif(trim(item.sku), '')), item.produto_id::text) as sku,
          sum(item.quantidade)::bigint as quantidade
        from jsonb_to_recordset(p_items) as item(
          produto_id uuid,
          sku text,
          quantidade integer
        )
        group by item.produto_id
        order by item.produto_id
      loop
        select coalesce(sum(
          case
            when movimento.tipo = 'entrada_devolucao'
              and movimento.situacao_estoque = 'liberado'
            then movimento.quantidade
            when movimento.tipo = 'saida_envio_interno'
              and movimento.estornada_em is null
            then -movimento.quantidade
            else 0
          end
        ), 0)::bigint
        into v_available
        from public.estoque_interno_movimentacoes movimento
        where movimento.produto_id = v_item.produto_id;

        if v_available < v_item.quantidade then
          raise exception using
            errcode = 'P0001',
            message = format(
              'internal_stock_insufficient:%s:%s',
              v_item.sku,
              greatest(v_available, 0)
            );
        end if;
      end loop;

      insert into public.estoque_interno_movimentacoes (
        produto_id,
        pedido_id,
        tipo,
        quantidade,
        motivo,
        estado_envio_interno
      )
      select
        item.produto_id,
        p_pedido_id,
        'saida_envio_interno',
        sum(item.quantidade)::integer,
        'Reserva para envio interno',
        'reservado'
      from jsonb_to_recordset(p_items) as item(
        produto_id uuid,
        sku text,
        quantidade integer
      )
      group by item.produto_id
      order by item.produto_id;
    end if;
  end if;

  if v_pedido.fulfillment_source is null then
    update public.pedidos pedido
    set
      fulfillment_source = v_source,
      fulfillment_selected_at = now()
    where pedido.id = p_pedido_id
    returning pedido.* into v_pedido;
    v_selected_now := true;
  end if;

  return query
  select
    v_pedido.fulfillment_source,
    v_pedido.fulfillment_selected_at,
    v_selected_now;
end;
$$;

revoke all on function public.select_order_fulfillment(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.select_order_fulfillment(uuid, text, jsonb)
  to service_role;

create function public.dispatch_internal_stock_reservation(
  p_pedido_id uuid
) returns table (
  movimentos_atualizados integer,
  produto_ids uuid[]
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  with updated as (
    update public.estoque_interno_movimentacoes movimento
    set
      estado_envio_interno = 'despachado',
      despachado_em = now()
    where movimento.pedido_id = p_pedido_id
      and movimento.tipo = 'saida_envio_interno'
      and movimento.estado_envio_interno = 'reservado'
      and movimento.estornada_em is null
    returning movimento.produto_id
  )
  select
    count(*)::integer,
    coalesce(array_agg(distinct updated.produto_id), array[]::uuid[])
  from updated;
end;
$$;

revoke all on function public.dispatch_internal_stock_reservation(uuid)
  from public, anon, authenticated;
grant execute on function public.dispatch_internal_stock_reservation(uuid)
  to service_role;

create function public.reverse_internal_stock_commitment(
  p_pedido_id uuid,
  p_motivo text
) returns table (
  movimentos_atualizados integer,
  produto_ids uuid[]
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(trim(p_motivo), '') is null then
    raise exception using
      errcode = '22023',
      message = 'invalid_internal_stock_reversal_reason';
  end if;

  return query
  with updated as (
    update public.estoque_interno_movimentacoes movimento
    set
      estornada_em = now(),
      estorno_motivo = trim(p_motivo)
    where movimento.pedido_id = p_pedido_id
      and movimento.tipo = 'saida_envio_interno'
      and movimento.estornada_em is null
    returning movimento.produto_id
  )
  select
    count(*)::integer,
    coalesce(array_agg(distinct updated.produto_id), array[]::uuid[])
  from updated;
end;
$$;

revoke all on function public.reverse_internal_stock_commitment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reverse_internal_stock_commitment(uuid, text)
  to service_role;

commit;
