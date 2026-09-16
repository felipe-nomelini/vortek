set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.pricing_batch_runs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  screening_sha256 text not null check (screening_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references public.profiles(id),
  state text not null default 'prepared' check (state in ('prepared','running','completed','stopped')),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (code, manifest_sha256)
);

create table public.pricing_batch_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pricing_batch_runs(id) on delete restrict,
  sku text not null,
  ml_item_id text not null check (ml_item_id ~ '^MLB[0-9]+$'),
  sequence integer not null check (sequence > 0),
  final_state text check (final_state in (
    'SKIP_ALREADY_WINNING','BUY_BOX_ECONOMICAMENTE_ATACAVEL','BUY_BOX_ATACAVEL_COM_OTIMIZACAO',
    'CONFLITO_ECONOMICO_DE_BUY_BOX','BLOQUEADO_DADO_ECONOMICO','DRIFT_BLOCKED',
    'UPDATED_OK','FAILED_WRITE','FAILED_READBACK','ROLLED_BACK'
  )),
  decision jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  readback jsonb,
  error jsonb,
  evaluation_id uuid references public.pricing_evaluations(id),
  decision_id uuid references public.pricing_decisions(id),
  operation_id uuid references public.pricing_operations(id),
  experiment_id uuid,
  evaluated_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (run_id, ml_item_id),
  unique (run_id, sequence)
);

create index pricing_batch_items_run_state
  on public.pricing_batch_items(run_id, final_state, sequence);

create table public.pricing_experiments (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  batch_item_id uuid not null unique references public.pricing_batch_items(id) on delete restrict,
  operation_id uuid not null unique references public.pricing_operations(id) on delete restrict,
  evaluation_id uuid not null references public.pricing_evaluations(id),
  produto_id uuid not null references public.produtos(id),
  seller_id text not null check (seller_id ~ '^[0-9]+$'),
  ml_item_id text not null check (ml_item_id ~ '^MLB[0-9]+$'),
  group_id uuid not null references public.ml_pricing_groups(id),
  group_version integer not null check (group_version > 0),
  actor_id uuid not null references public.profiles(id),
  state text not null default 'running' check (state in ('running','completed','interrupted','safety_stopped')),
  baseline jsonb not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.pricing_batch_items
  add constraint pricing_batch_items_experiment_fkey
  foreign key (experiment_id) references public.pricing_experiments(id) on delete restrict;

create table public.pricing_experiment_checkpoints (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.pricing_experiments(id) on delete restrict,
  checkpoint text not null check (checkpoint in ('D1','D3','D7')),
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','processing','completed','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  observation jsonb,
  error_code text,
  captured_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (experiment_id, checkpoint)
);

create index pricing_experiment_checkpoints_due
  on public.pricing_experiment_checkpoints(due_at, id)
  where state = 'pending';

create or replace function public.claim_due_pricing_experiment_checkpoints(p_limit integer default 5)
returns setof public.pricing_experiment_checkpoints
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'pricing_experiment_checkpoint_limit_invalid';
  end if;
  return query
    with due as (
      select c.id
      from public.pricing_experiment_checkpoints c
      join public.pricing_experiments e on e.id = c.experiment_id
      where c.state = 'pending' and c.due_at <= clock_timestamp() and e.state = 'running'
      order by c.due_at, c.id
      for update of c skip locked
      limit p_limit
    )
    update public.pricing_experiment_checkpoints c
      set state = 'processing', attempts = attempts + 1, updated_at = clock_timestamp()
    from due
    where c.id = due.id
    returning c.*;
end $$;

alter table public.pricing_batch_runs enable row level security;
alter table public.pricing_batch_items enable row level security;
alter table public.pricing_experiments enable row level security;
alter table public.pricing_experiment_checkpoints enable row level security;

revoke all on public.pricing_batch_runs, public.pricing_batch_items,
  public.pricing_experiments, public.pricing_experiment_checkpoints
  from public, anon, authenticated, service_role;
grant select, insert, update on public.pricing_batch_runs, public.pricing_batch_items,
  public.pricing_experiments, public.pricing_experiment_checkpoints to service_role;
revoke all on function public.claim_due_pricing_experiment_checkpoints(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_pricing_experiment_checkpoints(integer) to service_role;
