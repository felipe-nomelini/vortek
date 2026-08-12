alter table public.pedidos
  add column if not exists fulfillment_source text,
  add column if not exists fulfillment_selected_at timestamptz;

alter table public.pedidos
  drop constraint if exists pedidos_fulfillment_source_check;

alter table public.pedidos
  add constraint pedidos_fulfillment_source_check
  check (fulfillment_source is null or fulfillment_source in ('internal', 'supplier'));

comment on column public.pedidos.fulfillment_source is
  'Origem de atendimento escolhida antes do processamento: internal ou supplier.';

comment on column public.pedidos.fulfillment_selected_at is
  'Momento em que a origem de atendimento foi escolhida ou registrada pelo backfill.';

-- Pedidos legados com os dois sinais permanecem sem origem para não registrar
-- uma escolha histórica que não pode ser determinada com segurança.
update public.pedidos
set
  fulfillment_source = case
    when envio_interno_at is not null and nullif(trim(dslite_id), '') is null then 'internal'
    when envio_interno_at is null and nullif(trim(dslite_id), '') is not null then 'supplier'
    else fulfillment_source
  end,
  fulfillment_selected_at = case
    when fulfillment_source is not null then coalesce(fulfillment_selected_at, updated_at, created_at, now())
    when envio_interno_at is not null and nullif(trim(dslite_id), '') is null then envio_interno_at
    when envio_interno_at is null and nullif(trim(dslite_id), '') is not null then coalesce(updated_at, created_at, now())
    else fulfillment_selected_at
  end
where fulfillment_source is null;

create index if not exists idx_pedidos_fulfillment_source
  on public.pedidos (fulfillment_source)
  where fulfillment_source is not null;

create or replace function public.select_order_fulfillment(
  p_pedido_id uuid,
  p_source text
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

revoke all on function public.select_order_fulfillment(uuid, text) from public, anon, authenticated;
grant execute on function public.select_order_fulfillment(uuid, text) to service_role;
