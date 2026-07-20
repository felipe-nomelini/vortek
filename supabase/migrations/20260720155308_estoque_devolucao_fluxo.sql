set local lock_timeout = '5s';

alter table public.estoque_interno_movimentacoes
  add column if not exists situacao_estoque text not null default 'revisao',
  add column if not exists status_devolucao text not null default 'aguardando_confirmacao';

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_situacao_check
  check (situacao_estoque in ('revisao', 'liberado', 'nao_aproveitavel'));

-- Histórico exige nova confirmação pelo endpoint Returns antes de liberar ações.
update public.estoque_interno_movimentacoes
set situacao_estoque = 'revisao',
    disponivel_venda = false,
    status_devolucao = 'aguardando_confirmacao'
where tipo = 'entrada_devolucao';

create index if not exists idx_estoque_interno_revisao
  on public.estoque_interno_movimentacoes (situacao_estoque, status_devolucao)
  where tipo = 'entrada_devolucao';
