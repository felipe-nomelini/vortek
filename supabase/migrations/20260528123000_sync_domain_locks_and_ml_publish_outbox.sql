create extension if not exists pgcrypto;

create table if not exists public.sync_domain_locks (
  domain text primary key,
  owner_task text not null,
  owner_token text not null,
  owner_job_id uuid null references public.jobs(id) on delete set null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sync_domain_locks_expires_at
  on public.sync_domain_locks (expires_at);

drop trigger if exists set_updated_at_sync_domain_locks on public.sync_domain_locks;
create trigger set_updated_at_sync_domain_locks
before update on public.sync_domain_locks
for each row execute function public.set_updated_at();

create or replace function public.acquire_sync_domain_lock(
  p_domain text,
  p_owner_task text,
  p_owner_token text,
  p_owner_job_id uuid default null,
  p_ttl_seconds integer default 900,
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ttl_seconds integer;
  v_exp timestamptz;
  v_rows integer;
begin
  v_ttl_seconds := greatest(30, coalesce(p_ttl_seconds, 900));
  v_exp := now() + make_interval(secs => v_ttl_seconds);

  insert into public.sync_domain_locks (
    domain,
    owner_task,
    owner_token,
    owner_job_id,
    acquired_at,
    expires_at,
    metadata,
    created_at,
    updated_at
  )
  values (
    p_domain,
    coalesce(nullif(trim(p_owner_task), ''), 'unknown'),
    p_owner_token,
    p_owner_job_id,
    now(),
    v_exp,
    coalesce(p_metadata, '{}'::jsonb),
    now(),
    now()
  )
  on conflict (domain)
  do update set
    owner_task = excluded.owner_task,
    owner_token = excluded.owner_token,
    owner_job_id = excluded.owner_job_id,
    acquired_at = now(),
    expires_at = excluded.expires_at,
    metadata = excluded.metadata,
    updated_at = now()
  where
    public.sync_domain_locks.expires_at < now()
    or public.sync_domain_locks.owner_token = p_owner_token;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.release_sync_domain_lock(
  p_domain text,
  p_owner_token text,
  p_force boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  delete from public.sync_domain_locks
  where domain = p_domain
    and (p_force or owner_token = p_owner_token);

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.acquire_sync_domain_lock(text, text, text, uuid, integer, jsonb) to service_role;
grant execute on function public.release_sync_domain_lock(text, text, boolean) to service_role;

create table if not exists public.anuncios_ml_outbox (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  ml_item_id text not null,
  desired_status public.ml_status null,
  desired_price numeric(10,2) null,
  desired_quantity integer null,
  source text not null default 'local',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text null,
  available_at timestamptz not null default now(),
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_anuncios_ml_outbox_status_available
  on public.anuncios_ml_outbox (status, available_at, created_at);

create index if not exists idx_anuncios_ml_outbox_ml_item_id
  on public.anuncios_ml_outbox (ml_item_id);

drop trigger if exists set_updated_at_anuncios_ml_outbox on public.anuncios_ml_outbox;
create trigger set_updated_at_anuncios_ml_outbox
before update on public.anuncios_ml_outbox
for each row execute function public.set_updated_at();
