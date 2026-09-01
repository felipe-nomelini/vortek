set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.notas_fiscais_retorno (
  id uuid primary key default uuid_generate_v4(),
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  tipo_retorno text not null,
  escopo text not null,
  motivo text not null,
  status text not null default 'pending',
  identificador_interno text not null,
  tipo_ambiente smallint not null,
  nfe_original_chave text not null,
  nfe_original_numero text,
  itens_snapshot jsonb not null default '[]'::jsonb,
  valor_total numeric(12,2) not null default 0,
  nfe_provider text not null default 'brasilnfe',
  nfe_external_id text,
  nfe_chave text,
  nfe_numero text,
  nfe_serie text,
  nfe_protocolo text,
  nfe_xml text,
  nfe_danfe_url text,
  erro text,
  previsualizacao_validada_em timestamptz,
  nfe_last_sync_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notas_fiscais_retorno_tipo_check check (
    tipo_retorno in (
      'devolucao_pos_recebimento',
      'recusa_total',
      'recusa_parcial',
      'nao_localizado'
    )
  ),
  constraint notas_fiscais_retorno_escopo_check check (escopo in ('total', 'parcial')),
  constraint notas_fiscais_retorno_status_check check (
    status in ('pending', 'processing', 'authorized', 'interrupted', 'rejected', 'cancelled')
  ),
  constraint notas_fiscais_retorno_identificador_unique unique (identificador_interno),
  constraint notas_fiscais_retorno_ambiente_check check (tipo_ambiente in (1, 2)),
  constraint notas_fiscais_retorno_chave_original_check check (nfe_original_chave ~ '^[0-9]{44}$'),
  constraint notas_fiscais_retorno_itens_check check (
    jsonb_typeof(itens_snapshot) = 'array' and jsonb_array_length(itens_snapshot) > 0
  ),
  constraint notas_fiscais_retorno_valor_check check (valor_total > 0)
);

create index if not exists notas_fiscais_retorno_pedido_id_idx
  on public.notas_fiscais_retorno (pedido_id);

create index if not exists notas_fiscais_retorno_status_created_idx
  on public.notas_fiscais_retorno (status, created_at desc);

create index if not exists notas_fiscais_retorno_created_at_idx
  on public.notas_fiscais_retorno (created_at desc);

drop trigger if exists set_updated_at_notas_fiscais_retorno on public.notas_fiscais_retorno;
create trigger set_updated_at_notas_fiscais_retorno
before update on public.notas_fiscais_retorno
for each row execute function public.set_updated_at();

alter table public.notas_fiscais_retorno enable row level security;
revoke all on table public.notas_fiscais_retorno from anon, authenticated;

alter table public.nf_auditoria_eventos
  add column if not exists nota_retorno_id uuid;

do $bnt_d04$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'nf_auditoria_eventos_nota_retorno_id_fkey'
      and conrelid = 'public.nf_auditoria_eventos'::regclass
  ) then
    alter table public.nf_auditoria_eventos
      add constraint nf_auditoria_eventos_nota_retorno_id_fkey
      foreign key (nota_retorno_id)
      references public.notas_fiscais_retorno(id)
      on delete set null;
  end if;
end;
$bnt_d04$;

create index if not exists nf_auditoria_eventos_nota_retorno_id_idx
  on public.nf_auditoria_eventos (nota_retorno_id, created_at desc);

create or replace function public.reserve_nota_fiscal_retorno(
  p_pedido_id uuid,
  p_tipo_retorno text,
  p_motivo text,
  p_itens jsonb,
  p_identificador_interno text,
  p_tipo_ambiente smallint,
  p_created_by uuid
)
returns public.notas_fiscais_retorno
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_snapshot jsonb;
  v_valor_total numeric(12,2);
  v_total_vendido numeric;
  v_total_solicitado numeric;
  v_escopo text;
  v_result public.notas_fiscais_retorno%rowtype;
begin
  if p_tipo_retorno not in (
    'devolucao_pos_recebimento', 'recusa_total', 'recusa_parcial', 'nao_localizado'
  ) then
    raise exception 'Tipo de retorno fiscal inválido';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 15 then
    raise exception 'O motivo deve ter no mínimo 15 caracteres';
  end if;
  if p_tipo_ambiente not in (1, 2) then
    raise exception 'Ambiente fiscal inválido';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um item para retorno';
  end if;

  perform pg_advisory_xact_lock(hashtext('nfe_retorno:' || p_pedido_id::text));

  select * into v_result
  from public.notas_fiscais_retorno
  where identificador_interno = p_identificador_interno;

  if found then
    if v_result.pedido_id <> p_pedido_id
      or v_result.tipo_retorno <> p_tipo_retorno
      or v_result.motivo <> btrim(p_motivo)
      or v_result.tipo_ambiente <> p_tipo_ambiente
    then
      raise exception 'A chave de idempotência já foi usada com dados diferentes';
    end if;
    return v_result;
  end if;

  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Venda não encontrada';
  end if;
  if coalesce(v_pedido.snapshot_source, '') = 'bnt_d01_production_clone' then
    raise exception 'Amostra de homologação é somente leitura';
  end if;
  if lower(btrim(coalesce(v_pedido.nfe_status, ''))) not in ('authorized', 'autorizada', 'autorizado') then
    raise exception 'A venda precisa ter NF-e autorizada';
  end if;
  if coalesce(v_pedido.nfe_chave, '') !~ '^[0-9]{44}$' then
    raise exception 'A NF-e original não possui chave válida';
  end if;
  if coalesce(btrim(v_pedido.nfe_xml), '') = '' then
    raise exception 'O XML autorizado da NF-e original é obrigatório';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_itens) as s(pedido_item_id uuid, quantidade_retorno numeric, nitem_original integer)
    where s.pedido_item_id is null
      or coalesce(s.quantidade_retorno, 0) <= 0
      or coalesce(s.nitem_original, 0) <= 0
  ) then
    raise exception 'Item, quantidade ou referência original inválida';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_itens) as s(pedido_item_id uuid, quantidade_retorno numeric, nitem_original integer)
  ) <> (
    select count(distinct s.pedido_item_id)
    from jsonb_to_recordset(p_itens) as s(pedido_item_id uuid, quantidade_retorno numeric, nitem_original integer)
  ) then
    raise exception 'O mesmo item não pode ser informado mais de uma vez';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_itens) as s(pedido_item_id uuid, quantidade_retorno numeric, nitem_original integer)
    left join public.pedido_itens pi
      on pi.id = s.pedido_item_id
     and pi.pedido_id = p_pedido_id
    where pi.id is null
  ) then
    raise exception 'Um dos itens não pertence à venda selecionada';
  end if;

  if exists (
    with solicitado as (
      select s.pedido_item_id, s.quantidade_retorno
      from jsonb_to_recordset(p_itens) as s(pedido_item_id uuid, quantidade_retorno numeric, nitem_original integer)
    ), reservado as (
      select
        (item->>'pedido_item_id')::uuid as pedido_item_id,
        sum((item->>'quantidade_retorno')::numeric) as quantidade
      from public.notas_fiscais_retorno nfr
      cross join lateral jsonb_array_elements(nfr.itens_snapshot) item
      where nfr.pedido_id = p_pedido_id
        and nfr.status in ('pending', 'processing', 'authorized')
      group by (item->>'pedido_item_id')::uuid
    )
    select 1
    from solicitado s
    join public.pedido_itens pi on pi.id = s.pedido_item_id
    left join reservado r on r.pedido_item_id = s.pedido_item_id
    where s.quantidade_retorno + coalesce(r.quantidade, 0) > pi.quantidade
  ) then
    raise exception 'A quantidade solicitada excede o saldo disponível para retorno';
  end if;

  select
    jsonb_agg(
      jsonb_build_object(
        'pedido_item_id', pi.id,
        'nitem_original', s.nitem_original,
        'titulo', pi.titulo,
        'seller_sku', pi.seller_sku,
        'ml_item_id', pi.ml_item_id,
        'quantidade_vendida', pi.quantidade,
        'quantidade_retorno', s.quantidade_retorno,
        'valor_unitario', pi.valor_unitario,
        'valor_total', round((pi.valor_unitario * s.quantidade_retorno)::numeric, 2),
        'ncm', pi.ncm,
        'cest', pi.cest,
        'gtin', pi.gtin,
        'origem_fiscal', pi.origem_fiscal,
        'csosn', pi.csosn,
        'cfop_original', pi.cfop_sugerido
      ) order by s.nitem_original
    ),
    round(sum(pi.valor_unitario * s.quantidade_retorno)::numeric, 2),
    sum(s.quantidade_retorno)
  into v_snapshot, v_valor_total, v_total_solicitado
  from jsonb_to_recordset(p_itens) as s(pedido_item_id uuid, quantidade_retorno numeric, nitem_original integer)
  join public.pedido_itens pi on pi.id = s.pedido_item_id and pi.pedido_id = p_pedido_id;

  select coalesce(sum(quantidade), 0) into v_total_vendido
  from public.pedido_itens
  where pedido_id = p_pedido_id;

  v_escopo := case when v_total_solicitado = v_total_vendido then 'total' else 'parcial' end;
  if p_tipo_retorno in ('recusa_total', 'nao_localizado') and v_escopo <> 'total' then
    raise exception 'Este motivo exige retorno total da venda';
  end if;
  if p_tipo_retorno = 'recusa_parcial' and v_escopo <> 'parcial' then
    raise exception 'Recusa parcial exige ao menos um item ou quantidade parcial';
  end if;

  insert into public.notas_fiscais_retorno (
    pedido_id, tipo_retorno, escopo, motivo, identificador_interno,
    tipo_ambiente, nfe_original_chave, nfe_original_numero,
    itens_snapshot, valor_total, created_by
  ) values (
    p_pedido_id, p_tipo_retorno, v_escopo, btrim(p_motivo), p_identificador_interno,
    p_tipo_ambiente, v_pedido.nfe_chave, v_pedido.nota_fiscal_numero,
    v_snapshot, v_valor_total, p_created_by
  )
  on conflict (identificador_interno) do update
    set identificador_interno = excluded.identificador_interno
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.reserve_nota_fiscal_retorno(uuid, text, text, jsonb, text, smallint, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_nota_fiscal_retorno(uuid, text, text, jsonb, text, smallint, uuid)
  to service_role;

comment on table public.notas_fiscais_retorno is
  'Documentos fiscais de devolução, recusa e retorno vinculados a uma NF-e de venda.';

-- Rollback operacional (somente quando explicitamente autorizado):
-- drop function if exists public.reserve_nota_fiscal_retorno(uuid, text, text, jsonb, text, smallint, uuid);
-- alter table public.nf_auditoria_eventos drop column if exists nota_retorno_id;
-- drop table if exists public.notas_fiscais_retorno;
