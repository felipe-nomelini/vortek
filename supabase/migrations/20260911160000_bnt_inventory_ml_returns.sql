begin;

set local lock_timeout = '5s';

alter table public.estoque_interno_movimentacoes
  add column if not exists origem_estoque text;

update public.estoque_interno_movimentacoes
set origem_estoque = case
  when tipo = 'entrada_compra' then 'compra_nfe'
  when tipo = 'entrada_devolucao' and status_devolucao <> 'manual' then 'devolucao_ml'
  else 'ajuste'
end
where origem_estoque is null;

alter table public.estoque_interno_movimentacoes
  alter column origem_estoque set default 'ajuste';

alter table public.estoque_interno_movimentacoes
  drop constraint if exists estoque_interno_movimentacoes_origem_check;

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_origem_check
  check (origem_estoque in ('devolucao_ml', 'compra_nfe', 'ajuste'));

create or replace function public.normalize_internal_stock_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tipo = 'entrada_compra' then
    new.origem_estoque := 'compra_nfe';
  elsif new.tipo = 'entrada_devolucao' and new.status_devolucao <> 'manual' then
    new.origem_estoque := 'devolucao_ml';
  elsif new.tipo = 'ajuste_positivo' then
    new.origem_estoque := 'ajuste';
  elsif new.origem_estoque is null then
    new.origem_estoque := 'ajuste';
  end if;
  return new;
end;
$$;

drop trigger if exists estoque_interno_movimentacoes_normalize_origin
  on public.estoque_interno_movimentacoes;
create trigger estoque_interno_movimentacoes_normalize_origin
before insert or update of tipo, status_devolucao, origem_estoque
on public.estoque_interno_movimentacoes
for each row execute function public.normalize_internal_stock_origin();

alter table public.estoque_interno_movimentacoes
  drop constraint if exists estoque_interno_movimentacoes_pedido_id_produto_id_tipo_key;

-- Divide compromissos históricos pela mesma prioridade usada nas novas vendas:
-- devoluções, compras e, por último, ajustes. Déficits legados ficam em ajuste.
do $$
declare
  v_consumption record;
  v_current_product uuid := null;
  v_return_remaining integer := 0;
  v_purchase_remaining integer := 0;
  v_adjustment_remaining integer := 0;
  v_needed integer;
  v_take integer;
  v_first boolean;
  v_origin text;
begin
  update public.estoque_interno_movimentacoes
  set origem_estoque = 'ajuste'
  where tipo = 'saida_envio_interno' and estornada_em is not null;

  for v_consumption in
    select movimento.*
    from public.estoque_interno_movimentacoes movimento
    where movimento.tipo in ('saida_envio_interno', 'ajuste_negativo')
      and movimento.estornada_em is null
    order by movimento.produto_id, movimento.created_at, movimento.id
  loop
    if v_current_product is distinct from v_consumption.produto_id then
      v_current_product := v_consumption.produto_id;

      select
        coalesce(sum(movimento.quantidade) filter (
          where movimento.origem_estoque = 'devolucao_ml'
            and movimento.tipo = 'entrada_devolucao'
            and movimento.situacao_estoque = 'liberado'
            and movimento.estornada_em is null
        ), 0)::integer,
        coalesce(sum(movimento.quantidade) filter (
          where movimento.origem_estoque = 'compra_nfe'
            and movimento.tipo = 'entrada_compra'
            and movimento.situacao_estoque = 'liberado'
            and movimento.estornada_em is null
        ), 0)::integer,
        coalesce(sum(case
          when movimento.origem_estoque = 'ajuste'
            and movimento.tipo in ('entrada_devolucao', 'entrada_compra', 'ajuste_positivo')
            and movimento.situacao_estoque = 'liberado'
            and movimento.estornada_em is null
          then movimento.quantidade
          else 0
        end), 0)::integer
      into v_return_remaining, v_purchase_remaining, v_adjustment_remaining
      from public.estoque_interno_movimentacoes movimento
      where movimento.produto_id = v_current_product;
    end if;

    v_needed := v_consumption.quantidade;
    v_first := true;

    foreach v_origin in array array['devolucao_ml', 'compra_nfe', 'ajuste'] loop
      exit when v_needed <= 0;
      v_take := case v_origin
        when 'devolucao_ml' then least(v_needed, greatest(v_return_remaining, 0))
        when 'compra_nfe' then least(v_needed, greatest(v_purchase_remaining, 0))
        else least(v_needed, greatest(v_adjustment_remaining, 0))
      end;
      if v_take <= 0 then
        continue;
      end if;

      if v_first then
        update public.estoque_interno_movimentacoes
        set quantidade = v_take, origem_estoque = v_origin
        where id = v_consumption.id;
        v_first := false;
      else
        insert into public.estoque_interno_movimentacoes (
          produto_id, pedido_id, tipo, quantidade, motivo, disponivel_venda,
          created_at, situacao_estoque, status_devolucao, estornada_em,
          estorno_motivo, estado_envio_interno, despachado_em, recebimento_id,
          recebimento_item_id, created_by, snapshot_source, origem_estoque
        ) values (
          v_consumption.produto_id, v_consumption.pedido_id,
          v_consumption.tipo, v_take, v_consumption.motivo,
          v_consumption.disponivel_venda, v_consumption.created_at,
          v_consumption.situacao_estoque, v_consumption.status_devolucao,
          v_consumption.estornada_em, v_consumption.estorno_motivo,
          v_consumption.estado_envio_interno, v_consumption.despachado_em,
          v_consumption.recebimento_id, v_consumption.recebimento_item_id,
          v_consumption.created_by, v_consumption.snapshot_source, v_origin
        );
      end if;

      if v_origin = 'devolucao_ml' then
        v_return_remaining := v_return_remaining - v_take;
      elsif v_origin = 'compra_nfe' then
        v_purchase_remaining := v_purchase_remaining - v_take;
      else
        v_adjustment_remaining := v_adjustment_remaining - v_take;
      end if;
      v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then
      if v_first then
        update public.estoque_interno_movimentacoes
        set quantidade = v_needed, origem_estoque = 'ajuste'
        where id = v_consumption.id;
      else
        insert into public.estoque_interno_movimentacoes (
          produto_id, pedido_id, tipo, quantidade, motivo, disponivel_venda,
          created_at, situacao_estoque, status_devolucao, estornada_em,
          estorno_motivo, estado_envio_interno, despachado_em, recebimento_id,
          recebimento_item_id, created_by, snapshot_source, origem_estoque
        ) values (
          v_consumption.produto_id, v_consumption.pedido_id,
          v_consumption.tipo, v_needed, v_consumption.motivo,
          v_consumption.disponivel_venda, v_consumption.created_at,
          v_consumption.situacao_estoque, v_consumption.status_devolucao,
          v_consumption.estornada_em, v_consumption.estorno_motivo,
          v_consumption.estado_envio_interno, v_consumption.despachado_em,
          v_consumption.recebimento_id, v_consumption.recebimento_item_id,
          v_consumption.created_by, v_consumption.snapshot_source, 'ajuste'
        );
      end if;
      v_adjustment_remaining := v_adjustment_remaining - v_needed;
    end if;
  end loop;
end;
$$;

alter table public.estoque_interno_movimentacoes
  alter column origem_estoque set not null;

create unique index if not exists estoque_interno_movimentacoes_compromisso_origem_idx
  on public.estoque_interno_movimentacoes (pedido_id, produto_id, tipo, origem_estoque)
  where pedido_id is not null and estornada_em is null;

create index if not exists estoque_interno_movimentacoes_produto_origem_idx
  on public.estoque_interno_movimentacoes (produto_id, origem_estoque, created_at desc)
  where estornada_em is null;

create table public.estoque_devolucoes_ml (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  quantidade integer not null check (quantidade > 0),
  motivo text not null default 'Devolução do Mercado Livre',
  ml_claim_id text,
  ml_return_id text,
  ml_return_shipment_id text,
  status_logistico text not null default 'aguardando_atualizacao',
  estado_operacional text not null default 'em_transito' check (
    estado_operacional in (
      'em_transito', 'entrega_informada', 'aguardando_inspecao',
      'apto', 'nao_apto', 'encerrada_sem_recebimento'
    )
  ),
  entrada_movimento_id uuid references public.estoque_interno_movimentacoes(id) on delete restrict,
  recebido_em timestamptz,
  recebido_por uuid,
  decidido_em timestamptz,
  decidido_por uuid,
  observado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pedido_id, produto_id),
  unique (entrada_movimento_id),
  check (
    (estado_operacional in ('aguardando_inspecao', 'apto', 'nao_apto') and recebido_em is not null)
    or (estado_operacional not in ('aguardando_inspecao', 'apto', 'nao_apto'))
  ),
  check (
    (estado_operacional in ('apto', 'nao_apto') and decidido_em is not null)
    or (estado_operacional not in ('apto', 'nao_apto'))
  ),
  check ((estado_operacional = 'apto' and entrada_movimento_id is not null) or estado_operacional <> 'apto')
);

create index estoque_devolucoes_ml_fila_idx
  on public.estoque_devolucoes_ml (estado_operacional, observado_em desc)
  where estado_operacional in ('em_transito', 'entrega_informada', 'aguardando_inspecao');
create index estoque_devolucoes_ml_produto_idx
  on public.estoque_devolucoes_ml (produto_id, updated_at desc);
create index estoque_devolucoes_ml_claim_idx
  on public.estoque_devolucoes_ml (ml_claim_id)
  where ml_claim_id is not null;

alter table public.estoque_devolucoes_ml enable row level security;
revoke all on table public.estoque_devolucoes_ml from public, anon, authenticated;
grant select, insert, update on table public.estoque_devolucoes_ml to service_role;

create function public.upsert_internal_ml_return_tracking(
  p_pedido_id uuid,
  p_produto_id uuid,
  p_quantidade integer,
  p_motivo text,
  p_ml_claim_id text,
  p_ml_return_id text,
  p_ml_return_shipment_id text,
  p_status_logistico text,
  p_estado_operacional text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_quantidade <= 0
    or nullif(trim(p_motivo), '') is null
    or p_estado_operacional not in ('em_transito', 'entrega_informada', 'encerrada_sem_recebimento') then
    raise exception using errcode = '22023', message = 'invalid_internal_return_tracking';
  end if;

  insert into public.estoque_devolucoes_ml (
    pedido_id, produto_id, quantidade, motivo, ml_claim_id, ml_return_id,
    ml_return_shipment_id, status_logistico, estado_operacional,
    observado_em, updated_at
  ) values (
    p_pedido_id, p_produto_id, p_quantidade, trim(p_motivo),
    nullif(trim(p_ml_claim_id), ''), nullif(trim(p_ml_return_id), ''),
    nullif(trim(p_ml_return_shipment_id), ''),
    coalesce(nullif(trim(p_status_logistico), ''), 'aguardando_atualizacao'),
    p_estado_operacional, now(), now()
  ) on conflict (pedido_id, produto_id) do update
  set
    quantidade = case
      when estoque_devolucoes_ml.estado_operacional in ('aguardando_inspecao', 'apto', 'nao_apto')
        then estoque_devolucoes_ml.quantidade
      else excluded.quantidade
    end,
    motivo = case
      when estoque_devolucoes_ml.estado_operacional in ('aguardando_inspecao', 'apto', 'nao_apto')
        then estoque_devolucoes_ml.motivo
      else excluded.motivo
    end,
    ml_claim_id = coalesce(excluded.ml_claim_id, estoque_devolucoes_ml.ml_claim_id),
    ml_return_id = coalesce(excluded.ml_return_id, estoque_devolucoes_ml.ml_return_id),
    ml_return_shipment_id = coalesce(
      excluded.ml_return_shipment_id,
      estoque_devolucoes_ml.ml_return_shipment_id
    ),
    status_logistico = excluded.status_logistico,
    estado_operacional = case
      when estoque_devolucoes_ml.estado_operacional in ('aguardando_inspecao', 'apto', 'nao_apto')
        then estoque_devolucoes_ml.estado_operacional
      else excluded.estado_operacional
    end,
    observado_em = now(),
    updated_at = now();
end;
$$;

revoke all on function public.upsert_internal_ml_return_tracking(
  uuid, uuid, integer, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.upsert_internal_ml_return_tracking(
  uuid, uuid, integer, text, text, text, text, text, text
) to service_role;

insert into public.estoque_devolucoes_ml (
  pedido_id, produto_id, quantidade, motivo, ml_claim_id, status_logistico,
  estado_operacional, entrada_movimento_id, recebido_em, recebido_por,
  decidido_em, decidido_por, observado_em, created_at, updated_at
)
select
  movimento.pedido_id,
  movimento.produto_id,
  movimento.quantidade,
  movimento.motivo,
  pedido.ml_claim_id,
  movimento.status_devolucao,
  case
    when movimento.situacao_estoque = 'liberado' then 'apto'
    when movimento.situacao_estoque = 'nao_aproveitavel' then 'nao_apto'
    when movimento.status_devolucao in ('cancelled', 'canceled', 'expired', 'failed', 'not_delivered', 'return_to_buyer')
      then 'encerrada_sem_recebimento'
    when movimento.status_devolucao in ('delivered', 'returned') then 'entrega_informada'
    else 'em_transito'
  end,
  case when movimento.situacao_estoque in ('liberado', 'nao_aproveitavel') then movimento.id else null end,
  case when movimento.situacao_estoque in ('liberado', 'nao_aproveitavel') then movimento.created_at else null end,
  case when movimento.situacao_estoque in ('liberado', 'nao_aproveitavel') then movimento.created_by else null end,
  case when movimento.situacao_estoque in ('liberado', 'nao_aproveitavel') then movimento.created_at else null end,
  case when movimento.situacao_estoque in ('liberado', 'nao_aproveitavel') then movimento.created_by else null end,
  movimento.created_at,
  movimento.created_at,
  now()
from public.estoque_interno_movimentacoes movimento
join public.pedidos pedido on pedido.id = movimento.pedido_id
where movimento.tipo = 'entrada_devolucao'
  and movimento.status_devolucao <> 'manual'
  and movimento.pedido_id is not null
  and movimento.estornada_em is null
on conflict (pedido_id, produto_id) do nothing;

-- Registros em revisão representam expectativa de retorno, não estoque físico.
update public.estoque_interno_movimentacoes
set
  estornada_em = now(),
  estorno_motivo = 'Movido para o acompanhamento de devoluções do Mercado Livre',
  disponivel_venda = false
where tipo = 'entrada_devolucao'
  and status_devolucao <> 'manual'
  and situacao_estoque = 'revisao'
  and estornada_em is null;

create or replace view public.estoque_interno_posicoes_origem
with (security_invoker = true)
as
select
  produto.id as produto_id,
  origem.origem_estoque,
  coalesce(sum(case
    when movimento.estornada_em is null
      and movimento.tipo in ('entrada_devolucao', 'entrada_compra', 'ajuste_positivo')
      and movimento.situacao_estoque = 'liberado'
    then movimento.quantidade
    when movimento.estornada_em is null and movimento.tipo = 'ajuste_negativo'
    then -movimento.quantidade
    when movimento.estornada_em is null
      and movimento.tipo = 'saida_envio_interno'
      and movimento.estado_envio_interno = 'despachado'
    then -movimento.quantidade
    else 0
  end), 0)::integer as fisico_util,
  coalesce(sum(case
    when movimento.estornada_em is null
      and movimento.tipo = 'saida_envio_interno'
      and movimento.estado_envio_interno = 'reservado'
    then movimento.quantidade else 0
  end), 0)::integer as reservado,
  greatest(coalesce(sum(case
    when movimento.estornada_em is null
      and movimento.tipo in ('entrada_devolucao', 'entrada_compra', 'ajuste_positivo')
      and movimento.situacao_estoque = 'liberado'
    then movimento.quantidade
    when movimento.estornada_em is null and movimento.tipo = 'ajuste_negativo'
    then -movimento.quantidade
    when movimento.estornada_em is null and movimento.tipo = 'saida_envio_interno'
    then -movimento.quantidade
    else 0
  end), 0), 0)::integer as disponivel,
  max(movimento.created_at) as ultima_movimentacao_em
from public.produtos produto
cross join (values ('devolucao_ml'), ('compra_nfe'), ('ajuste')) origem(origem_estoque)
left join public.estoque_interno_movimentacoes movimento
  on movimento.produto_id = produto.id
  and movimento.origem_estoque = origem.origem_estoque
group by produto.id, origem.origem_estoque;

revoke all on table public.estoque_interno_posicoes_origem from public, anon, authenticated;
grant select on table public.estoque_interno_posicoes_origem to service_role;

create view public.estoque_interno_posicoes_detalhadas
with (security_invoker = true)
as
with saldos as (
  select
    posicao.produto_id,
    sum(posicao.fisico_util)::integer as fisico_util,
    sum(posicao.reservado)::integer as reservado,
    sum(posicao.disponivel)::integer as disponivel,
    sum(posicao.disponivel) filter (where posicao.origem_estoque = 'devolucao_ml')::integer as devolucoes_disponivel,
    sum(posicao.disponivel) filter (where posicao.origem_estoque = 'compra_nfe')::integer as compras_disponivel,
    sum(posicao.disponivel) filter (where posicao.origem_estoque = 'ajuste')::integer as ajustes_disponivel,
    max(posicao.ultima_movimentacao_em) as ultima_movimentacao_em
  from public.estoque_interno_posicoes_origem posicao
  group by posicao.produto_id
), devolucoes as (
  select
    devolucao.produto_id,
    coalesce(sum(devolucao.quantidade) filter (
      where devolucao.estado_operacional = 'aguardando_inspecao'
    ), 0)::integer as em_revisao,
    coalesce(sum(devolucao.quantidade) filter (
      where devolucao.estado_operacional = 'nao_apto'
    ), 0)::integer as nao_aproveitavel
  from public.estoque_devolucoes_ml devolucao
  group by devolucao.produto_id
), compras_nao_aproveitaveis as (
  select movimento.produto_id, sum(movimento.quantidade)::integer as quantidade
  from public.estoque_interno_movimentacoes movimento
  where movimento.tipo = 'entrada_compra'
    and movimento.situacao_estoque = 'nao_aproveitavel'
    and movimento.estornada_em is null
  group by movimento.produto_id
)
select
  produto.id as produto_id,
  produto.sku,
  produto.nome,
  coalesce(saldos.fisico_util, 0)::integer as fisico_util,
  coalesce(saldos.reservado, 0)::integer as reservado,
  coalesce(saldos.disponivel, 0)::integer as disponivel,
  coalesce(devolucoes.em_revisao, 0)::integer as em_revisao,
  (coalesce(devolucoes.nao_aproveitavel, 0) + coalesce(compras_nao_aproveitaveis.quantidade, 0))::integer as nao_aproveitavel,
  saldos.ultima_movimentacao_em,
  coalesce(saldos.devolucoes_disponivel, 0)::integer as devolucoes_disponivel,
  coalesce(saldos.compras_disponivel, 0)::integer as compras_disponivel,
  coalesce(saldos.ajustes_disponivel, 0)::integer as ajustes_disponivel
from public.produtos produto
left join saldos on saldos.produto_id = produto.id
left join devolucoes on devolucoes.produto_id = produto.id
left join compras_nao_aproveitaveis on compras_nao_aproveitaveis.produto_id = produto.id;

revoke all on table public.estoque_interno_posicoes_detalhadas from public, anon, authenticated;
grant select on table public.estoque_interno_posicoes_detalhadas to service_role;

create or replace function public.receive_internal_ml_return(
  p_return_id uuid,
  p_user_id uuid
) returns public.estoque_devolucoes_ml
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_return public.estoque_devolucoes_ml%rowtype;
begin
  select devolucao.* into v_return
  from public.estoque_devolucoes_ml devolucao
  where devolucao.id = p_return_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'internal_return_not_found';
  end if;

  if v_return.estado_operacional = 'aguardando_inspecao' then
    return v_return;
  end if;
  if v_return.estado_operacional not in ('em_transito', 'entrega_informada') then
    raise exception using errcode = 'P0001', message = 'internal_return_cannot_be_received';
  end if;

  update public.estoque_devolucoes_ml
  set
    estado_operacional = 'aguardando_inspecao',
    recebido_em = now(),
    recebido_por = p_user_id,
    updated_at = now()
  where id = p_return_id
  returning * into v_return;
  return v_return;
end;
$$;

create or replace function public.decide_internal_ml_return(
  p_return_id uuid,
  p_result text,
  p_user_id uuid
) returns table (produto_id uuid, movimento_id uuid, estado_operacional text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_return public.estoque_devolucoes_ml%rowtype;
  v_movement_id uuid;
  v_state text;
begin
  if p_result not in ('apto', 'nao_apto') then
    raise exception using errcode = '22023', message = 'invalid_internal_return_result';
  end if;

  select devolucao.* into v_return
  from public.estoque_devolucoes_ml devolucao
  where devolucao.id = p_return_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'internal_return_not_found';
  end if;

  if v_return.estado_operacional in ('apto', 'nao_apto') then
    if v_return.estado_operacional <> p_result then
      raise exception using errcode = 'P0001', message = 'internal_return_already_decided';
    end if;
    return query select v_return.produto_id, v_return.entrada_movimento_id, v_return.estado_operacional;
    return;
  end if;
  if v_return.estado_operacional <> 'aguardando_inspecao' then
    raise exception using errcode = 'P0001', message = 'internal_return_not_received';
  end if;

  v_state := p_result;
  if p_result = 'apto' then
    insert into public.estoque_interno_movimentacoes (
      produto_id, pedido_id, tipo, quantidade, motivo, disponivel_venda,
      situacao_estoque, status_devolucao, created_by, idempotency_key,
      origem_estoque
    ) values (
      v_return.produto_id, v_return.pedido_id, 'entrada_devolucao',
      v_return.quantidade, 'Devolução recebida e aprovada para venda', true,
      'liberado', 'recebida', p_user_id, 'ml-return:' || v_return.id::text,
      'devolucao_ml'
    ) on conflict (idempotency_key) where idempotency_key is not null do update
      set idempotency_key = excluded.idempotency_key
    returning id into v_movement_id;
  end if;

  update public.estoque_devolucoes_ml
  set
    estado_operacional = v_state,
    entrada_movimento_id = v_movement_id,
    decidido_em = now(),
    decidido_por = p_user_id,
    updated_at = now()
  where id = p_return_id;

  return query select v_return.produto_id, v_movement_id, v_state;
end;
$$;

revoke all on function public.receive_internal_ml_return(uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_internal_ml_return(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.receive_internal_ml_return(uuid, uuid) to service_role;
grant execute on function public.decide_internal_ml_return(uuid, text, uuid) to service_role;

create function public.adjust_internal_stock_by_origin(
  p_product_id uuid,
  p_quantity integer,
  p_reason text,
  p_idempotency_key text,
  p_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_movement_id uuid;
  v_origin text;
  v_available integer;
  v_remaining integer;
  v_take integer;
begin
  if p_quantity = 0 or nullif(trim(p_reason), '') is null
    or nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'invalid_stock_adjustment';
  end if;

  select movimento.id into v_existing_id
  from public.estoque_interno_movimentacoes movimento
  where movimento.idempotency_key = trim(p_idempotency_key)
  limit 1;
  if found then
    return v_existing_id;
  end if;

  perform produto.id
  from public.produtos produto
  where produto.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'stock_product_not_found';
  end if;

  if p_quantity > 0 then
    insert into public.estoque_interno_movimentacoes (
      produto_id, tipo, quantidade, motivo, disponivel_venda,
      situacao_estoque, status_devolucao, created_by, idempotency_key,
      origem_estoque
    ) values (
      p_product_id, 'ajuste_positivo', p_quantity, trim(p_reason), true,
      'liberado', 'ajuste_manual', p_user_id, trim(p_idempotency_key),
      'ajuste'
    ) returning id into v_movement_id;
    return v_movement_id;
  end if;

  v_remaining := abs(p_quantity);
  foreach v_origin in array array['devolucao_ml', 'compra_nfe', 'ajuste'] loop
    exit when v_remaining <= 0;
    select greatest(coalesce(posicao.disponivel, 0), 0) into v_available
    from public.estoque_interno_posicoes_origem posicao
    where posicao.produto_id = p_product_id
      and posicao.origem_estoque = v_origin;
    v_take := least(v_remaining, coalesce(v_available, 0));
    if v_take <= 0 then continue; end if;

    insert into public.estoque_interno_movimentacoes (
      produto_id, tipo, quantidade, motivo, disponivel_venda,
      situacao_estoque, status_devolucao, created_by, idempotency_key,
      origem_estoque
    ) values (
      p_product_id, 'ajuste_negativo', v_take, trim(p_reason), true,
      'liberado', 'ajuste_manual', p_user_id,
      case when v_movement_id is null then trim(p_idempotency_key) else null end,
      v_origin
    ) returning id into v_existing_id;
    v_movement_id := coalesce(v_movement_id, v_existing_id);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception using errcode = 'P0001', message = 'stock_adjustment_invades_reservations';
  end if;
  return v_movement_id;
end;
$$;

revoke all on function public.adjust_internal_stock_by_origin(uuid, integer, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.adjust_internal_stock_by_origin(uuid, integer, text, text, uuid)
  to service_role;

create function public.select_order_fulfillment_by_origin(
  p_pedido_id uuid,
  p_source text,
  p_items jsonb
) returns table (
  fulfillment_source text,
  fulfillment_selected_at timestamptz,
  selected_now boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_source text := nullif(trim(p_source), '');
  v_selected_now boolean := false;
  v_item record;
  v_origin text;
  v_available integer;
  v_remaining integer;
  v_take integer;
  v_existing_count integer;
  v_reservation_mismatch boolean;
begin
  if v_source is null or v_source not in ('internal', 'supplier') then
    raise exception using errcode = '22023', message = 'invalid_fulfillment_source';
  end if;

  select pedido.* into v_pedido
  from public.pedidos pedido
  where pedido.id = p_pedido_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  if v_source = 'internal' and nullif(trim(v_pedido.dslite_id), '') is not null then
    raise exception using errcode = 'P0001', message = 'fulfillment_conflict:supplier';
  end if;
  if v_source = 'supplier' and v_pedido.envio_interno_at is not null then
    raise exception using errcode = 'P0001', message = 'fulfillment_conflict:internal';
  end if;
  if v_pedido.fulfillment_source is not null and v_pedido.fulfillment_source <> v_source then
    raise exception using errcode = 'P0001', message = 'fulfillment_conflict:' || v_pedido.fulfillment_source;
  end if;

  if v_source = 'internal' then
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
      or exists (
        select 1 from jsonb_to_recordset(p_items) as item(produto_id uuid, sku text, quantidade integer)
        where item.produto_id is null or item.quantidade is null or item.quantidade <= 0
      ) then
      raise exception using errcode = '22023', message = 'invalid_internal_stock_items';
    end if;

    for v_item in
      select item.produto_id, min(nullif(trim(item.sku), '')) as sku, sum(item.quantidade)::bigint as quantidade
      from jsonb_to_recordset(p_items) as item(produto_id uuid, sku text, quantidade integer)
      group by item.produto_id
      order by item.produto_id
    loop
      if v_item.quantidade > 2147483647 then
        raise exception using errcode = '22023', message = 'invalid_internal_stock_items';
      end if;
      perform produto.id from public.produtos produto where produto.id = v_item.produto_id for update;
      if not found then
        raise exception using errcode = 'P0002', message = 'internal_stock_product_not_found:' || v_item.produto_id::text;
      end if;
    end loop;

    select count(*)::integer into v_existing_count
    from public.estoque_interno_movimentacoes movimento
    where movimento.pedido_id = p_pedido_id
      and movimento.tipo = 'saida_envio_interno'
      and movimento.estornada_em is null;

    if v_existing_count > 0 then
      with expected as (
        select item.produto_id, sum(item.quantidade)::bigint as quantidade
        from jsonb_to_recordset(p_items) as item(produto_id uuid, sku text, quantidade integer)
        group by item.produto_id
      ), existing as (
        select movimento.produto_id, sum(movimento.quantidade)::bigint as quantidade
        from public.estoque_interno_movimentacoes movimento
        where movimento.pedido_id = p_pedido_id
          and movimento.tipo = 'saida_envio_interno'
          and movimento.estornada_em is null
        group by movimento.produto_id
      )
      select exists (
        select 1 from expected full join existing using (produto_id)
        where expected.produto_id is null or existing.produto_id is null
          or expected.quantidade <> existing.quantidade
      ) into v_reservation_mismatch;
      if v_reservation_mismatch then
        raise exception using errcode = 'P0001', message = 'internal_stock_reservation_conflict';
      end if;
    else
      for v_item in
        select item.produto_id,
          coalesce(min(nullif(trim(item.sku), '')), item.produto_id::text) as sku,
          sum(item.quantidade)::integer as quantidade
        from jsonb_to_recordset(p_items) as item(produto_id uuid, sku text, quantidade integer)
        group by item.produto_id
        order by item.produto_id
      loop
        v_remaining := v_item.quantidade;
        foreach v_origin in array array['devolucao_ml', 'compra_nfe', 'ajuste'] loop
          exit when v_remaining <= 0;
          select greatest(coalesce(posicao.disponivel, 0), 0) into v_available
          from public.estoque_interno_posicoes_origem posicao
          where posicao.produto_id = v_item.produto_id
            and posicao.origem_estoque = v_origin;
          v_take := least(v_remaining, coalesce(v_available, 0));
          if v_take <= 0 then continue; end if;

          insert into public.estoque_interno_movimentacoes (
            produto_id, pedido_id, tipo, quantidade, motivo,
            estado_envio_interno, origem_estoque
          ) values (
            v_item.produto_id, p_pedido_id, 'saida_envio_interno', v_take,
            'Reserva para envio interno', 'reservado', v_origin
          );
          v_remaining := v_remaining - v_take;
        end loop;

        if v_remaining > 0 then
          raise exception using errcode = 'P0001', message = format(
            'internal_stock_insufficient:%s:%s', v_item.sku,
            greatest(v_item.quantidade - v_remaining, 0)
          );
        end if;
      end loop;
    end if;
  end if;

  if v_pedido.fulfillment_source is null then
    update public.pedidos pedido
    set fulfillment_source = v_source, fulfillment_selected_at = now()
    where pedido.id = p_pedido_id
    returning pedido.* into v_pedido;
    v_selected_now := true;
  end if;

  return query select v_pedido.fulfillment_source, v_pedido.fulfillment_selected_at, v_selected_now;
end;
$$;

revoke all on function public.select_order_fulfillment_by_origin(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.select_order_fulfillment_by_origin(uuid, text, jsonb)
  to service_role;

commit;
