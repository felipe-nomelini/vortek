-- Harden public schema Data API exposure.
-- Application data must be accessed through Next.js API routes using service_role.

do $$
declare
  tbl record;
begin
  for tbl in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table %I.%I enable row level security', tbl.schemaname, tbl.tablename);
    execute format('revoke all privileges on table %I.%I from anon', tbl.schemaname, tbl.tablename);
    execute format('revoke all privileges on table %I.%I from authenticated', tbl.schemaname, tbl.tablename);
    execute format('grant all privileges on table %I.%I to service_role', tbl.schemaname, tbl.tablename);
  end loop;
end $$;

-- Remove intentionally-public legacy policies that exposed operational data.
drop policy if exists "Todos podem ver produtos" on public.produtos;
drop policy if exists "Admin pode gerenciar produtos" on public.produtos;
drop policy if exists "Todos podem ver pedidos" on public.pedidos;
drop policy if exists "Todos podem ver clientes" on public.clientes;
drop policy if exists "Todos podem ver fornecedores" on public.fornecedores;
drop policy if exists "Todos podem ver pedido_itens" on public.pedido_itens;
drop policy if exists municipios_ibge_select_authenticated on public.municipios_ibge;

-- Profiles remain directly available only to the authenticated owner.
grant select, update on table public.profiles to authenticated;

-- Keep backend/database automation operational.
grant usage, select on all sequences in schema public to service_role;
revoke all privileges on all sequences in schema public from anon;
revoke all privileges on all sequences in schema public from authenticated;

grant execute on all functions in schema public to service_role;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
revoke execute on all functions in schema public from public;

-- Prevent future public tables/functions from becoming reachable by default.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
