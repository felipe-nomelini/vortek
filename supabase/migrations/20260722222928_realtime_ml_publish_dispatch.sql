create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists private;

create or replace function private.dispatch_ml_publish_cron()
returns void
language plpgsql
security definer
set search_path = public
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
  ) then
    return;
  end if;

  select value
    into v_api_key
  from public.sync_runtime_config
  where key = 'api_secret_key';

  if v_api_key is null or length(trim(v_api_key)) = 0 then
    raise warning 'dispatch_ml_publish_cron: api_secret_key ausente em public.sync_runtime_config';
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
      'limit', 50
    )
  ) into v_request_id;
end;
$$;

revoke all on function private.dispatch_ml_publish_cron() from public;
grant execute on function private.dispatch_ml_publish_cron() to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname = 'vortek-ml-publish-dispatch';

select cron.schedule(
  'vortek-ml-publish-dispatch',
  '15 seconds',
  $$select private.dispatch_ml_publish_cron();$$
);
