begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
begin
  if exists (
    select 1
    from public.fornecedores
    where dslite_catalog_xml_url is not null
      and not (
        length(dslite_catalog_xml_url) <= 2048
        and dslite_id is not null
        and btrim(dslite_id) ~ '^[0-9]+$'
        and dslite_catalog_xml_url ~ '^https://app\.dslite\.com\.br/modules/admin/Empresa/getXMLCrossdocking/[0-9]+/[A-Za-z0-9_-]+/?$'
        and split_part(dslite_catalog_xml_url, '/', 8) = btrim(dslite_id)
        and length(split_part(dslite_catalog_xml_url, '/', 9)) between 16 and 256
      )
  ) then
    raise exception 'Existem feeds XML DSLite incompatíveis; migration interrompida';
  end if;
end;
$migration$;

alter table public.fornecedores
  drop constraint if exists fornecedores_dslite_catalog_xml_url_check;

alter table public.fornecedores
  add constraint fornecedores_dslite_catalog_xml_url_check check (
    dslite_catalog_xml_url is null
    or (
      length(dslite_catalog_xml_url) <= 2048
      and dslite_id is not null
      and btrim(dslite_id) ~ '^[0-9]+$'
      and dslite_catalog_xml_url ~ '^https://app\.dslite\.com\.br/modules/admin/Empresa/getXMLCrossdocking/[0-9]+/[A-Za-z0-9_-]+/?$'
      and split_part(dslite_catalog_xml_url, '/', 8) = btrim(dslite_id)
      and length(split_part(dslite_catalog_xml_url, '/', 9)) between 16 and 256
    )
  );

create or replace function public.dispatch_sync_cron()
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_api_key text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_api_key
  from vault.decrypted_secrets
  where name = 'vortek.runtime.api_secret_key';

  if v_api_key is null or length(trim(v_api_key)) = 0 then
    raise warning 'dispatch_sync_cron: runtime API key ausente no Vault';
    return;
  end if;

  select net.http_post(
    url := 'https://app.bentevi.shop/api/sync/cron-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', v_api_key
    ),
    body := '{}'::jsonb
  ) into v_request_id;
end;
$$;

revoke all on function public.dispatch_sync_cron() from public, anon, authenticated, service_role;
grant execute on function public.dispatch_sync_cron() to postgres;

create or replace function private.dispatch_ml_publish_cron()
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_api_key text;
  v_request_id bigint;
begin
  if not exists (
    select 1
    from public.anuncios_ml_outbox
    where status in ('pending', 'retry')
      and available_at <= now()
  ) and not exists (
    select 1
    from public.jobs
    where tipo = 'sync_ml_listings_publish'
      and status = 'on_hold'
  ) then
    return;
  end if;

  select decrypted_secret
    into v_api_key
  from vault.decrypted_secrets
  where name = 'vortek.runtime.api_secret_key';

  if v_api_key is null or length(trim(v_api_key)) = 0 then
    raise warning 'dispatch_ml_publish_cron: runtime API key ausente no Vault';
    return;
  end if;

  select net.http_post(
    url := 'https://app.bentevi.shop/api/sync/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', v_api_key
    ),
    body := jsonb_build_object(
      'taskKey', 'sync_ml_listings_publish',
      'limit', 20
    )
  ) into v_request_id;
end;
$$;

revoke all on function private.dispatch_ml_publish_cron() from public, anon, authenticated, service_role;
grant execute on function private.dispatch_ml_publish_cron() to postgres;

commit;
