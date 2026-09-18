-- Pedidos novos da Evolusom têm identificador próprio; IDs DSLite históricos permanecem intactos.
alter table public.compras alter column dsid drop not null;
alter table public.compras add column if not exists evolusom_order_id bigint;
alter table public.compras add column if not exists evolusom_request_code text;
alter table public.compras add column if not exists evolusom_request_state text;
alter table public.compras add column if not exists pedido_id uuid references public.pedidos(id);

alter table public.pedidos add column if not exists evolusom_order_id bigint;

create unique index if not exists compras_evolusom_order_id_uq
  on public.compras (evolusom_order_id) where evolusom_order_id is not null;
create unique index if not exists compras_evolusom_request_code_uq
  on public.compras (evolusom_request_code) where evolusom_request_code is not null;
create unique index if not exists compras_evolusom_pedido_id_uq
  on public.compras (pedido_id) where pedido_id is not null;
create index if not exists pedidos_evolusom_order_id_idx
  on public.pedidos (evolusom_order_id) where evolusom_order_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compras'::regclass
      and conname = 'compras_external_order_source_check'
  ) then
    alter table public.compras add constraint compras_external_order_source_check
      check (dsid is null or evolusom_order_id is null);
  end if;
end $$;
