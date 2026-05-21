alter table public.anuncios_ml
  add column if not exists ml_sync_blocked_until timestamptz null,
  add column if not exists ml_sync_block_reason text null,
  add column if not exists ml_sync_last_error text null;

create index if not exists idx_anuncios_ml_blocked_until
  on public.anuncios_ml (ml_sync_blocked_until);
