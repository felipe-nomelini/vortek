begin;

set local lock_timeout = '5s';

alter table public.estoque_interno_movimentacoes
  add column if not exists recebimento_id uuid,
  add column if not exists recebimento_item_id uuid,
  add column if not exists created_by uuid,
  add column if not exists idempotency_key text;

alter table public.estoque_interno_movimentacoes
  drop constraint if exists estoque_interno_movimentacoes_tipo_check;

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_tipo_check
  check (tipo in (
    'entrada_devolucao',
    'entrada_compra',
    'ajuste_positivo',
    'ajuste_negativo',
    'saida_envio_interno'
  ));

create table public.estoque_recebimentos_nfe (
  id uuid primary key default gen_random_uuid(),
  chave_nfe text not null unique check (chave_nfe ~ '^[0-9]{44}$'),
  tipo_ambiente smallint not null check (tipo_ambiente in (1, 2)),
  numero text,
  serie text,
  emitente_cnpj text not null check (emitente_cnpj ~ '^[0-9]{14}$'),
  emitente_nome text not null,
  destinatario_cnpj text not null check (destinatario_cnpj ~ '^[0-9]{14}$'),
  emitida_em timestamptz,
  valor_total numeric(14, 2) not null default 0 check (valor_total >= 0),
  xml_nfe text not null,
  origem_xml text not null check (origem_xml in ('brasilnfe', 'upload')),
  status text not null default 'aguardando_conferencia'
    check (status in ('aguardando_conferencia', 'parcial', 'conferido')),
  manifestacao_status text,
  manifestacao_protocolo text,
  manifestada_em timestamptz,
  created_by uuid,
  confirmado_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmado_em timestamptz
);

create table public.estoque_recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references public.estoque_recebimentos_nfe(id) on delete cascade,
  numero_item integer not null check (numero_item > 0),
  produto_id uuid references public.produtos(id) on delete restrict,
  codigo_fornecedor text,
  gtin text,
  descricao text not null,
  quantidade_esperada integer not null check (quantidade_esperada > 0),
  quantidade_liberada integer not null default 0 check (quantidade_liberada >= 0),
  quantidade_nao_aproveitavel integer not null default 0 check (quantidade_nao_aproveitavel >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recebimento_id, numero_item),
  check (quantidade_liberada + quantidade_nao_aproveitavel <= quantidade_esperada)
);

create table public.estoque_mapeamentos_fornecedor (
  id uuid primary key default gen_random_uuid(),
  emitente_cnpj text not null check (emitente_cnpj ~ '^[0-9]{14}$'),
  codigo_fornecedor text not null,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (emitente_cnpj, codigo_fornecedor)
);

create table public.estoque_manifestacoes_nfe (
  chave_nfe text primary key check (chave_nfe ~ '^[0-9]{44}$'),
  tipo_ambiente smallint not null check (tipo_ambiente in (1, 2)),
  tipo_manifestacao smallint not null default 2 check (tipo_manifestacao = 2),
  status text not null,
  protocolo text,
  motivo text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_recebimento_id_fkey
  foreign key (recebimento_id) references public.estoque_recebimentos_nfe(id) on delete restrict;

alter table public.estoque_interno_movimentacoes
  add constraint estoque_interno_movimentacoes_recebimento_item_id_fkey
  foreign key (recebimento_item_id) references public.estoque_recebimento_itens(id) on delete restrict;

create unique index estoque_interno_movimentacoes_idempotency_key_idx
  on public.estoque_interno_movimentacoes (idempotency_key)
  where idempotency_key is not null;

create index estoque_interno_movimentacoes_produto_created_idx
  on public.estoque_interno_movimentacoes (produto_id, created_at desc);

create index estoque_interno_movimentacoes_recebimento_idx
  on public.estoque_interno_movimentacoes (recebimento_id, recebimento_item_id)
  where recebimento_id is not null;

create index estoque_recebimentos_nfe_status_created_idx
  on public.estoque_recebimentos_nfe (status, created_at desc);

create index estoque_recebimento_itens_produto_idx
  on public.estoque_recebimento_itens (produto_id, recebimento_id)
  where produto_id is not null;

alter table public.estoque_recebimentos_nfe enable row level security;
alter table public.estoque_recebimento_itens enable row level security;
alter table public.estoque_mapeamentos_fornecedor enable row level security;
alter table public.estoque_manifestacoes_nfe enable row level security;

revoke all on table public.estoque_recebimentos_nfe from public, anon, authenticated;
revoke all on table public.estoque_recebimento_itens from public, anon, authenticated;
revoke all on table public.estoque_mapeamentos_fornecedor from public, anon, authenticated;
revoke all on table public.estoque_manifestacoes_nfe from public, anon, authenticated;
grant select, insert, update on table public.estoque_recebimentos_nfe to service_role;
grant select, insert, update on table public.estoque_recebimento_itens to service_role;
grant select, insert, update on table public.estoque_mapeamentos_fornecedor to service_role;
grant select, insert, update on table public.estoque_manifestacoes_nfe to service_role;

create or replace view public.estoque_interno_posicoes
with (security_invoker = true)
as
select
  produto.id as produto_id,
  produto.sku,
  produto.nome,
  coalesce(sum(case
    when movimento.estornada_em is null
      and movimento.tipo in ('entrada_devolucao', 'entrada_compra', 'ajuste_positivo')
      and movimento.situacao_estoque = 'liberado'
    then movimento.quantidade
    when movimento.estornada_em is null
      and movimento.tipo = 'ajuste_negativo'
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
    then movimento.quantidade
    else 0
  end), 0)::integer as reservado,
  greatest(coalesce(sum(case
    when movimento.estornada_em is null
      and movimento.tipo in ('entrada_devolucao', 'entrada_compra', 'ajuste_positivo')
      and movimento.situacao_estoque = 'liberado'
    then movimento.quantidade
    when movimento.estornada_em is null
      and movimento.tipo = 'ajuste_negativo'
    then -movimento.quantidade
    when movimento.estornada_em is null
      and movimento.tipo = 'saida_envio_interno'
    then -movimento.quantidade
    else 0
  end), 0), 0)::integer as disponivel,
  coalesce(sum(case
    when movimento.estornada_em is null
      and movimento.tipo in ('entrada_devolucao', 'entrada_compra')
      and movimento.situacao_estoque = 'revisao'
    then movimento.quantidade
    else 0
  end), 0)::integer as em_revisao,
  coalesce(sum(case
    when movimento.estornada_em is null
      and movimento.tipo in ('entrada_devolucao', 'entrada_compra')
      and movimento.situacao_estoque = 'nao_aproveitavel'
    then movimento.quantidade
    else 0
  end), 0)::integer as nao_aproveitavel,
  max(movimento.created_at) as ultima_movimentacao_em
from public.produtos produto
left join public.estoque_interno_movimentacoes movimento
  on movimento.produto_id = produto.id
group by produto.id, produto.sku, produto.nome;

revoke all on table public.estoque_interno_posicoes from public, anon, authenticated;
grant select on table public.estoque_interno_posicoes to service_role;

create or replace function public.upsert_internal_stock_receipt(
  p_receipt jsonb,
  p_items jsonb,
  p_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receipt_id uuid;
  v_status text;
  v_item record;
begin
  if p_receipt is null or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'invalid_stock_receipt';
  end if;

  select recebimento.id, recebimento.status
  into v_receipt_id, v_status
  from public.estoque_recebimentos_nfe recebimento
  where recebimento.chave_nfe = p_receipt->>'chave_nfe'
  for update;

  if v_receipt_id is null then
    insert into public.estoque_recebimentos_nfe (
      chave_nfe, tipo_ambiente, numero, serie, emitente_cnpj, emitente_nome,
      destinatario_cnpj, emitida_em, valor_total, xml_nfe, origem_xml, created_by
    ) values (
      p_receipt->>'chave_nfe', (p_receipt->>'tipo_ambiente')::smallint,
      nullif(p_receipt->>'numero', ''), nullif(p_receipt->>'serie', ''),
      p_receipt->>'emitente_cnpj', p_receipt->>'emitente_nome',
      p_receipt->>'destinatario_cnpj', nullif(p_receipt->>'emitida_em', '')::timestamptz,
      coalesce((p_receipt->>'valor_total')::numeric, 0), p_receipt->>'xml_nfe',
      p_receipt->>'origem_xml', p_user_id
    ) returning id into v_receipt_id;
  elsif v_status = 'conferido' then
    return v_receipt_id;
  else
    if exists (
      select 1 from public.estoque_recebimento_itens item
      where item.recebimento_id = v_receipt_id
        and (item.quantidade_liberada > 0 or item.quantidade_nao_aproveitavel > 0)
    ) then
      return v_receipt_id;
    end if;

    update public.estoque_recebimentos_nfe
    set
      numero = nullif(p_receipt->>'numero', ''),
      serie = nullif(p_receipt->>'serie', ''),
      emitente_cnpj = p_receipt->>'emitente_cnpj',
      emitente_nome = p_receipt->>'emitente_nome',
      destinatario_cnpj = p_receipt->>'destinatario_cnpj',
      emitida_em = nullif(p_receipt->>'emitida_em', '')::timestamptz,
      valor_total = coalesce((p_receipt->>'valor_total')::numeric, 0),
      xml_nfe = p_receipt->>'xml_nfe',
      origem_xml = p_receipt->>'origem_xml',
      updated_at = now()
    where id = v_receipt_id;

    delete from public.estoque_recebimento_itens
    where recebimento_id = v_receipt_id;
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as item(
      numero_item integer,
      produto_id uuid,
      codigo_fornecedor text,
      gtin text,
      descricao text,
      quantidade_esperada integer
    ) order by numero_item
  loop
    insert into public.estoque_recebimento_itens (
      recebimento_id, numero_item, produto_id, codigo_fornecedor, gtin,
      descricao, quantidade_esperada
    ) values (
      v_receipt_id, v_item.numero_item, v_item.produto_id,
      nullif(trim(v_item.codigo_fornecedor), ''), nullif(trim(v_item.gtin), ''),
      v_item.descricao, v_item.quantidade_esperada
    );
  end loop;

  return v_receipt_id;
end;
$$;

create or replace function public.confirm_internal_stock_receipt(
  p_receipt_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_user_id uuid
) returns table (
  receipt_status text,
  product_ids uuid[],
  movements_created integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receipt public.estoque_recebimentos_nfe%rowtype;
  v_item record;
  v_delta_good integer;
  v_delta_damaged integer;
  v_created integer := 0;
  v_product_ids uuid[] := array[]::uuid[];
  v_status text;
begin
  if nullif(trim(p_idempotency_key), '') is null
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'invalid_stock_receipt_confirmation';
  end if;

  select * into v_receipt
  from public.estoque_recebimentos_nfe
  where id = p_receipt_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'stock_receipt_not_found';
  end if;

  if exists (
    select 1 from public.estoque_interno_movimentacoes movimento
    where movimento.recebimento_id = p_receipt_id
      and movimento.idempotency_key like p_idempotency_key || ':%'
  ) then
    return query select v_receipt.status, array(
      select distinct item.produto_id
      from public.estoque_recebimento_itens item
      where item.recebimento_id = p_receipt_id and item.produto_id is not null
    ), 0;
    return;
  end if;

  if (select count(*) from jsonb_to_recordset(p_items) as payload(
    item_id uuid,
    produto_id uuid,
    quantidade_liberada integer,
    quantidade_nao_aproveitavel integer
  )) <> (select count(*) from public.estoque_recebimento_itens item where item.recebimento_id = p_receipt_id) then
    raise exception using errcode = '22023', message = 'invalid_stock_receipt_items';
  end if;

  if not exists (
    select 1 from jsonb_to_recordset(p_items) as payload(
      item_id uuid,
      produto_id uuid,
      quantidade_liberada integer,
      quantidade_nao_aproveitavel integer
    ) where coalesce(payload.quantidade_liberada, 0)
      + coalesce(payload.quantidade_nao_aproveitavel, 0) > 0
  ) then
    raise exception using errcode = '22023', message = 'invalid_stock_receipt_quantities';
  end if;

  update public.estoque_recebimento_itens item
  set produto_id = payload.produto_id, updated_at = now()
  from jsonb_to_recordset(p_items) as payload(
    item_id uuid,
    produto_id uuid,
    quantidade_liberada integer,
    quantidade_nao_aproveitavel integer
  )
  where item.id = payload.item_id
    and item.recebimento_id = p_receipt_id;

  if exists (
    select 1 from public.estoque_recebimento_itens item
    where item.recebimento_id = p_receipt_id and item.produto_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'stock_receipt_unmapped_items';
  end if;

  for v_item in
    select
      item.id,
      item.produto_id,
      item.codigo_fornecedor,
      item.quantidade_esperada,
      item.quantidade_liberada,
      item.quantidade_nao_aproveitavel,
      payload.quantidade_liberada as requested_good,
      payload.quantidade_nao_aproveitavel as requested_damaged
    from jsonb_to_recordset(p_items) as payload(
      item_id uuid,
      produto_id uuid,
      quantidade_liberada integer,
      quantidade_nao_aproveitavel integer
    )
    join public.estoque_recebimento_itens item on item.id = payload.item_id
    where item.recebimento_id = p_receipt_id
    order by item.produto_id, item.id
    for update of item
  loop
    if v_item.produto_id is null then
      raise exception using errcode = 'P0001', message = 'stock_receipt_unmapped_items';
    end if;

    perform produto.id from public.produtos produto
    where produto.id = v_item.produto_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'stock_receipt_product_not_found';
    end if;

    v_delta_good := coalesce(v_item.requested_good, 0);
    v_delta_damaged := coalesce(v_item.requested_damaged, 0);
    if v_delta_good < 0 or v_delta_damaged < 0
      or v_item.quantidade_liberada + v_item.quantidade_nao_aproveitavel
        + v_delta_good + v_delta_damaged > v_item.quantidade_esperada then
      raise exception using errcode = '22023', message = 'invalid_stock_receipt_quantities';
    end if;

    if v_delta_good + v_delta_damaged = 0 then
      continue;
    end if;

    if v_delta_good > 0 then
      insert into public.estoque_interno_movimentacoes (
        produto_id, tipo, quantidade, motivo, disponivel_venda, situacao_estoque,
        status_devolucao, recebimento_id, recebimento_item_id, created_by, idempotency_key
      ) values (
        v_item.produto_id, 'entrada_compra', v_delta_good,
        'Recebimento de NF-e ' || v_receipt.chave_nfe, true, 'liberado',
        'recebimento_nfe', p_receipt_id, v_item.id, p_user_id,
        p_idempotency_key || ':' || v_item.id::text || ':good'
      );
      v_created := v_created + 1;
    end if;

    if v_delta_damaged > 0 then
      insert into public.estoque_interno_movimentacoes (
        produto_id, tipo, quantidade, motivo, disponivel_venda, situacao_estoque,
        status_devolucao, recebimento_id, recebimento_item_id, created_by, idempotency_key
      ) values (
        v_item.produto_id, 'entrada_compra', v_delta_damaged,
        'Recebimento avariado de NF-e ' || v_receipt.chave_nfe, false, 'nao_aproveitavel',
        'recebimento_nfe', p_receipt_id, v_item.id, p_user_id,
        p_idempotency_key || ':' || v_item.id::text || ':damaged'
      );
      v_created := v_created + 1;
    end if;

    update public.estoque_recebimento_itens
    set
      quantidade_liberada = quantidade_liberada + v_delta_good,
      quantidade_nao_aproveitavel = quantidade_nao_aproveitavel + v_delta_damaged,
      updated_at = now()
    where id = v_item.id;

    if nullif(trim(v_item.codigo_fornecedor), '') is not null then
      insert into public.estoque_mapeamentos_fornecedor (
        emitente_cnpj, codigo_fornecedor, produto_id, created_by
      ) values (
        v_receipt.emitente_cnpj, trim(v_item.codigo_fornecedor), v_item.produto_id, p_user_id
      ) on conflict (emitente_cnpj, codigo_fornecedor) do update set
        produto_id = excluded.produto_id,
        updated_at = now();
    end if;

    v_product_ids := array_append(v_product_ids, v_item.produto_id);
  end loop;

  select case when bool_and(
    item.quantidade_liberada + item.quantidade_nao_aproveitavel = item.quantidade_esperada
  ) then 'conferido' else 'parcial' end
  into v_status
  from public.estoque_recebimento_itens item
  where item.recebimento_id = p_receipt_id;

  update public.estoque_recebimentos_nfe
  set
    status = v_status,
    confirmado_by = p_user_id,
    confirmado_em = case when v_status = 'conferido' then now() else confirmado_em end,
    updated_at = now()
  where id = p_receipt_id;

  return query select v_status, array(
    select distinct unnest(v_product_ids)
  ), v_created;
end;
$$;

create or replace function public.adjust_internal_stock(
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
  v_available integer;
  v_movement_id uuid;
begin
  if p_quantity = 0 or nullif(trim(p_reason), '') is null
    or nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'invalid_stock_adjustment';
  end if;

  select produto.id into v_movement_id
  from public.produtos produto
  where produto.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'stock_product_not_found';
  end if;

  select posicao.disponivel into v_available
  from public.estoque_interno_posicoes posicao
  where posicao.produto_id = p_product_id;

  if p_quantity < 0 and abs(p_quantity) > coalesce(v_available, 0) then
    raise exception using errcode = 'P0001', message = 'stock_adjustment_invades_reservations';
  end if;

  insert into public.estoque_interno_movimentacoes (
    produto_id, tipo, quantidade, motivo, disponivel_venda, situacao_estoque,
    status_devolucao, created_by, idempotency_key
  ) values (
    p_product_id,
    case when p_quantity > 0 then 'ajuste_positivo' else 'ajuste_negativo' end,
    abs(p_quantity), trim(p_reason), true, 'liberado', 'ajuste_manual',
    p_user_id, trim(p_idempotency_key)
  ) on conflict (idempotency_key) where idempotency_key is not null do update
    set idempotency_key = excluded.idempotency_key
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

create or replace function public.select_order_fulfillment(
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
  v_available integer;
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
          sum(item.quantidade)::bigint as quantidade
        from jsonb_to_recordset(p_items) as item(produto_id uuid, sku text, quantidade integer)
        group by item.produto_id
        order by item.produto_id
      loop
        select posicao.disponivel into v_available
        from public.estoque_interno_posicoes posicao
        where posicao.produto_id = v_item.produto_id;
        if coalesce(v_available, 0) < v_item.quantidade then
          raise exception using errcode = 'P0001', message = format(
            'internal_stock_insufficient:%s:%s', v_item.sku, greatest(coalesce(v_available, 0), 0)
          );
        end if;
      end loop;

      insert into public.estoque_interno_movimentacoes (
        produto_id, pedido_id, tipo, quantidade, motivo, estado_envio_interno
      )
      select item.produto_id, p_pedido_id, 'saida_envio_interno', sum(item.quantidade)::integer,
        'Reserva para envio interno', 'reservado'
      from jsonb_to_recordset(p_items) as item(produto_id uuid, sku text, quantidade integer)
      group by item.produto_id
      order by item.produto_id;
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

revoke all on function public.upsert_internal_stock_receipt(jsonb, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.confirm_internal_stock_receipt(uuid, jsonb, text, uuid)
  from public, anon, authenticated;
revoke all on function public.adjust_internal_stock(uuid, integer, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_internal_stock_receipt(jsonb, jsonb, uuid) to service_role;
grant execute on function public.confirm_internal_stock_receipt(uuid, jsonb, text, uuid) to service_role;
grant execute on function public.adjust_internal_stock(uuid, integer, text, text, uuid) to service_role;
revoke all on function public.select_order_fulfillment(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.select_order_fulfillment(uuid, text, jsonb) to service_role;

commit;
