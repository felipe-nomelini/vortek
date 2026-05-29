create table if not exists public.pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  ml_order_id text,
  ml_item_id text,
  seller_sku text,
  titulo text not null default '',
  quantidade numeric(12,4) not null default 0,
  unidade text,
  valor_unitario numeric(12,2) not null default 0,
  valor_total_bruto numeric(12,2) not null default 0,
  desconto_item numeric(12,2) not null default 0,
  frete_rateado_item numeric(12,2) not null default 0,
  valor_total_liquido numeric(12,2) not null default 0,
  ncm text,
  cest text,
  gtin text,
  origem_fiscal text,
  csosn text,
  cfop_sugerido text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pedido_itens_pedido_id on public.pedido_itens (pedido_id);
create index if not exists idx_pedido_itens_ml_order_id on public.pedido_itens (ml_order_id);
create index if not exists idx_pedido_itens_seller_sku on public.pedido_itens (seller_sku);
create unique index if not exists pedido_itens_unique_order_item_idx
  on public.pedido_itens (pedido_id, coalesce(ml_item_id, ''), coalesce(seller_sku, ''));

alter table public.pedido_itens enable row level security;
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pedido_itens'
      and policyname = 'Todos podem ver pedido_itens'
  ) then
    create policy "Todos podem ver pedido_itens"
      on public.pedido_itens for select using (true);
  end if;
end;
$$;

alter table public.pedidos
  add column if not exists snapshot_source text,
  add column if not exists snapshot_version integer not null default 1,
  add column if not exists snapshot_incompleto boolean not null default false,
  add column if not exists snapshot_pendencias jsonb,
  add column if not exists buyer_ml_id text,
  add column if not exists billing_nome text,
  add column if not exists billing_documento text,
  add column if not exists billing_tipo_pessoa text,
  add column if not exists billing_ie text,
  add column if not exists billing_endereco jsonb,
  add column if not exists pagamento_resumo jsonb,
  add column if not exists totais_snapshot jsonb,
  add column if not exists sincronizado_em timestamptz;

create index if not exists idx_pedidos_snapshot_source on public.pedidos (snapshot_source);
create index if not exists idx_pedidos_snapshot_incompleto on public.pedidos (snapshot_incompleto);
create index if not exists idx_pedidos_sincronizado_em on public.pedidos (sincronizado_em desc);

create trigger set_updated_at_pedido_itens
before update on public.pedido_itens
for each row execute function public.set_updated_at();
