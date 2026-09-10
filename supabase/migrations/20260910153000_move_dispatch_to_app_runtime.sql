begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A rede interna do Supabase produtivo permite ao pg_net alcançar apenas os
-- serviços da própria stack. Os disparos externos passam a ser feitos pelo
-- runtime Bentevi, que preserva as mesmas rotas, locks e deduplicação.
do $disable_database_dispatchers$
declare
  v_central_job_id bigint;
  v_publish_job_id bigint;
  v_price_job_id bigint;
begin
  select jobid into v_central_job_id
  from cron.job
  where jobname = 'vortek-sync-cron-dispatch';

  select jobid into v_publish_job_id
  from cron.job
  where jobname = 'vortek-ml-publish-dispatch';

  select jobid into v_price_job_id
  from cron.job
  where jobname = 'vortek-catalog-price-refresh';

  if v_central_job_id is distinct from 2
    or v_publish_job_id is distinct from 3
    or v_price_job_id is distinct from 4 then
    raise exception 'Identidade dos agendadores produtivos não confere';
  end if;

  perform cron.alter_job(v_central_job_id, active := false);
  perform cron.alter_job(v_publish_job_id, active := false);
  perform cron.alter_job(v_price_job_id, active := false);
end;
$disable_database_dispatchers$;

commit;
