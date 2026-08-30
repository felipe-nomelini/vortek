-- DB-03 hardening: make the Data API authorization boundary explicit.
--
-- Exact rollback (reopens the DB-03 findings; DEV only and only with explicit
-- authorization): disable RLS on the three WhatsApp event tables, restore the
-- grants/default privileges captured in the pre-hardening DB-03 snapshot,
-- recreate the four kit policies from 20260714193934_kit_inventory.sql, grant
-- the three search RPCs back to authenticated, and restore each previous
-- function search_path recorded in the snapshot.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Every table exposed through PostgREST must declare its RLS posture.
alter table public.ops_whatsapp_events enable row level security;
alter table public.whatsapp_alert_events enable row level security;
alter table public.whatsapp_alert_settings enable row level security;

-- Client roles access application data through Next.js APIs. Reset current
-- relation/sequence privileges, then restore the one direct client contract.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (nome, avatar_url) on table public.profiles to authenticated;

-- Prevent future postgres-owned objects from inheriting the residual PG17
-- privileges (MAINTAIN, REFERENCES, TRIGGER, TRUNCATE and sequence UPDATE).
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;

-- These privileged RPCs are consumed only by service_role-backed APIs/scripts.
revoke execute on function public.search_pedidos_paginated(
  text,
  public.pedido_status,
  timestamptz,
  timestamptz,
  numeric,
  numeric,
  integer,
  integer,
  text,
  text
) from authenticated;

revoke execute on function public.search_produtos_paginated(
  text,
  text[],
  boolean,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  integer,
  integer,
  text,
  text
) from authenticated;

revoke execute on function public.search_produtos_resumo(
  text,
  text[],
  boolean,
  text,
  text,
  text,
  numeric,
  numeric,
  text
) from authenticated;

-- All application relations referenced by these SECURITY DEFINER functions
-- are schema-qualified, so only trusted system schemas remain in search_path.
alter function public.acquire_integracao_refresh_lock(
  public.integracao_tipo,
  text,
  integer
) set search_path = pg_catalog, pg_temp;

alter function public.release_integracao_refresh_lock(
  public.integracao_tipo,
  text
) set search_path = pg_catalog, pg_temp;

alter function public.acquire_sync_domain_lock(
  text,
  text,
  text,
  uuid,
  integer,
  jsonb
) set search_path = pg_catalog, pg_temp;

alter function public.release_sync_domain_lock(
  text,
  text,
  boolean
) set search_path = pg_catalog, pg_temp;

alter function public.search_pedidos_paginated(
  text,
  public.pedido_status,
  timestamptz,
  timestamptz,
  numeric,
  numeric,
  integer,
  integer,
  text,
  text
) set search_path = pg_catalog, pg_temp;

alter function public.search_pedidos_resumo(
  text,
  public.pedido_status,
  timestamptz,
  timestamptz,
  numeric,
  numeric
) set search_path = pg_catalog, pg_temp;

alter function public.search_produtos_paginated(
  text,
  text[],
  boolean,
  text,
  text,
  text,
  numeric,
  numeric,
  text,
  integer,
  integer,
  text,
  text
) set search_path = pg_catalog, pg_temp;

alter function public.search_produtos_resumo(
  text,
  text[],
  boolean,
  text,
  text,
  text,
  numeric,
  numeric,
  text
) set search_path = pg_catalog, pg_temp;

alter function private.capture_ml_p0_population(
  uuid,
  integer,
  integer,
  integer,
  integer
) set search_path = pg_catalog, pg_temp;

-- Kits are backend-only. RLS without client policies is the intended contract.
drop policy if exists "Todos podem ver kits de produto" on public.produto_kits;
drop policy if exists "Admin pode gerenciar kits de produto" on public.produto_kits;
drop policy if exists "Todos podem ver componentes de kit" on public.produto_kit_componentes;
drop policy if exists "Admin pode gerenciar componentes de kit" on public.produto_kit_componentes;

notify pgrst, 'reload schema';
