-- Evita varreduras completas da tabela jobs nas consultas operacionais
-- executadas pelo cron-dispatch, telas de status e alertas.

create index if not exists idx_jobs_tipo_created_at
  on public.jobs (tipo, created_at desc);

create index if not exists idx_jobs_active_tipo_created_at
  on public.jobs (tipo, created_at desc)
  where status in ('pendente', 'rodando', 'on_hold');

create index if not exists idx_jobs_failed_finished_at
  on public.jobs (finished_at desc)
  where status in ('erro', 'failed_auth');
