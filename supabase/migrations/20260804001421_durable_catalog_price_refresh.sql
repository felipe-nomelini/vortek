create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists private;

alter table public.catalogo_ml_snapshot
  add column if not exists refresh_job_id uuid null references public.jobs(id) on delete set null;

create index if not exists idx_catalogo_ml_snapshot_refresh_job
  on public.catalogo_ml_snapshot (seller_id, refresh_job_id)
  where catalog_listing = true;

create table if not exists public.catalogo_ml_refresh_items (
  job_id uuid not null references public.jobs(id) on delete cascade,
  seller_id bigint not null,
  ml_item_id text not null,
  ordinal integer not null,
  attempts integer not null default 0,
  processed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, ml_item_id)
);

alter table public.catalogo_ml_refresh_items enable row level security;

create index if not exists idx_catalogo_ml_refresh_items_pending
  on public.catalogo_ml_refresh_items (job_id, ordinal)
  where processed_at is null;

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

  select value
    into v_api_key
  from public.sync_runtime_config
  where key = 'api_secret_key';

  if v_api_key is null or length(trim(v_api_key)) = 0 then
    raise warning 'dispatch_catalog_price_refresh_cron: api_secret_key ausente';
    return;
  end if;

  select net.http_post(
    url := 'https://app.vortek.shop/api/catalogo/no-catalogo/refresh/job/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key', v_api_key
    ),
    body := jsonb_build_object('jobId', v_job_id)
  ) into v_request_id;
end;
$$;

revoke all on function private.dispatch_catalog_price_refresh_cron() from public;
grant execute on function private.dispatch_catalog_price_refresh_cron() to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname = 'vortek-catalog-price-refresh';

select cron.schedule(
  'vortek-catalog-price-refresh',
  '15 seconds',
  $$select private.dispatch_catalog_price_refresh_cron();$$
);
