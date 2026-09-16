-- ORC-03: nucleo transacional passivo. A ativacao dos writers HTTP pertence a ORC-07.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema if not exists private;

alter table public.supplier_balance_movements
  add column if not exists supplier_settlement_id uuid references public.supplier_settlements(id) on delete restrict;

create unique index if not exists supplier_balance_settlement_usage_unique
  on public.supplier_balance_movements (supplier_settlement_id)
  where supplier_settlement_id is not null and movement_type = 'credit_usage';

create index if not exists supplier_settlements_prepared_credit_idx
  on public.supplier_settlements (fornecedor_dslite_id)
  where status = 'prepared' and credit_amount > 0;

-- Debitos manuais e liquidacoes usam a trava transacional ja existente por fornecedor.
create or replace function public.enforce_supplier_credit_non_negative()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  current_balance numeric;
  reserved_amount numeric;
begin
  if new.fornecedor_id = '2' or new.status <> 'confirmed' or new.amount >= 0 then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.fornecedor_id));
  select coalesce(sum(amount), 0) into current_balance
    from public.supplier_balance_movements
    where fornecedor_id = new.fornecedor_id and status = 'confirmed' and id <> new.id;
  select coalesce(sum(credit_amount), 0) into reserved_amount
    from public.supplier_settlements
    where fornecedor_dslite_id = new.fornecedor_id and status = 'prepared';
  if current_balance + new.amount - reserved_amount < 0 then
    raise exception 'Crédito confirmado disponível insuficiente para este fornecedor.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.supplier_oracle_valid_cnpj(value text)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare
  normalized text := pg_catalog.regexp_replace(value, '[^0-9]', '', 'g');
  total integer;
  digit integer;
  position integer;
begin
  if normalized !~ '^[0-9]{14}$' or normalized ~ '^([0-9])\1{13}$' then return false; end if;
  total := 0;
  for position in 1..12 loop
    total := total + pg_catalog.substr(normalized, position, 1)::integer
      * case when position <= 4 then 6 - position else 14 - position end;
  end loop;
  digit := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  if digit <> pg_catalog.substr(normalized, 13, 1)::integer then return false; end if;
  total := 0;
  for position in 1..13 loop
    total := total + pg_catalog.substr(normalized, position, 1)::integer
      * case when position <= 5 then 7 - position else 15 - position end;
  end loop;
  digit := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  return digit = pg_catalog.substr(normalized, 14, 1)::integer;
end;
$$;

create or replace function private.supplier_oracle_available_credit(p_supplier_id text)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount) from public.supplier_balance_movements
    where fornecedor_id = p_supplier_id and status = 'confirmed'), 0)
    - coalesce((select sum(credit_amount) from public.supplier_settlements
      where fornecedor_dslite_id = p_supplier_id and status = 'prepared'), 0);
$$;

create or replace function private.supplier_oracle_assert_purchase(
  p_compra_id uuid, p_supplier_id text, p_allowed_settlement uuid default null
) returns public.pedidos language plpgsql security definer set search_path = '' as $$
declare
  purchase public.compras;
  sale public.pedidos;
  sale_count integer;
begin
  select * into purchase from public.compras where id = p_compra_id;
  if not found or purchase.fornecedor_id is distinct from p_supplier_id
     or purchase.supplier_payment_mode is distinct from 'prepaid_pix'
     or purchase.supplier_payment_status is distinct from 'pending'
     or purchase.supply_status is distinct from 'ready'
     or purchase.supplier_payment_amount is null or purchase.supplier_payment_amount <= 0
     or purchase.supplier_payment_amount <> pg_catalog.round(purchase.supplier_payment_amount, 2)
     or pg_catalog.lower(coalesce(purchase.status, '')) = 'cancelado'
     or pg_catalog.lower(coalesce(purchase.status_dslite, '')) in
       ('cancelado', 'revisão', 'revisao', 'aguardando informações', 'aguardando informacoes')
     or purchase.supplier_settlement_id is distinct from p_allowed_settlement
     or pg_catalog.left(purchase.id::text, 6) = 'b17d01' then
    raise exception 'Compra não elegível ou alterada: %', p_compra_id using errcode = 'P0001';
  end if;
  select count(*) into sale_count from public.pedidos
    where dslite_id = purchase.dsid and (ml_bundle_primary is true or ml_bundle_primary is null)
      and coalesce(snapshot_source, '') not in ('bnt_d01_production_clone', 'bnt_d05_inventory_mock');
  if sale_count <> 1 then
    raise exception 'Venda ausente ou ambígua para compra: %', p_compra_id using errcode = 'P0001';
  end if;
  select * into sale from public.pedidos
    where dslite_id = purchase.dsid and (ml_bundle_primary is true or ml_bundle_primary is null)
      and coalesce(snapshot_source, '') not in ('bnt_d01_production_clone', 'bnt_d05_inventory_mock')
    for share;
  if sale.situacao::text not in
       ('aberto', 'pendente', 'preparando', 'pronto_envio', 'etiqueta_impressa',
        'coletado', 'em_transito', 'saiu_entrega', 'dest_ausente', 'atendido', 'faturado', 'entregue')
     or sale.snapshot_incompleto is true
     or coalesce(sale.snapshot_pendencias::text, 'null') not in ('null', '[]', '{}', '""')
     or sale.ml_claim_id is not null
     or sale.label_type is distinct from 'real'
     or sale.label_delivery_channel not in ('dslite', 'whatsapp')
     or sale.label_delivered_at is null
     or exists(select 1 from public.supplier_settlement_items item
       where item.compra_id = p_compra_id and item.released_at is null
         and (p_allowed_settlement is null or item.settlement_id <> p_allowed_settlement)) then
    raise exception 'Venda, etiqueta ou alocação não elegível: %', p_compra_id using errcode = 'P0001';
  end if;
  return sale;
end;
$$;

-- Somente transicoes preparadas sao permitidas; historico final e imutavel.
create or replace function private.supplier_oracle_guard_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.status <> 'prepared' then
    raise exception 'Liquidação final é imutável.' using errcode = 'P0001';
  end if;
  if new.status not in ('confirmed', 'cancelled')
     or (to_jsonb(new) - array['status','payment_reference','receipt_path','notes','version','confirmed_by','confirmed_at','cancelled_by','cancelled_at','updated_at'])
       <> (to_jsonb(old) - array['status','payment_reference','receipt_path','notes','version','confirmed_by','confirmed_at','cancelled_by','cancelled_at','updated_at']) then
    raise exception 'Liquidação preparada não pode ser alterada.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_oracle_settlement_guard on public.supplier_settlements;
create trigger supplier_oracle_settlement_guard
  before update or delete on public.supplier_settlements
  for each row execute function private.supplier_oracle_guard_settlement();

create or replace function private.supplier_oracle_guard_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare settlement_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Item de liquidação é imutável.' using errcode = 'P0001';
  end if;
  select status into settlement_status from public.supplier_settlements
    where id = old.settlement_id;
  if settlement_status <> 'cancelled'
     or old.released_at is not null or new.released_at is null
     or (to_jsonb(new) - 'released_at') <> (to_jsonb(old) - 'released_at') then
    raise exception 'Item de liquidação é imutável.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_oracle_item_guard on public.supplier_settlement_items;
create trigger supplier_oracle_item_guard
  before update or delete on public.supplier_settlement_items
  for each row execute function private.supplier_oracle_guard_item();

create or replace function private.supplier_oracle_guard_credit_usage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.supplier_settlement_id is not null then
    raise exception 'Uso de crédito confirmado é imutável.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists supplier_oracle_credit_usage_guard on public.supplier_balance_movements;
create trigger supplier_oracle_credit_usage_guard
  before update or delete on public.supplier_balance_movements
  for each row execute function private.supplier_oracle_guard_credit_usage();

-- A aplicacao so chama as funcoes abaixo via service_role. Nenhuma escrita direta nas tabelas.
revoke insert, update on public.supplier_settlements, public.supplier_settlement_items from service_role;
revoke all on function private.supplier_oracle_valid_cnpj(text) from public, anon, authenticated;
revoke all on function private.supplier_oracle_available_credit(text) from public, anon, authenticated;
revoke all on function private.supplier_oracle_assert_purchase(uuid,text,uuid) from public, anon, authenticated;
revoke all on function private.supplier_oracle_guard_settlement() from public, anon, authenticated;
revoke all on function private.supplier_oracle_guard_item() from public, anon, authenticated;
revoke all on function private.supplier_oracle_guard_credit_usage() from public, anon, authenticated;

create or replace function public.supplier_oracle_credit_preview(p_supplier_id text)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(0, private.supplier_oracle_available_credit(p_supplier_id));
$$;

create or replace function public.supplier_oracle_prepare(
  p_supplier_id text, p_compra_ids uuid[], p_credit_amount numeric,
  p_idempotency_key text, p_fingerprint text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  supplier public.fornecedores;
  purchase public.compras;
  sale public.pedidos;
  existing public.supplier_settlements;
  settlement_id uuid;
  normalized_cnpj text;
  gross numeric(14,2) := 0;
  remaining_credit numeric(14,2);
  item_credit numeric(14,2);
  purchase_count integer := 0;
  account_count integer;
begin
  if p_supplier_id is null or p_supplier_id !~ '^[0-9]{1,20}$'
     or p_compra_ids is null or pg_catalog.cardinality(p_compra_ids) < 1
     or pg_catalog.cardinality(p_compra_ids) > 100
     or p_credit_amount is null or p_credit_amount < 0
     or p_credit_amount <> pg_catalog.round(p_credit_amount, 2)
     or p_idempotency_key is null or pg_catalog.length(p_idempotency_key) > 100
     or p_idempotency_key !~ '^[A-Za-z0-9:_-]{8,100}$'
     or p_fingerprint !~ '^[0-9a-f]{64}$'
     or nullif(pg_catalog.btrim(p_actor), '') is null then
    raise exception 'Parâmetros da liquidação inválidos.' using errcode = '22023';
  end if;
  if (select count(*) from pg_catalog.unnest(p_compra_ids))
     <> (select count(distinct ids.compra_id) from pg_catalog.unnest(p_compra_ids) as ids(compra_id))
     or pg_catalog.array_position(p_compra_ids, null) is not null then
    raise exception 'Compras repetidas ou vazias.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_supplier_id));
  select * into existing from public.supplier_settlements where idempotency_key = p_idempotency_key;
  if found then
    if existing.request_fingerprint <> p_fingerprint
       or existing.fornecedor_dslite_id <> p_supplier_id then
      raise exception 'Chave de idempotência reutilizada com conteúdo diferente.' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('id', existing.id, 'status', existing.status,
      'version', existing.version, 'replayed', true);
  end if;

  select * into supplier from public.fornecedores
    where dslite_id = p_supplier_id for update;
  if not found or supplier.ativo is not true or nullif(pg_catalog.btrim(supplier.supplier_pix_key), '') is null then
    raise exception 'Conta do fornecedor inválida.' using errcode = 'P0001';
  end if;
  normalized_cnpj := pg_catalog.regexp_replace(coalesce(supplier.cnpj, ''), '[^0-9]', '', 'g');
  if private.supplier_oracle_valid_cnpj(supplier.cnpj) is not true then
    raise exception 'CNPJ do fornecedor inválido.' using errcode = 'P0001';
  end if;
  select count(*) into account_count from public.fornecedores f
    where pg_catalog.regexp_replace(coalesce(f.cnpj, ''), '[^0-9]', '', 'g') = normalized_cnpj
      and pg_catalog.btrim(f.supplier_pix_key) = pg_catalog.btrim(supplier.supplier_pix_key);
  if account_count <> 1 then
    raise exception 'Conta financeira compartilhada ou ambígua.' using errcode = 'P0001';
  end if;

  for purchase in select c.* from public.compras c
    where c.id = any(p_compra_ids) order by c.id for update loop
    sale := private.supplier_oracle_assert_purchase(purchase.id, p_supplier_id);
    gross := gross + purchase.supplier_payment_amount;
    purchase_count := purchase_count + 1;
  end loop;
  if purchase_count <> pg_catalog.cardinality(p_compra_ids) or gross <= 0 then
    raise exception 'Compra ausente ou lote vazio.' using errcode = 'P0001';
  end if;
  if p_credit_amount > gross or p_credit_amount > private.supplier_oracle_available_credit(p_supplier_id) then
    raise exception 'Crédito confirmado disponível insuficiente.' using errcode = '23514';
  end if;

  insert into public.supplier_settlements (
    fornecedor_id, fornecedor_dslite_id, fornecedor_nome_snapshot, cnpj_snapshot,
    supplier_pix_key_snapshot, contact_phone_snapshot, gross_amount, credit_amount,
    pix_amount, idempotency_key, request_fingerprint, prepared_by
  ) values (
    supplier.id, p_supplier_id, coalesce(nullif(supplier.apelido, ''), supplier.nome), normalized_cnpj,
    pg_catalog.btrim(supplier.supplier_pix_key), supplier.telefone, gross, p_credit_amount,
    gross - p_credit_amount, p_idempotency_key, p_fingerprint, p_actor
  ) returning id into settlement_id;

  remaining_credit := p_credit_amount;
  for purchase in select c.* from public.compras c
    where c.id = any(p_compra_ids) order by c.data_criacao, c.id loop
    select * into sale from public.pedidos p
      where p.dslite_id = purchase.dsid
        and (p.ml_bundle_primary is true or p.ml_bundle_primary is null)
        and coalesce(p.snapshot_source, '') not in ('bnt_d01_production_clone', 'bnt_d05_inventory_mock');
    item_credit := least(remaining_credit, purchase.supplier_payment_amount);
    insert into public.supplier_settlement_items (
      settlement_id, compra_id, pedido_id, dsid_snapshot, sale_number_snapshot,
      ml_order_id_snapshot, product_description_snapshot, quantity_snapshot,
      gross_amount, credit_amount, pix_amount
    ) values (
      settlement_id, purchase.id, sale.id, purchase.dsid, sale.numero,
      sale.ml_order_id, purchase.produto_descricao, purchase.quantidade,
      purchase.supplier_payment_amount, item_credit,
      purchase.supplier_payment_amount - item_credit
    );
    update public.compras set supplier_settlement_id = settlement_id where id = purchase.id;
    remaining_credit := remaining_credit - item_credit;
  end loop;
  if remaining_credit <> 0 then
    raise exception 'Distribuição do crédito não fechou.' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('id', settlement_id, 'status', 'prepared',
    'version', 1, 'replayed', false);
end;
$$;

create or replace function public.supplier_oracle_confirm(
  p_settlement_id uuid, p_expected_version integer, p_reference text,
  p_notes text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  settlement public.supplier_settlements;
  supplier public.fornecedores;
  purchase public.compras;
  item public.supplier_settlement_items;
  sale public.pedidos;
  item_count integer := 0;
  gross numeric(14,2) := 0;
  credit numeric(14,2) := 0;
  pix numeric(14,2) := 0;
  normalized_reference text := nullif(pg_catalog.btrim(p_reference), '');
  normalized_notes text := nullif(pg_catalog.btrim(p_notes), '');
begin
  if p_settlement_id is null or p_expected_version is null or p_expected_version < 1
     or pg_catalog.length(coalesce(p_reference, '')) > 200
     or pg_catalog.length(coalesce(p_notes, '')) > 1000
     or nullif(pg_catalog.btrim(p_actor), '') is null then
    raise exception 'Parâmetros de confirmação inválidos.' using errcode = '22023';
  end if;
  select * into settlement from public.supplier_settlements where id = p_settlement_id;
  if not found then raise exception 'Liquidação não encontrada.' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(settlement.fornecedor_dslite_id));
  select * into settlement from public.supplier_settlements where id = p_settlement_id for update;
  if settlement.status = 'confirmed' then
    if settlement.payment_reference is distinct from normalized_reference
       or settlement.notes is distinct from normalized_notes then
      raise exception 'Confirmação repetida com conteúdo diferente.' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('id', settlement.id, 'status', settlement.status,
      'version', settlement.version, 'replayed', true);
  end if;
  if settlement.status <> 'prepared' or settlement.version <> p_expected_version then
    raise exception 'Liquidação mudou ou não está preparada.' using errcode = 'P0001';
  end if;
  select * into supplier from public.fornecedores
    where id = settlement.fornecedor_id for share;
  if not found or supplier.ativo is not true
     or supplier.dslite_id is distinct from settlement.fornecedor_dslite_id
     or private.supplier_oracle_valid_cnpj(supplier.cnpj) is not true
     or pg_catalog.regexp_replace(supplier.cnpj, '[^0-9]', '', 'g') <> settlement.cnpj_snapshot
     or pg_catalog.btrim(supplier.supplier_pix_key) <> settlement.supplier_pix_key_snapshot
     or (select count(*) from public.fornecedores f
       where pg_catalog.regexp_replace(coalesce(f.cnpj, ''), '[^0-9]', '', 'g') = settlement.cnpj_snapshot
         and pg_catalog.btrim(f.supplier_pix_key) = settlement.supplier_pix_key_snapshot) <> 1 then
    raise exception 'Cadastro financeiro mudou após a preparação.' using errcode = 'P0001';
  end if;
  if settlement.pix_amount = 0 and normalized_reference is not null then
    raise exception 'Liquidação integral por crédito não tem referência PIX.' using errcode = '22023';
  end if;
  if settlement.credit_amount > 0
     and private.supplier_oracle_available_credit(settlement.fornecedor_dslite_id) < 0 then
    raise exception 'Reserva de crédito não está coberta.' using errcode = '23514';
  end if;

  for item in select i.* from public.supplier_settlement_items i
    where i.settlement_id = p_settlement_id and i.released_at is null
    order by i.compra_id loop
    select * into purchase from public.compras where id = item.compra_id for update;
    sale := private.supplier_oracle_assert_purchase(item.compra_id,
      settlement.fornecedor_dslite_id, p_settlement_id);
    if sale.id <> item.pedido_id
       or purchase.supplier_payment_amount <> item.gross_amount
       or purchase.dsid <> item.dsid_snapshot then
      raise exception 'Fotografia da compra mudou: %', item.compra_id using errcode = 'P0001';
    end if;
    item_count := item_count + 1;
    gross := gross + item.gross_amount;
    credit := credit + item.credit_amount;
    pix := pix + item.pix_amount;
  end loop;
  if item_count = 0 or gross <> settlement.gross_amount
     or credit <> settlement.credit_amount or pix <> settlement.pix_amount then
    raise exception 'Itens não fecham com o cabeçalho.' using errcode = 'P0001';
  end if;

  update public.supplier_settlements set status = 'confirmed',
    payment_reference = normalized_reference, notes = normalized_notes,
    confirmed_by = p_actor, confirmed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp(), version = version + 1
    where id = p_settlement_id;
  if settlement.credit_amount > 0 then
    insert into public.supplier_balance_movements (
      fornecedor_id, fornecedor_nome, movement_type, amount, reference,
      notes, created_by, movement_key, status, source, confirmed_at,
      confirmed_by, supplier_settlement_id
    ) values (
      settlement.fornecedor_dslite_id, settlement.fornecedor_nome_snapshot,
      'credit_usage', -settlement.credit_amount, 'Liquidação ' || settlement.id::text,
      'Crédito aplicado na liquidação consolidada', p_actor,
      'supplier_settlement:credit_usage:' || settlement.id::text,
      'confirmed', 'supplier_settlement', pg_catalog.clock_timestamp(),
      p_actor, settlement.id
    );
  end if;
  update public.compras c set supplier_payment_status = 'paid',
    supplier_payment_confirmed_at = pg_catalog.clock_timestamp(),
    supplier_payment_confirmed_by = p_actor,
    supplier_payment_reference = normalized_reference,
    supplier_payment_notes = 'Liquidação ' || settlement.id::text
    where c.supplier_settlement_id = p_settlement_id;
  insert into public.jobs (tipo, status, total, unidade_progresso, created_by, dedupe_key)
    values ('supplier_settlement_postprocess', 'pendente', item_count, 'itens',
      p_actor::uuid, 'supplier_settlement_postprocess:' || settlement.id::text);
  return pg_catalog.jsonb_build_object('id', settlement.id, 'status', 'confirmed',
    'version', settlement.version + 1, 'replayed', false);
end;
$$;

create or replace function public.supplier_oracle_cancel(
  p_settlement_id uuid, p_expected_version integer, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare settlement public.supplier_settlements;
begin
  if p_settlement_id is null or p_expected_version is null or p_expected_version < 1
     or nullif(pg_catalog.btrim(p_actor), '') is null then
    raise exception 'Parâmetros de cancelamento inválidos.' using errcode = '22023';
  end if;
  select * into settlement from public.supplier_settlements where id = p_settlement_id;
  if not found then raise exception 'Liquidação não encontrada.' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(settlement.fornecedor_dslite_id));
  select * into settlement from public.supplier_settlements where id = p_settlement_id for update;
  if settlement.status = 'cancelled' then
    return pg_catalog.jsonb_build_object('id', settlement.id, 'status', settlement.status,
      'version', settlement.version, 'replayed', true);
  end if;
  if settlement.status <> 'prepared' or settlement.version <> p_expected_version then
    raise exception 'Liquidação mudou ou já foi confirmada.' using errcode = 'P0001';
  end if;
  update public.supplier_settlements set status = 'cancelled',
    cancelled_by = p_actor, cancelled_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp(), version = version + 1
    where id = p_settlement_id;
  update public.supplier_settlement_items set released_at = pg_catalog.clock_timestamp()
    where settlement_id = p_settlement_id and released_at is null;
  update public.compras set supplier_settlement_id = null
    where supplier_settlement_id = p_settlement_id;
  return pg_catalog.jsonb_build_object('id', settlement.id, 'status', 'cancelled',
    'version', settlement.version + 1, 'replayed', false);
end;
$$;

revoke all on function public.supplier_oracle_credit_preview(text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_prepare(text,uuid[],numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_confirm(uuid,integer,text,text,text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_cancel(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.supplier_oracle_credit_preview(text) to service_role;
grant execute on function public.supplier_oracle_prepare(text,uuid[],numeric,text,text,text) to service_role;
grant execute on function public.supplier_oracle_confirm(uuid,integer,text,text,text) to service_role;
grant execute on function public.supplier_oracle_cancel(uuid,integer,text) to service_role;

notify pgrst, 'reload schema';
