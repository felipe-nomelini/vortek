create table if not exists public.ml_catalog_identity_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid null references public.jobs(id) on delete set null,
  state text not null default 'imported' check (state in (
    'imported','queued','running','awaiting_approval','approved','applying','paused','completed','failed'
  )),
  mode text not null default 'dry_run' check (mode in ('dry_run','apply')),
  rule_version text not null,
  baseline_filename text not null,
  baseline_sha256 text not null check (baseline_sha256 ~ '^[a-f0-9]{64}$'),
  baseline_count integer not null check (baseline_count >= 0),
  delta_count integer not null default 0 check (delta_count >= 0),
  total_count integer not null default 0 check (total_count >= 0),
  manifest_hash text null check (manifest_hash is null or manifest_hash ~ '^[a-f0-9]{64}$'),
  approved_manifest_hash text null check (approved_manifest_hash is null or approved_manifest_hash ~ '^[a-f0-9]{64}$'),
  snapshot_at timestamptz null,
  started_at timestamptz null,
  finished_at timestamptz null,
  approved_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.profiles(id),
  approved_by uuid null references public.profiles(id),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  safety_stop jsonb null check (safety_stop is null or jsonb_typeof(safety_stop) = 'object')
);

create table if not exists public.ml_catalog_identity_audits (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ml_catalog_identity_runs(id) on delete cascade,
  seller_id bigint null,
  ml_item_id text not null check (ml_item_id ~ '^MLB[0-9]+$'),
  ordinal integer not null check (ordinal >= 0),
  source_origin text not null check (source_origin in ('baseline','delta_vivo','ambos')),
  processing_state text not null default 'pending' check (processing_state in ('pending','processing','processed','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  produto_id uuid null references public.produtos(id) on delete set null,
  sku text null,
  ml_item_id_related text null,
  catalog_product_id text null,
  pricing_group_id uuid null references public.ml_pricing_groups(id) on delete set null,
  identity_state text null check (identity_state is null or identity_state in (
    'SEM_CONFLITO','CONFLITO_CONFIRMADO','PENDENCIA_VALIDACAO','INCONCLUSIVO'
  )),
  reason_code text null,
  conflict_type text null,
  risk_tier text null check (risk_tier is null or risk_tier in ('CRITICO','ALTO','MEDIO','BAIXO')),
  gap_pct numeric(9,4) null,
  material_fingerprint text null check (material_fingerprint is null or material_fingerprint ~ '^[a-f0-9]{64}$'),
  ml_live_source_required boolean not null default true,
  ml_live_source_available boolean not null default false,
  block_price_write boolean not null default true,
  block_buy_box_chase boolean not null default true,
  produtos_ativo_before boolean null,
  produtos_ativo_after boolean null,
  old_relation jsonb not null default '{}'::jsonb check (jsonb_typeof(old_relation) = 'object'),
  proposed_relation jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_relation) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  comparisons jsonb not null default '[]'::jsonb check (jsonb_typeof(comparisons) = 'array'),
  input_row jsonb not null default '{}'::jsonb check (jsonb_typeof(input_row) = 'object'),
  old_price numeric(14,2) null,
  new_price numeric(14,2) null,
  pricing_source text null,
  rule_id text not null default 'BNT-ML-CATALOG-IDENTITY-01',
  action text null,
  action_result text null,
  ml_readback jsonb null check (ml_readback is null or jsonb_typeof(ml_readback) = 'object'),
  error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (run_id, ml_item_id)
);

create table if not exists public.ml_catalog_identity_current (
  seller_id bigint not null,
  ml_item_id text not null check (ml_item_id ~ '^MLB[0-9]+$'),
  audit_id bigint not null references public.ml_catalog_identity_audits(id) on delete restrict,
  identity_state text not null check (identity_state in (
    'SEM_CONFLITO','CONFLITO_CONFIRMADO','PENDENCIA_VALIDACAO','INCONCLUSIVO'
  )),
  reason_code text not null,
  material_fingerprint text not null check (material_fingerprint ~ '^[a-f0-9]{64}$'),
  ml_live_source_available boolean not null,
  block_price_write boolean not null,
  block_buy_box_chase boolean not null,
  observed_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (seller_id, ml_item_id)
);

create table if not exists public.ml_catalog_identity_actions (
  id uuid primary key default gen_random_uuid(),
  audit_id bigint not null references public.ml_catalog_identity_audits(id) on delete restrict,
  command_id uuid not null unique,
  action_type text not null check (action_type in (
    'NO_ACTION','FIX_LOCAL_LINK','CREATE_CORRECT_CATALOG_LISTING','PAUSE_WRONG_CATALOG_LISTING','MANUAL_REVIEW'
  )),
  state text not null default 'planned' check (state in (
    'planned','requires_confirmation','approved','processing','confirmed','inconclusive','failed','rolled_back'
  )),
  expected_fingerprint text not null check (expected_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references public.profiles(id),
  approved_by uuid null references public.profiles(id),
  reason text not null check (length(trim(reason)) between 1 and 500),
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb check (jsonb_typeof(after_state) = 'object'),
  readback jsonb null check (readback is null or jsonb_typeof(readback) = 'object'),
  rollback_plan jsonb not null default '{}'::jsonb check (jsonb_typeof(rollback_plan) = 'object'),
  error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists ml_catalog_identity_runs_state_idx
  on public.ml_catalog_identity_runs (state, created_at desc);
create index if not exists ml_catalog_identity_audits_queue_idx
  on public.ml_catalog_identity_audits (run_id, processing_state, ordinal)
  where processing_state in ('pending','processing');
create index if not exists ml_catalog_identity_audits_identity_idx
  on public.ml_catalog_identity_audits (run_id, identity_state, risk_tier, ordinal);
create index if not exists ml_catalog_identity_audits_catalog_product_idx
  on public.ml_catalog_identity_audits (catalog_product_id, run_id)
  where catalog_product_id is not null;
create index if not exists ml_catalog_identity_audits_product_idx
  on public.ml_catalog_identity_audits (produto_id, run_id)
  where produto_id is not null;
create index if not exists ml_catalog_identity_current_audit_idx
  on public.ml_catalog_identity_current (audit_id);
create index if not exists ml_catalog_identity_current_blocked_idx
  on public.ml_catalog_identity_current (identity_state, seller_id, ml_item_id)
  where block_price_write = true;
create index if not exists ml_catalog_identity_actions_queue_idx
  on public.ml_catalog_identity_actions (state, created_at)
  where state in ('planned','requires_confirmation','approved','processing','inconclusive');
create index if not exists ml_catalog_identity_actions_audit_idx
  on public.ml_catalog_identity_actions (audit_id, created_at desc);

alter table public.ml_catalog_identity_runs enable row level security;
alter table public.ml_catalog_identity_audits enable row level security;
alter table public.ml_catalog_identity_current enable row level security;
alter table public.ml_catalog_identity_actions enable row level security;

revoke all on table public.ml_catalog_identity_runs from public, anon, authenticated;
revoke all on table public.ml_catalog_identity_audits from public, anon, authenticated;
revoke all on table public.ml_catalog_identity_current from public, anon, authenticated;
revoke all on table public.ml_catalog_identity_actions from public, anon, authenticated;
grant select, insert, update on table public.ml_catalog_identity_runs to service_role;
grant select, insert, update on table public.ml_catalog_identity_audits to service_role;
grant select, insert, update on table public.ml_catalog_identity_current to service_role;
grant select, insert, update on table public.ml_catalog_identity_actions to service_role;
grant usage, select on sequence public.ml_catalog_identity_audits_id_seq to service_role;

create or replace function public.assert_ml_catalog_identity_price_guard(
  p_seller_id bigint,
  p_item_id text,
  p_target_origin text,
  p_audit_id bigint default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.ml_catalog_identity_current%rowtype;
begin
  if p_target_origin = 'manual_input' then
    return;
  end if;
  if p_target_origin not in ('price_to_win','rule','existing_price') then
    raise exception 'ml_identity_target_origin_invalid';
  end if;
  select * into current_row
  from public.ml_catalog_identity_current
  where seller_id = p_seller_id and ml_item_id = p_item_id;
  if current_row.ml_item_id is null
    or current_row.identity_state <> 'SEM_CONFLITO'
    or current_row.block_price_write
    or not current_row.ml_live_source_available
    or (p_audit_id is not null and current_row.audit_id <> p_audit_id)
  then
    raise exception 'ml_identity_price_write_blocked';
  end if;
end;
$$;

create or replace function public.enforce_ml_catalog_identity_outbox_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_origin text;
  seller bigint;
  audit bigint;
begin
  if new.desired_price is null then
    return new;
  end if;
  target_origin := nullif(new.payload->>'target_origin','');
  if target_origin is null and new.source = 'pricing_decision' and exists (
    select 1 from public.pricing_operations operation
    where operation.id = new.pricing_operation_id
      and operation.source = 'manual'
      and operation.actor_id is not null
  ) then
    target_origin := 'manual_input';
  end if;
  target_origin := coalesce(target_origin, 'rule');
  if target_origin = 'manual_input' then
    return new;
  end if;
  select snapshot.seller_id into seller
  from public.catalogo_ml_snapshot snapshot
  where snapshot.ml_item_id = new.ml_item_id;
  audit := nullif(new.payload->>'identity_audit_id','')::bigint;
  if seller is null then
    raise exception 'ml_identity_seller_unavailable';
  end if;
  perform public.assert_ml_catalog_identity_price_guard(seller, new.ml_item_id, target_origin, audit);
  return new;
end;
$$;

drop trigger if exists trg_ml_catalog_identity_outbox_guard on public.anuncios_ml_outbox;
create trigger trg_ml_catalog_identity_outbox_guard
before insert or update of desired_price, payload, source on public.anuncios_ml_outbox
for each row execute function public.enforce_ml_catalog_identity_outbox_guard();

create or replace function public.invalidate_ml_catalog_identity_on_snapshot_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    old.produto_id is distinct from new.produto_id
    or old.sku_local is distinct from new.sku_local
    or old.seller_sku is distinct from new.seller_sku
    or old.catalog_product_id is distinct from new.catalog_product_id
    or old.related_item_id is distinct from new.related_item_id
    or old.title is distinct from new.title
  ) then
    update public.ml_catalog_identity_current
    set identity_state = 'PENDENCIA_VALIDACAO',
        reason_code = 'FINGERPRINT_MATERIAL_ALTERADO',
        block_price_write = true,
        block_buy_box_chase = true,
        ml_live_source_available = false,
        updated_at = clock_timestamp()
    where seller_id = new.seller_id and ml_item_id = new.ml_item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invalidate_ml_catalog_identity on public.catalogo_ml_snapshot;
create trigger trg_invalidate_ml_catalog_identity
after update of produto_id,sku_local,seller_sku,catalog_product_id,related_item_id,title
on public.catalogo_ml_snapshot
for each row execute function public.invalidate_ml_catalog_identity_on_snapshot_change();

revoke all on function public.assert_ml_catalog_identity_price_guard(bigint,text,text,bigint) from public,anon,authenticated;
revoke all on function public.enforce_ml_catalog_identity_outbox_guard() from public,anon,authenticated;
revoke all on function public.invalidate_ml_catalog_identity_on_snapshot_change() from public,anon,authenticated;
grant execute on function public.assert_ml_catalog_identity_price_guard(bigint,text,text,bigint) to service_role;
grant execute on function public.enforce_ml_catalog_identity_outbox_guard() to service_role;
grant execute on function public.invalidate_ml_catalog_identity_on_snapshot_change() to service_role;

create or replace function public.claim_ml_catalog_identity_audit_batch(
  p_run_id uuid,
  p_limit integer default 20
) returns setof public.ml_catalog_identity_audits
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 20 then
    raise exception 'ml_catalog_identity_batch_limit_invalid';
  end if;
  return query
  update public.ml_catalog_identity_audits audit
  set processing_state = 'processing',
      attempts = audit.attempts + 1,
      started_at = coalesce(audit.started_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where audit.id in (
    select candidate.id
    from public.ml_catalog_identity_audits candidate
    where candidate.run_id = p_run_id
      and candidate.processing_state = 'pending'
      and candidate.attempts < 3
    order by candidate.ordinal, candidate.id
    limit p_limit
    for update skip locked
  )
  returning audit.*;
end;
$$;

revoke all on function public.claim_ml_catalog_identity_audit_batch(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_ml_catalog_identity_audit_batch(uuid,integer) to service_role;

notify pgrst, 'reload schema';
