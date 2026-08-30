set local lock_timeout = '5s';

alter table public.estoque_interno_movimentacoes
  add column if not exists origem_entrada text,
  add column if not exists custo_unitario numeric(12, 2);

update public.estoque_interno_movimentacoes
set origem_entrada = case
  when tipo <> 'entrada_devolucao' then null
  when status_devolucao = 'manual' then 'ajuste_manual'
  else 'devolucao'
end
where origem_entrada is null;

alter table public.estoque_interno_movimentacoes
  drop constraint if exists estoque_interno_movimentacoes_origem_entrada_check;

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_origem_entrada_check
  check (
    (tipo = 'entrada_devolucao' and origem_entrada is not null and origem_entrada in ('devolucao', 'compra', 'ajuste_manual'))
    or (tipo <> 'entrada_devolucao' and origem_entrada is null)
  ) not valid;

alter table public.estoque_interno_movimentacoes
  validate constraint estoque_interno_movimentacoes_origem_entrada_check;

alter table public.estoque_interno_movimentacoes
  drop constraint if exists estoque_interno_movimentacoes_custo_unitario_check;

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_custo_unitario_check
  check (
    (origem_entrada = 'compra' and custo_unitario is not null and custo_unitario > 0)
    or (origem_entrada is distinct from 'compra' and custo_unitario is null)
  ) not valid;

alter table public.estoque_interno_movimentacoes
  validate constraint estoque_interno_movimentacoes_custo_unitario_check;

comment on column public.estoque_interno_movimentacoes.origem_entrada is
  'Origem auditável da entrada: devolução, compra recebida ou ajuste manual.';

comment on column public.estoque_interno_movimentacoes.custo_unitario is
  'Custo unitário confirmado no recebimento de uma compra para estoque interno.';
