-- JOB-01: keep the durable catalog worker environment-specific and observable.
-- This migration deliberately preserves the existing cron schedule and active flag.

create or replace function private.dispatch_catalog_price_refresh_cron()
returns void
language plpgsql
security definer
set search_path = public
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

  select value
    into v_api_key
  from public.sync_runtime_config
  where key = 'api_secret_key';

  if v_api_key is null or length(trim(v_api_key)) = 0 then
    raise exception 'dispatch_catalog_price_refresh_cron: api_secret_key ausente';
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

revoke all on function private.dispatch_catalog_price_refresh_cron() from public;
grant execute on function private.dispatch_catalog_price_refresh_cron() to postgres;
