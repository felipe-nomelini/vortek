alter table public.estoque_interno_movimentacoes
  add column if not exists estornada_em timestamptz,
  add column if not exists estorno_motivo text;

comment on column public.estoque_interno_movimentacoes.estornada_em is
  'Momento em que uma saída de estoque deixou de consumir saldo, sem apagar o histórico.';

comment on column public.estoque_interno_movimentacoes.estorno_motivo is
  'Motivo auditável do estorno da movimentação.';

create index if not exists idx_estoque_interno_saidas_ativas
  on public.estoque_interno_movimentacoes (pedido_id, produto_id)
  where tipo = 'saida_envio_interno' and estornada_em is null;
