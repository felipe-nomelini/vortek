set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Writers antigos usaram concluido; completo é o único estado canônico de
-- sucesso integral no contrato atual.
update public.jobs
set status = 'completo'
where lower(btrim(status)) = 'concluido';

do $job04$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'jobs_status_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_status_check
      check (status in (
        'pendente',
        'rodando',
        'on_hold',
        'completo',
        'completo_parcial',
        'erro',
        'failed_auth',
        'cancelado'
      )) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'jobs_unidade_progresso_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_unidade_progresso_check
      check (unidade_progresso in ('execucao', 'itens', 'etapas')) not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'jobs_metricas_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_metricas_check
      check (
        progresso between 0 and 100
        and total >= 0
        and processados between 0 and total
      ) not valid;
  end if;
end;
$job04$;

alter table public.jobs validate constraint jobs_status_check;
alter table public.jobs validate constraint jobs_unidade_progresso_check;
alter table public.jobs validate constraint jobs_metricas_check;

comment on column public.jobs.status is
  'Estado canônico do job; cancelado neste campo é a única fonte de cancelamento.';

-- O booleano nunca foi uma fonte confiável: writers gravavam status=cancelado
-- sem atualizá-lo. O status canônico substitui a duplicação.
alter table public.jobs
  drop column if exists cancelado;

notify pgrst, 'reload schema';

-- Rollback, somente após restaurar o aplicativo anterior:
-- alter table public.jobs add column cancelado boolean not null default false;
-- update public.jobs set cancelado = (status = 'cancelado');
-- alter table public.jobs drop constraint if exists jobs_metricas_check;
-- alter table public.jobs drop constraint if exists jobs_unidade_progresso_check;
-- alter table public.jobs drop constraint if exists jobs_status_check;
