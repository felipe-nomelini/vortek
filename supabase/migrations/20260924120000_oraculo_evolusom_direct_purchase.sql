-- ORC-07: a compra direta da Evolusom usa a mesma liquidação transacional.
-- Sem backfill; não altera compras, liquidações ou créditos existentes.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.supplier_settlement_items
  add column if not exists source_snapshot text not null default 'dslite';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.supplier_settlement_items'::regclass
      and conname = 'supplier_settlement_items_source_snapshot_check') then
    alter table public.supplier_settlement_items
      add constraint supplier_settlement_items_source_snapshot_check
      check (source_snapshot in ('dslite','evolusom'));
  end if;
end $$;

alter table public.supplier_cancellation_cases drop constraint if exists supplier_cancellation_cases_source_check;
alter table public.supplier_cancellation_cases add constraint supplier_cancellation_cases_source_check
  check (source in ('ml_sync','ml_webhook','dslite_sync','evolusom_sync','manual_reconcile'));

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
     or purchase.supplier_payment_amount is null or purchase.supplier_payment_amount <= 0
     or purchase.supplier_payment_amount <> pg_catalog.round(purchase.supplier_payment_amount, 2)
     or pg_catalog.lower(coalesce(purchase.status, '')) = 'cancelado'
     or pg_catalog.lower(coalesce(purchase.status_dslite, '')) = 'cancelado'
     or (purchase.dsid is null and (purchase.evolusom_order_id is null or purchase.pedido_id is null))
     or (purchase.dsid is not null and purchase.evolusom_order_id is not null)
     or purchase.supplier_settlement_id is distinct from p_allowed_settlement
     or pg_catalog.left(purchase.id::text, 6) = 'b17d01'
     or exists (select 1 from public.supplier_cancellation_cases cc
       where cc.compra_id = p_compra_id and cc.status = 'open') then
    raise exception 'Compra não pode entrar no fechamento: %', p_compra_id using errcode = 'P0001';
  end if;

  if purchase.evolusom_order_id is not null then
    select * into sale from public.pedidos
      where id = purchase.pedido_id and evolusom_order_id = purchase.evolusom_order_id
        and coalesce(snapshot_source, '') not in ('bnt_d01_production_clone', 'bnt_d05_inventory_mock')
      for share;
    if not found then
      raise exception 'Venda Evolusom não vinculada à compra: %', p_compra_id using errcode = 'P0001';
    end if;
  else
    select count(*) into sale_count from public.pedidos
      where dslite_id = purchase.dsid and (ml_bundle_primary is true or ml_bundle_primary is null)
        and coalesce(snapshot_source, '') not in ('bnt_d01_production_clone', 'bnt_d05_inventory_mock');
    if sale_count <> 1 then
      raise exception 'Venda da compra ausente ou duplicada: %', p_compra_id using errcode = 'P0001';
    end if;
    select * into sale from public.pedidos
      where dslite_id = purchase.dsid and (ml_bundle_primary is true or ml_bundle_primary is null)
        and coalesce(snapshot_source, '') not in ('bnt_d01_production_clone', 'bnt_d05_inventory_mock')
      for share;
  end if;
  if pg_catalog.lower(coalesce(sale.situacao::text, '')) = 'cancelado'
     or exists (select 1 from public.supplier_settlement_items item
       where item.compra_id = p_compra_id and item.released_at is null
         and (p_allowed_settlement is null or item.settlement_id <> p_allowed_settlement)) then
    raise exception 'Venda cancelada ou compra já incluída: %', p_compra_id using errcode = 'P0001';
  end if;
  return sale;
end;
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
    sale := private.supplier_oracle_assert_purchase(purchase.id, p_supplier_id);
    item_credit := least(remaining_credit, purchase.supplier_payment_amount);
    insert into public.supplier_settlement_items (
      settlement_id, compra_id, pedido_id, dsid_snapshot, source_snapshot, sale_number_snapshot,
      ml_order_id_snapshot, product_description_snapshot, quantity_snapshot,
      gross_amount, credit_amount, pix_amount
    ) values (
      settlement_id, purchase.id, sale.id,
      coalesce(purchase.evolusom_order_id::text, purchase.dsid),
      case when purchase.evolusom_order_id is null then 'dslite' else 'evolusom' end,
      sale.numero, sale.ml_order_id, purchase.produto_descricao, purchase.quantidade,
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
       or coalesce(purchase.evolusom_order_id::text, purchase.dsid) is distinct from item.dsid_snapshot
       or (case when purchase.evolusom_order_id is null then 'dslite' else 'evolusom' end)
         is distinct from item.source_snapshot then
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
    supplier_payment_receipt_path = settlement.receipt_path,
    supplier_payment_notes = coalesce(normalized_notes, 'Liquidação ' || settlement.id::text)
    where c.supplier_settlement_id = p_settlement_id;
  insert into public.jobs (tipo, status, total, unidade_progresso, created_by, dedupe_key)
    values ('supplier_settlement_postprocess', 'pendente', item_count, 'itens',
      p_actor::uuid, 'supplier_settlement_postprocess:' || settlement.id::text);
  return pg_catalog.jsonb_build_object('id', settlement.id, 'status', 'confirmed',
    'version', settlement.version + 1, 'replayed', false);
end;
$$;

create or replace function public.supplier_oracle_record_cancellation(
  p_compra_id uuid, p_pedido_id uuid, p_source text, p_dispatch text, p_evidence jsonb, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  purchase public.compras;
  sale public.pedidos;
  settlement public.supplier_settlements;
  item public.supplier_settlement_items;
  current_case public.supplier_cancellation_cases;
  movement public.supplier_balance_movements;
  kind text;
  result_status text;
  result_resolution text;
  amount numeric(14,2);
  locked_supplier_id text;
begin
  if p_compra_id is null or p_source not in ('ml_sync','ml_webhook','dslite_sync','evolusom_sync','manual_reconcile')
     or p_dispatch not in ('not_dispatched','dispatched','unknown')
     or p_evidence is null or pg_catalog.jsonb_typeof(p_evidence) <> 'object'
     or pg_catalog.length(p_evidence::text) > 4000
     or nullif(pg_catalog.btrim(p_actor), '') is null then
    raise exception 'Cancelamento inválido.' using errcode = '22023';
  end if;
  select * into purchase from public.compras where id = p_compra_id;
  if not found then raise exception 'Compra não encontrada.' using errcode = 'P0002'; end if;
  if purchase.supplier_payment_mode is distinct from 'prepaid_pix'
     or purchase.fornecedor_id is null or purchase.fornecedor_id = '2' then
    return pg_catalog.jsonb_build_object('skipped','supplier_not_applicable');
  end if;
  locked_supplier_id := purchase.fornecedor_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(locked_supplier_id));
  select * into purchase from public.compras where id = p_compra_id;
  if purchase.fornecedor_id is distinct from locked_supplier_id then
    raise exception 'Fornecedor mudou durante o cancelamento.' using errcode = 'P0001';
  end if;
  if purchase.supplier_settlement_id is not null then
    select * into settlement from public.supplier_settlements
      where id = purchase.supplier_settlement_id for update;
  end if;
  select * into purchase from public.compras where id = p_compra_id for update;
  if purchase.fornecedor_id is distinct from locked_supplier_id
     or purchase.supplier_payment_mode is distinct from 'prepaid_pix' then
    raise exception 'Compra mudou durante o cancelamento.' using errcode = 'P0001';
  end if;
  if p_pedido_id is not null then
    select * into sale from public.pedidos where id = p_pedido_id
      and ((purchase.evolusom_order_id is not null
        and p_pedido_id = purchase.pedido_id and evolusom_order_id = purchase.evolusom_order_id)
        or (purchase.evolusom_order_id is null and dslite_id = purchase.dsid)) for share;
    if not found then raise exception 'Venda não vinculada à compra.' using errcode = 'P0001'; end if;
  end if;
  if pg_catalog.lower(coalesce(purchase.status_dslite,'')) not like '%cancelado%'
     and pg_catalog.lower(coalesce(purchase.status,'')) not like '%cancelado%'
     and (p_pedido_id is null or sale.situacao::text <> 'cancelado') then
    raise exception 'Cancelamento ainda não persistido.' using errcode = 'P0001';
  end if;
  select * into current_case from public.supplier_cancellation_cases where compra_id = p_compra_id for update;
  if current_case.id is not null and (p_source = 'dslite_sync' or p_dispatch = 'unknown')
     and current_case.status = 'closed'
     and current_case.classification in ('paid_pre_dispatch','paid_post_dispatch') then
    return pg_catalog.jsonb_build_object('caseId',current_case.id,
      'classification',current_case.classification,'status',current_case.status,
      'movementId',current_case.movement_id,'replayed',true);
  end if;
  if not found then
    select * into movement from public.supplier_balance_movements
      where movement_key = 'cancellation_credit:' || p_compra_id::text;
    if found then
      return pg_catalog.jsonb_build_object('skipped','historical_credit','movementId',movement.id);
    end if;
  end if;
  if settlement.id is not null and settlement.status = 'prepared' then
    perform public.supplier_oracle_cancel(settlement.id, settlement.version, p_actor);
  end if;
  if purchase.supplier_payment_status = 'pending' then
    kind := 'unpaid'; result_status := 'closed'; result_resolution := 'automatic_no_credit';
    update public.compras set supply_status='cancelled',
      supply_status_note='Cancelamento confirmado na origem antes do pagamento',
      supply_status_changed_by=p_actor,supply_status_changed_at=pg_catalog.clock_timestamp()
      where id=p_compra_id and supply_status <> 'cancelled';
  elsif purchase.supplier_payment_status is distinct from 'paid' then
    kind := 'review'; result_status := 'open'; result_resolution := null;
  elsif p_source in ('dslite_sync','evolusom_sync') or p_pedido_id is null or sale.situacao::text <> 'cancelado'
     or purchase.supplier_payment_amount is null or purchase.supplier_payment_amount <= 0 then
    kind := 'review'; result_status := 'open'; result_resolution := null;
  elsif purchase.supplier_settlement_id is not null and settlement.status <> 'confirmed' then
    kind := 'review'; result_status := 'open'; result_resolution := null;
  elsif purchase.supplier_settlement_id is not null and not exists (
    select 1 from public.supplier_settlement_items i
    where i.settlement_id = purchase.supplier_settlement_id and i.compra_id = p_compra_id
      and i.released_at is null and i.gross_amount = purchase.supplier_payment_amount
  ) then
    kind := 'review'; result_status := 'open'; result_resolution := null;
  elsif p_dispatch = 'dispatched' then
    kind := 'paid_post_dispatch'; result_status := 'closed'; result_resolution := 'automatic_no_credit';
  elsif p_dispatch = 'not_dispatched' and p_evidence->>'proof' = 'cancelled_history' then
    kind := 'paid_pre_dispatch'; result_status := 'closed'; result_resolution := 'automatic_pending_credit';
  else
    kind := 'review'; result_status := 'open'; result_resolution := null;
  end if;
  if current_case.id is not null and current_case.classification = 'paid_post_dispatch'
     and kind = 'paid_pre_dispatch' then
    kind := 'review'; result_status := 'open'; result_resolution := null;
  end if;
  if current_case.id is not null then
    if current_case.classification = kind and current_case.status = result_status then
      return pg_catalog.jsonb_build_object('caseId',current_case.id,'classification',kind,
        'status',current_case.status,'movementId',current_case.movement_id,'replayed',true);
    end if;
    if current_case.movement_id is not null or current_case.resolution like 'manual_%' then
      update public.supplier_cancellation_cases set classification='review',status='open',
        evidence=p_evidence,resolution=null,resolution_note=null,resolved_by=null,resolved_at=null,
        version=version+1,updated_at=pg_catalog.clock_timestamp() where id=current_case.id;
      return pg_catalog.jsonb_build_object('caseId',current_case.id,'classification','review',
        'status','open','movementId',current_case.movement_id,'replayed',false);
    end if;
    update public.supplier_cancellation_cases set classification=kind,status=result_status,
      evidence=p_evidence,resolution=result_resolution,
      resolved_by=case when result_status='closed' then p_actor else null end,
      resolved_at=case when result_status='closed' then pg_catalog.clock_timestamp() else null end,
      version=version+1,updated_at=pg_catalog.clock_timestamp() where id=current_case.id;
  else
    insert into public.supplier_cancellation_cases
      (compra_id,pedido_id,fornecedor_id,supplier_settlement_id,classification,status,source,evidence,
       resolution,resolved_by,resolved_at)
    values (p_compra_id,p_pedido_id,purchase.fornecedor_id,purchase.supplier_settlement_id,
      kind,result_status,p_source,p_evidence,result_resolution,
      case when result_status='closed' then p_actor else null end,
      case when result_status='closed' then pg_catalog.clock_timestamp() else null end)
    returning * into current_case;
  end if;
  if kind = 'paid_pre_dispatch' then
    amount := purchase.supplier_payment_amount;
    insert into public.supplier_balance_movements
      (fornecedor_id,fornecedor_nome,movement_type,amount,reference,compra_id,notes,
       created_by,movement_key,status,source,pedido_id,ml_order_id,supplier_settlement_id)
    values (purchase.fornecedor_id,purchase.fornecedor_nome,'cancellation_credit',amount,
      'Cancelamento da compra ' || case when purchase.evolusom_order_id is null then 'DSLite #' || purchase.dsid else 'Evolusom #' || purchase.evolusom_order_id::text end, p_compra_id,
      'Crédito pendente: confirmar com o fornecedor antes de usar.',p_actor,
      'cancellation_credit:' || p_compra_id::text,'pending','ml_cancellation',p_pedido_id,
      sale.ml_order_id,purchase.supplier_settlement_id)
    returning * into movement;
    update public.supplier_cancellation_cases set movement_id=movement.id where id=current_case.id;
  end if;
  return pg_catalog.jsonb_build_object('caseId',current_case.id,'classification',kind,
    'status',result_status,'movementId',movement.id,'replayed',false);
end;
$$;

revoke all on function private.supplier_oracle_assert_purchase(uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.supplier_oracle_prepare(text,uuid[],numeric,text,text,text)
  from public, anon, authenticated;
revoke all on function public.supplier_oracle_confirm(uuid,integer,text,text,text)
  from public, anon, authenticated;
revoke all on function public.supplier_oracle_record_cancellation(uuid,uuid,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.supplier_oracle_prepare(text,uuid[],numeric,text,text,text) to service_role;
grant execute on function public.supplier_oracle_confirm(uuid,integer,text,text,text) to service_role;
grant execute on function public.supplier_oracle_record_cancellation(uuid,uuid,text,text,jsonb,text) to service_role;
