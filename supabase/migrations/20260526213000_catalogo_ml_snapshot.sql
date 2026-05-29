create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.catalogo_ml_snapshot (
  id uuid primary key default gen_random_uuid(),
  ml_item_id text not null unique,
  seller_id bigint not null,
  title text null,
  status text null,
  price numeric not null default 0,
  price_to_win numeric null,
  buy_box_status text null,
  buy_box_winning boolean not null default false,
  permalink text null,
  thumbnail text null,
  seller_sku text null,
  catalog_product_id text null,
  category_id text null,
  domain_id text null,
  related_item_id text null,
  related_permalink text null,
  produto_id uuid null references public.produtos(id) on delete set null,
  sku_local text null,
  last_updated_ml timestamptz null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_catalogo_ml_snapshot_seller_status
  on public.catalogo_ml_snapshot (seller_id, status);

create index if not exists idx_catalogo_ml_snapshot_seller_buybox
  on public.catalogo_ml_snapshot (seller_id, buy_box_winning);

create index if not exists idx_catalogo_ml_snapshot_seller_price
  on public.catalogo_ml_snapshot (seller_id, price);

create index if not exists idx_catalogo_ml_snapshot_search_trgm
  on public.catalogo_ml_snapshot using gin (
    (coalesce(title, '') || ' ' || coalesce(seller_sku, '') || ' ' || coalesce(sku_local, '') || ' ' || coalesce(ml_item_id, '')) gin_trgm_ops
  );

create index if not exists idx_catalogo_ml_snapshot_seller_synced
  on public.catalogo_ml_snapshot (seller_id, synced_at desc);

create or replace function public.set_catalogo_ml_snapshot_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_catalogo_ml_snapshot_updated_at on public.catalogo_ml_snapshot;
create trigger trg_catalogo_ml_snapshot_updated_at
before update on public.catalogo_ml_snapshot
for each row execute procedure public.set_catalogo_ml_snapshot_updated_at();
