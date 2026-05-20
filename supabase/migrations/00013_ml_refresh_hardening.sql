-- Hardening Mercado Livre token refresh flow
-- - Ensures a single integration row per tipo
-- - Adds refresh telemetry columns
-- - Adds lock lease helpers for concurrent refresh control

-- 1) Keep only newest row per tipo (defensive cleanup)
with ranked as (
  select
    id,
    row_number() over (
      partition by tipo
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.integracoes
)
delete from public.integracoes i
using ranked r
where i.id = r.id
  and r.rn > 1;

-- 2) Add telemetry + lease columns
alter table public.integracoes
  add column if not exists last_refresh_at timestamptz,
  add column if not exists last_refresh_error text,
  add column if not exists last_refresh_error_code text,
  add column if not exists refresh_lock_token text,
  add column if not exists refresh_lock_until timestamptz;

-- 3) Enforce uniqueness by tipo
create unique index if not exists integracoes_tipo_unique_idx on public.integracoes (tipo);

-- 4) Lock helpers (RPC-safe)
create or replace function public.acquire_integracao_refresh_lock(
  p_tipo public.integracao_tipo,
  p_owner text,
  p_ttl_seconds integer default 25
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.integracoes
  set
    refresh_lock_token = p_owner,
    refresh_lock_until = now() + make_interval(secs => greatest(p_ttl_seconds, 5)),
    updated_at = now()
  where tipo = p_tipo
    and (
      refresh_lock_until is null
      or refresh_lock_until < now()
      or refresh_lock_token = p_owner
    );

  return found;
end;
$$;

create or replace function public.release_integracao_refresh_lock(
  p_tipo public.integracao_tipo,
  p_owner text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.integracoes
  set
    refresh_lock_token = null,
    refresh_lock_until = null,
    updated_at = now()
  where tipo = p_tipo
    and refresh_lock_token = p_owner;

  return found;
end;
$$;

grant execute on function public.acquire_integracao_refresh_lock(public.integracao_tipo, text, integer) to service_role;
grant execute on function public.release_integracao_refresh_lock(public.integracao_tipo, text) to service_role;
