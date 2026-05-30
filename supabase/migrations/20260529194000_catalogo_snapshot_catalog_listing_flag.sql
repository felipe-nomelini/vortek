alter table if exists public.catalogo_ml_snapshot
  add column if not exists catalog_listing boolean not null default false;

create index if not exists idx_catalogo_ml_snapshot_seller_catalog_status
  on public.catalogo_ml_snapshot (seller_id, catalog_listing, status);
