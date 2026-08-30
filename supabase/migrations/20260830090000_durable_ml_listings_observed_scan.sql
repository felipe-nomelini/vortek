create table if not exists public.ml_listings_observed_items (
  job_id uuid not null references public.jobs(id) on delete cascade,
  seller_id bigint not null,
  ml_item_id text not null,
  ordinal integer not null,
  attempts integer not null default 0,
  processed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, ml_item_id)
);

alter table public.ml_listings_observed_items enable row level security;

create index if not exists idx_ml_listings_observed_items_pending
  on public.ml_listings_observed_items (job_id, ordinal)
  where processed_at is null;

revoke all on table public.ml_listings_observed_items from anon, authenticated;
grant select, insert, update, delete on table public.ml_listings_observed_items to service_role;

comment on table public.ml_listings_observed_items is
  'Manifesto retomavel dos IDs obtidos por um unico scan do Mercado Livre por ciclo observado.';

