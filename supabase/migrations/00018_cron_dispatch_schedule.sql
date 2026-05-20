create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.sync_runtime_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.sync_runtime_config enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'sync_runtime_config'
      and policyname = 'sync_runtime_config_deny_all'
  ) then
    create policy sync_runtime_config_deny_all
      on public.sync_runtime_config
      for all
      using (false)
      with check (false);
  end if;
end $$;

create or replace function public.dispatch_sync_cron()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_api_key text;
  v_request_id bigint;
begin
  select value
    into v_api_key
  from public.sync_runtime_config
  where key = 'api_secret_key';

  if v_api_key is null or length(trim(v_api_key)) = 0 then
    raise warning 'dispatch_sync_cron: api_secret_key ausente em public.sync_runtime_config';
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

revoke all on function public.dispatch_sync_cron() from public;
grant execute on function public.dispatch_sync_cron() to postgres;

-- Recria o job de 5 em 5 minutos
select cron.unschedule(jobid)
from cron.job
where jobname = 'vortek-sync-cron-dispatch';

select cron.schedule(
  'vortek-sync-cron-dispatch',
  '*/5 * * * *',
  $$select public.dispatch_sync_cron();$$
);
