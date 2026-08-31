set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Fase aditiva: o aplicativo anterior continua compatível enquanto os writers
-- passam a declarar explicitamente o significado de processados/total.
alter table public.jobs
  add column if not exists unidade_progresso text not null default 'execucao';

update public.jobs
set unidade_progresso = case
  when tipo in (
    'catalogo_no_catalogo_refresh',
    'ml_orders_v2_hydration',
    'sync_ml_listings_observed'
  ) then 'itens'
  when tipo in (
    'dslite_criar_pedido',
    'sync_dslite',
    'whatsapp_label_send'
  ) then 'etapas'
  else 'execucao'
end;

comment on column public.jobs.unidade_progresso is
  'Semântica de processados/total: execucao, itens ou etapas.';

notify pgrst, 'reload schema';

-- Rollback seguro antes do deploy dos novos writers:
-- alter table public.jobs drop column if exists unidade_progresso;
