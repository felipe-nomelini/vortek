alter table public.jobs
  add column if not exists dedupe_key text null;

comment on column public.jobs.dedupe_key is
  'Chave lógica usada para impedir jobs ativos duplicados do mesmo recurso.';

create unique index if not exists idx_jobs_active_dedupe_key
  on public.jobs (tipo, dedupe_key)
  where dedupe_key is not null
    and status in ('pendente', 'rodando', 'on_hold');

create index if not exists idx_jobs_ml_order_hydration_queue
  on public.jobs (created_at)
  where tipo = 'ml_orders_v2_hydration'
    and status in ('pendente', 'rodando', 'on_hold');
