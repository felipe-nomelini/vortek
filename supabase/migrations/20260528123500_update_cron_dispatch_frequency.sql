-- Ajusta o dispatcher principal para execução por minuto (quase real-time).
-- O throttling por tarefa continua controlado na API /api/sync/cron-dispatch.

select cron.unschedule(jobid)
from cron.job
where jobname = 'vortek-sync-cron-dispatch';

select cron.schedule(
  'vortek-sync-cron-dispatch',
  '* * * * *',
  $$select public.dispatch_sync_cron();$$
);

