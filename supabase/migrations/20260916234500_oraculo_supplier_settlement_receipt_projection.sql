-- ORC-07: a compra individual precisa expor o comprovante da liquidação aos consumidores existentes.
-- O financeiro permanece exclusivamente na função transacional; não há segundo writer.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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

revoke all on function public.supplier_oracle_confirm(uuid,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.supplier_oracle_confirm(uuid,integer,text,text,text) to service_role;
