begin;

create extension if not exists supabase_vault with schema vault;

do $migration$
declare
  v_plaintext_secret text;
  v_vault_secret_id uuid;
begin
  select value
    into v_plaintext_secret
  from public.sync_runtime_config
  where key = 'api_secret_key';

  if nullif(btrim(v_plaintext_secret), '') is not null then
    select id
      into v_vault_secret_id
    from vault.secrets
    where name = 'vortek.runtime.api_secret_key';

    if v_vault_secret_id is null then
      perform vault.create_secret(
        v_plaintext_secret,
        'vortek.runtime.api_secret_key',
        'Vortek runtime API key',
        null
      );
    else
      perform vault.update_secret(
        v_vault_secret_id,
        v_plaintext_secret,
        'vortek.runtime.api_secret_key',
        'Vortek runtime API key',
        null
      );
    end if;

    delete from public.sync_runtime_config
    where key = 'api_secret_key';
  elsif v_plaintext_secret is not null then
    raise exception 'api_secret_key vazio em public.sync_runtime_config';
  end if;
end;
$migration$;

alter table public.sync_runtime_config
  drop constraint if exists sync_runtime_config_disallow_api_secret_key;

alter table public.sync_runtime_config
  add constraint sync_runtime_config_disallow_api_secret_key
  check (key <> 'api_secret_key');

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
    url := 'https://app.vortek.shop/api/sync/cron-dispatch',
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
    url := 'https://app.vortek.shop/api/sync/run',
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

create or replace function private.dispatch_catalog_price_refresh_cron()
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_api_key text;
  v_job_id uuid;
  v_request_id bigint;
  v_worker_host text;
  v_worker_url text;
begin
  select id
    into v_job_id
  from public.jobs
  where tipo = 'catalogo_no_catalogo_refresh'
    and status in ('pendente', 'on_hold')
  order by created_at
  limit 1;

  if v_job_id is null then
    return;
  end if;

  select trim(value)
    into v_worker_url
  from public.sync_runtime_config
  where key = 'catalog_refresh_worker_url';

  if v_worker_url is null or v_worker_url = '' then
    raise exception 'dispatch_catalog_price_refresh_cron: catalog_refresh_worker_url ausente';
  end if;

  if v_worker_url !~ '^https://[^/?#]+/api/catalogo/no-catalogo/refresh/job/worker$'
    and v_worker_url !~ '^http://(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})(:[0-9]+)?/api/catalogo/no-catalogo/refresh/job/worker$'
  then
    raise exception 'dispatch_catalog_price_refresh_cron: catalog_refresh_worker_url invalida';
  end if;

  select lower(trim(value))
    into v_worker_host
  from public.sync_runtime_config
  where key = 'catalog_refresh_worker_host';

  if v_worker_host is null
    or v_worker_host = ''
    or v_worker_host !~ '(^[a-z0-9]$)|(^[a-z0-9][a-z0-9.-]*[a-z0-9]$)'
  then
    raise exception 'dispatch_catalog_price_refresh_cron: catalog_refresh_worker_host ausente ou invalido';
  end if;

  select decrypted_secret
    into v_api_key
  from vault.decrypted_secrets
  where name = 'vortek.runtime.api_secret_key';

  if v_api_key is null or length(trim(v_api_key)) = 0 then
    raise exception 'dispatch_catalog_price_refresh_cron: runtime API key ausente no Vault';
  end if;

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Host', v_worker_host,
      'X-Forwarded-Proto', 'https',
      'x-api-key', v_api_key
    ),
    body := jsonb_build_object('jobId', v_job_id),
    timeout_milliseconds := 300000
  ) into v_request_id;
end;
$$;

revoke all on function private.dispatch_catalog_price_refresh_cron() from public, anon, authenticated, service_role;
grant execute on function private.dispatch_catalog_price_refresh_cron() to postgres;

commit;
