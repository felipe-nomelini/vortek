set local lock_timeout = '5s';
set local statement_timeout = '60s';

update public.pedidos
set nfe_status = case lower(btrim(nfe_status))
  when 'autorizada' then 'authorized'
  when 'autorizado' then 'authorized'
  when 'cancelada' then 'cancelled'
  when 'cancelado' then 'cancelled'
  when 'canceled' then 'cancelled'
  when 'pendente' then 'pending'
  when 'interrompida' then 'interrupted'
  when 'interrompido' then 'interrupted'
  when 'rejeitada' then 'rejected'
  when 'rejeitado' then 'rejected'
  when 'denegada' then 'denied'
  when 'denegado' then 'denied'
  when 'processando' then 'processing'
  when 'outro' then 'other'
  else nfe_status
end
where lower(btrim(nfe_status)) in (
  'autorizada',
  'autorizado',
  'cancelada',
  'cancelado',
  'canceled',
  'pendente',
  'interrompida',
  'interrompido',
  'rejeitada',
  'rejeitado',
  'denegada',
  'denegado',
  'processando',
  'outro'
);

alter table public.pedidos
  alter column nfe_status set default 'pending';

do $rule05$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'pedidos_nfe_status_check'
      and conrelid = 'public.pedidos'::regclass
  ) then
    alter table public.pedidos
      add constraint pedidos_nfe_status_check
      check (
        nfe_status is null
        or nfe_status in (
          'authorized',
          'cancelled',
          'pending',
          'interrupted',
          'rejected',
          'denied',
          'processing',
          'not_found',
          'cancel_rejected_deadline',
          'other'
        )
      ) not valid;
  end if;
end;
$rule05$;

alter table public.pedidos
  validate constraint pedidos_nfe_status_check;

-- Rollback operacional (somente quando explicitamente autorizado):
-- alter table public.pedidos drop constraint if exists pedidos_nfe_status_check;
-- alter table public.pedidos alter column nfe_status set default 'pendente';
