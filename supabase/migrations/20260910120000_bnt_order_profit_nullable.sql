begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.pedidos
  alter column lucro drop default,
  alter column lucro drop not null;

comment on column public.pedidos.lucro is
  'Lucro final calculado da venda; null enquanto as evidências econômicas estiverem incompletas.';

commit;

notify pgrst, 'reload schema';
