create table if not exists public.ml_p0_sanitize_runs (
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null references public.jobs(id) on delete restrict,
  mode text not null default 'AUDIT_ONLY' check (mode = 'AUDIT_ONLY'),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  source_population_hash text not null,
  expected_reprocess_count integer not null default 408,
  infrastructure_metrics jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ml_p0_sanitize_runs_source_job
  on public.ml_p0_sanitize_runs (source_job_id, started_at desc);

create table if not exists public.ml_p0_sanitize_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ml_p0_sanitize_runs(id) on delete restrict,
  phase1_audit_id uuid not null references public.ml_p0_publication_audits(id) on delete restrict,
  population_snapshot_id uuid not null references public.ml_p0_population_snapshots(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  sku text not null,
  fornecedor_id text not null,
  fornecedor_nome text not null,
  previous_status text not null,
  previous_error text,
  source_status text not null check (source_status in (
    'SOURCE_LOOKUP_DEFERRED', 'SOURCE_NOT_FOUND', 'SOURCE_FOUND_OFFICIAL',
    'SOURCE_FOUND_SECONDARY', 'SOURCE_CONFLICT', 'SOURCE_IDENTITY_MISMATCH'
  )),
  gtin_status text check (gtin_status is null or gtin_status in (
    'GTIN_NOT_REQUIRED', 'GTIN_NOT_FOUND', 'GTIN_SUPPLIER_MISSING',
    'GTIN_IDENTITY_BLOCKED', 'GTIN_LOOKUP_BLOCKED', 'GTIN_CONFIRMED_ABSENT'
  )),
  remote_lookup_status text not null,
  remote_listing_found boolean not null default false,
  structural_score integer not null check (structural_score between 0 and 100),
  documentary_score integer check (documentary_score between 0 and 100),
  publication_score integer not null check (publication_score between 0 and 100),
  new_status text not null check (new_status in (
    'P0_READY', 'P0_MANUAL_GTIN', 'P0_MANUAL_IDENTITY', 'P0_MANUAL_IMAGE',
    'P0_MANUAL_TECH', 'SOURCE_LOOKUP_DEFERRED', 'SOURCE_NOT_FOUND', 'OUTROS'
  )),
  block_reason text,
  audit_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, produto_id),
  unique (run_id, sku)
);

create index if not exists idx_ml_p0_sanitize_results_run_status
  on public.ml_p0_sanitize_results (run_id, new_status, fornecedor_id);
create index if not exists idx_ml_p0_sanitize_results_scores
  on public.ml_p0_sanitize_results (run_id, publication_score desc, structural_score desc);

alter table public.ml_p0_sanitize_runs enable row level security;
alter table public.ml_p0_sanitize_results enable row level security;

revoke all on table public.ml_p0_sanitize_runs from anon, authenticated;
revoke all on table public.ml_p0_sanitize_results from anon, authenticated;
grant select, insert, update on table public.ml_p0_sanitize_runs to service_role;
grant select, insert, update on table public.ml_p0_sanitize_results to service_role;

drop trigger if exists set_updated_at_ml_p0_sanitize_results on public.ml_p0_sanitize_results;
create trigger set_updated_at_ml_p0_sanitize_results
before update on public.ml_p0_sanitize_results
for each row execute function public.set_updated_at();
