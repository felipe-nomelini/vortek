alter table public.pedidos
  add column if not exists ml_fiscal_release_at timestamptz null,
  add column if not exists ml_fiscal_release_reason text null,
  add column if not exists ml_fiscal_release_source text null,
  add column if not exists ml_fiscal_release_checked_at timestamptz null;

create index if not exists idx_pedidos_ml_fiscal_release_at
  on public.pedidos (ml_fiscal_release_at);
