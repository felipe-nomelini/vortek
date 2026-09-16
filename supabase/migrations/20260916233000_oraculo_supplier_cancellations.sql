-- ORC-06: classifica cancelamentos sem reescrever liquidações ou créditos históricos.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.supplier_cancellation_cases (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null unique references public.compras(id) on delete restrict,
  pedido_id uuid references public.pedidos(id) on delete restrict,
  fornecedor_id text not null,
  supplier_settlement_id uuid references public.supplier_settlements(id) on delete restrict,
  movement_id uuid references public.supplier_balance_movements(id) on delete restrict,
  classification text not null check (classification in ('unpaid','paid_pre_dispatch','paid_post_dispatch','review')),
  status text not null check (status in ('open','closed')),
  source text not null check (source in ('ml_sync','ml_webhook','dslite_sync','manual_reconcile')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  resolution text check (resolution in ('automatic_no_credit','automatic_pending_credit','manual_no_credit','manual_pending_credit','manual_compensation')),
  resolution_note text,
  resolved_by text,
  resolved_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists supplier_cancellation_cases_supplier_status_idx
  on public.supplier_cancellation_cases (fornecedor_id,status,created_at desc);
create index if not exists supplier_cancellation_cases_open_purchase_idx
  on public.supplier_cancellation_cases (compra_id) where status = 'open';

alter table public.supplier_balance_movements
  add column if not exists origin_movement_id uuid references public.supplier_balance_movements(id) on delete restrict;
create unique index if not exists supplier_balance_compensation_origin_unique
  on public.supplier_balance_movements (origin_movement_id) where origin_movement_id is not null;

alter table public.supplier_cancellation_cases enable row level security;
revoke all on table public.supplier_cancellation_cases from public, anon, authenticated, service_role;
grant select on table public.supplier_cancellation_cases to service_role;

create or replace function private.supplier_oracle_guard_cancellation_credit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.movement_type = 'cancellation_credit' and new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.fornecedor_id));
    if exists (select 1 from public.supplier_cancellation_cases c
      where c.movement_id = new.id and c.status = 'open') then
      raise exception 'Crédito bloqueado por divergência aberta.' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists supplier_oracle_cancellation_credit_guard on public.supplier_balance_movements;
create trigger supplier_oracle_cancellation_credit_guard
  before insert or update of status on public.supplier_balance_movements
  for each row execute function private.supplier_oracle_guard_cancellation_credit();
revoke all on function private.supplier_oracle_guard_cancellation_credit() from public,anon,authenticated;

-- O mesmo predicado protege preview, preparo e confirmação, inclusive quando uma divergência surge depois do preparo.
create or replace function private.supplier_oracle_assert_purchase(
  p_compra_id uuid, p_supplier_id text, p_allowed_settlement uuid default null
) returns public.pedidos language plpgsql security definer set search_path = '' as $$
declare purchase public.compras; sale public.pedidos; sale_count integer;
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
     or pg_catalog.left(purchase.id::text, 6) = 'b17d01'
     or exists (select 1 from public.supplier_cancellation_cases cc
       where cc.compra_id = p_compra_id and cc.status = 'open') then
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
  if p_compra_id is null or p_source not in ('ml_sync','ml_webhook','dslite_sync','manual_reconcile')
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
    select * into sale from public.pedidos where id = p_pedido_id and dslite_id = purchase.dsid for share;
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
  elsif p_source = 'dslite_sync' or p_pedido_id is null or sale.situacao::text <> 'cancelado'
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
      'Cancelamento da compra DSLite #' || purchase.dsid, p_compra_id,
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

create or replace function public.supplier_oracle_decide_cancellation_credit(
  p_movement_id uuid, p_status text, p_note text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare movement public.supplier_balance_movements;
begin
  if p_movement_id is null or p_status not in ('confirmed','rejected')
     or nullif(pg_catalog.btrim(p_actor),'') is null or pg_catalog.length(coalesce(p_note,'')) > 1000 then
    raise exception 'Decisão de crédito inválida.' using errcode='22023';
  end if;
  select * into movement from public.supplier_balance_movements where id=p_movement_id;
  if not found then raise exception 'Crédito não encontrado.' using errcode='P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(movement.fornecedor_id));
  if exists (select 1 from public.supplier_cancellation_cases c
    where c.movement_id=p_movement_id and c.status='open') then
    raise exception 'Crédito bloqueado por divergência aberta.' using errcode='P0001';
  end if;
  select * into movement from public.supplier_balance_movements where id=p_movement_id for update;
  if movement.movement_type <> 'cancellation_credit' or movement.status <> 'pending' then
    raise exception 'Crédito mudou; atualize antes de decidir.' using errcode='P0001';
  end if;
  update public.supplier_balance_movements set status=p_status,
    notes=coalesce(movement.notes,'') || case when nullif(pg_catalog.btrim(coalesce(p_note,'')),'') is null
      then '' else E'\nDecisão: ' || pg_catalog.btrim(p_note) end,
    confirmed_at=case when p_status='confirmed' then pg_catalog.clock_timestamp() else null end,
    confirmed_by=p_actor where id=p_movement_id;
  return pg_catalog.jsonb_build_object('id',p_movement_id,'status',p_status);
end;
$$;

create or replace function public.supplier_oracle_resolve_cancellation(
  p_case_id uuid, p_expected_version integer, p_decision text, p_note text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_case public.supplier_cancellation_cases; movement public.supplier_balance_movements; purchase public.compras;
begin
  if p_case_id is null or p_expected_version is null or p_expected_version < 1
     or p_decision not in ('no_credit','pending_credit','compensate')
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_note,''))) < 10
     or pg_catalog.length(p_note) > 1000 or nullif(pg_catalog.btrim(p_actor),'') is null then
    raise exception 'Decisão inválida.' using errcode='22023';
  end if;
  select * into current_case from public.supplier_cancellation_cases where id=p_case_id;
  if not found then raise exception 'Caso não encontrado.' using errcode='P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(current_case.fornecedor_id));
  select * into current_case from public.supplier_cancellation_cases where id=p_case_id for update;
  if current_case.status <> 'open' or current_case.version <> p_expected_version then
    raise exception 'Caso mudou; atualize antes de decidir.' using errcode='P0001';
  end if;
  select * into purchase from public.compras where id=current_case.compra_id for update;
  if current_case.movement_id is not null then
    select * into movement from public.supplier_balance_movements where id=current_case.movement_id for update;
  end if;
  if p_decision='pending_credit' then
    if current_case.movement_id is not null or purchase.supplier_payment_status <> 'paid'
       or purchase.supplier_payment_amount is null or purchase.supplier_payment_amount <= 0 then
      raise exception 'Crédito candidato não pode ser criado.' using errcode='P0001';
    end if;
    insert into public.supplier_balance_movements
      (fornecedor_id,fornecedor_nome,movement_type,amount,reference,compra_id,notes,
       created_by,movement_key,status,source,pedido_id,supplier_settlement_id)
    values (purchase.fornecedor_id,purchase.fornecedor_nome,'cancellation_credit',purchase.supplier_payment_amount,
      'Decisão do caso ' || current_case.id::text,purchase.id,p_note,p_actor,
      'cancellation_credit:' || purchase.id::text,'pending','ml_cancellation',current_case.pedido_id,
      current_case.supplier_settlement_id) returning * into movement;
  elsif p_decision='no_credit' then
    if movement.id is not null and movement.status='confirmed' then
      raise exception 'Crédito confirmado exige compensação.' using errcode='P0001';
    end if;
    if movement.id is not null and movement.status='pending' then
      update public.supplier_balance_movements set status='rejected',notes=coalesce(notes,'') || E'\nDecisão: ' || p_note,
        confirmed_by=p_actor where id=movement.id;
    end if;
  else
    if movement.id is null or movement.status <> 'confirmed' then
      raise exception 'Compensação exige crédito confirmado.' using errcode='P0001';
    end if;
    insert into public.supplier_balance_movements
      (fornecedor_id,fornecedor_nome,movement_type,amount,reference,compra_id,notes,
       created_by,movement_key,status,source,pedido_id,origin_movement_id,confirmed_at,confirmed_by)
    values (movement.fornecedor_id,movement.fornecedor_nome,'adjustment',-movement.amount,
      'Compensação do crédito ' || movement.id::text,movement.compra_id,p_note,p_actor,
      'cancellation_compensation:' || movement.id::text,'confirmed','ml_cancellation',movement.pedido_id,
      movement.id,pg_catalog.clock_timestamp(),p_actor);
  end if;
  update public.supplier_cancellation_cases set status='closed',
    classification=case when p_decision='pending_credit' then 'paid_pre_dispatch' else classification end,
    movement_id=coalesce(movement.id,movement_id),
    resolution=case p_decision when 'no_credit' then 'manual_no_credit'
      when 'pending_credit' then 'manual_pending_credit' else 'manual_compensation' end,
    resolution_note=p_note,resolved_by=p_actor,resolved_at=pg_catalog.clock_timestamp(),
    version=version+1,updated_at=pg_catalog.clock_timestamp() where id=p_case_id;
  return pg_catalog.jsonb_build_object('caseId',p_case_id,'status','closed',
    'version',p_expected_version+1,'movementId',movement.id);
end;
$$;

revoke all on function public.supplier_oracle_record_cancellation(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.supplier_oracle_resolve_cancellation(uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.supplier_oracle_decide_cancellation_credit(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.supplier_oracle_record_cancellation(uuid,uuid,text,text,jsonb,text) to service_role;
grant execute on function public.supplier_oracle_resolve_cancellation(uuid,integer,text,text,text) to service_role;
grant execute on function public.supplier_oracle_decide_cancellation_credit(uuid,text,text,text) to service_role;
notify pgrst, 'reload schema';
