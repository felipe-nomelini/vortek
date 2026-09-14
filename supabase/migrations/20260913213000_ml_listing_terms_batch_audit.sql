set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.ml_listing_terms_batch_items (
  job_id uuid not null references public.jobs(id) on delete cascade,
  ml_item_id text not null,
  ordinal integer not null,
  sku text null,
  produto_id uuid null references public.produtos(id) on delete set null,
  action text not null check (action in ('normalize', 'delete_permanent', 'noop', 'blocked')),
  reason text not null,
  is_canary boolean not null default false,
  before_state jsonb not null,
  desired_state jsonb not null default '{}'::jsonb,
  source_evidence jsonb not null default '{}'::jsonb,
  status text not null default 'prepared'
    check (status in ('prepared', 'applying', 'confirmed', 'skipped', 'blocked', 'error')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text null,
  readback jsonb null,
  applied_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, ml_item_id)
);

create index if not exists idx_ml_listing_terms_batch_items_status
  on public.ml_listing_terms_batch_items (job_id, status, ordinal);
create index if not exists idx_ml_listing_terms_batch_items_produto_id
  on public.ml_listing_terms_batch_items (produto_id)
  where produto_id is not null;

drop trigger if exists set_updated_at_ml_listing_terms_batch_items
  on public.ml_listing_terms_batch_items;
create trigger set_updated_at_ml_listing_terms_batch_items
before update on public.ml_listing_terms_batch_items
for each row execute function public.set_updated_at();

alter table public.ml_listing_terms_batch_items enable row level security;
revoke all on table public.ml_listing_terms_batch_items from public, anon, authenticated;
grant select, insert, update, delete on table public.ml_listing_terms_batch_items to service_role;

comment on table public.ml_listing_terms_batch_items is
  'Manifesto e read-back do lote único que normaliza anúncios ativos abaixo de R$ 70 e registra exclusões aprovadas.';

notify pgrst, 'reload schema';

-- Rollback de schema, somente após arquivar a evidência da execução:
-- drop table if exists public.ml_listing_terms_batch_items;
