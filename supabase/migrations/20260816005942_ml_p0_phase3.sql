create table if not exists public.ml_p0_phase3_runs (
  id uuid primary key default gen_random_uuid(),
  source_sanitize_run_id uuid not null references public.ml_p0_sanitize_runs(id) on delete restrict,
  mode text not null default 'AUDIT_ONLY' check (mode = 'AUDIT_ONLY'),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  source_population_hash text not null,
  infrastructure_metrics jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ml_p0_phase3_runs_source
  on public.ml_p0_phase3_runs (source_sanitize_run_id, started_at desc);

create table if not exists public.ml_p0_phase3_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_p0_phase3_runs(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  sku text not null,
  fornecedor_nome text,
  recommended_action text not null check (recommended_action in (
    'LINK_EXISTING', 'BLOCK_DUPLICATE', 'MANUAL_LINK_REVIEW', 'READY_FOR_CREATE',
    'MANUAL_IDENTITY', 'MANUAL_TECH', 'MANUAL_IMAGE', 'CATEGORY_MISMATCH',
    'SOURCE_DEFERRED'
  )),
  identity_confidence integer not null check (identity_confidence between 0 and 100),
  remote_match_confidence integer not null check (remote_match_confidence between 0 and 100),
  documentation_score integer not null check (documentation_score between 0 and 100),
  publication_readiness integer not null check (publication_readiness between 0 and 100),
  duplicate_risk integer not null check (duplicate_risk between 0 and 100),
  audit_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, produto_id),
  unique (run_id, sku)
);

create index if not exists idx_ml_p0_phase3_results_action
  on public.ml_p0_phase3_results (run_id, recommended_action, publication_readiness desc);

create table if not exists public.ml_p0_phase3_remote_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_p0_phase3_runs(id) on delete restrict,
  sku text not null,
  ml_item_id text not null,
  match_type text not null check (match_type in (
    'EXACT_MATCH', 'STRONG_MATCH', 'CATALOG_MATCH', 'VARIATION_MATCH',
    'DUPLICATE_REMOTE', 'WRONG_LOCAL_LINK', 'POSSIBLE_MATCH', 'NOT_MATCH'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, sku, ml_item_id)
);

create index if not exists idx_ml_p0_phase3_remote_match
  on public.ml_p0_phase3_remote_items (run_id, match_type, confidence desc);

alter table public.ml_p0_phase3_runs enable row level security;
alter table public.ml_p0_phase3_results enable row level security;
alter table public.ml_p0_phase3_remote_items enable row level security;

revoke all on table public.ml_p0_phase3_runs from anon, authenticated;
revoke all on table public.ml_p0_phase3_results from anon, authenticated;
revoke all on table public.ml_p0_phase3_remote_items from anon, authenticated;

grant select, insert, update on table public.ml_p0_phase3_runs to service_role;
grant select, insert on table public.ml_p0_phase3_results to service_role;
grant select, insert on table public.ml_p0_phase3_remote_items to service_role;
