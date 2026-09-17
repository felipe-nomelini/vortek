-- A liquidação usa dados da compra e da venda; não exige classificação manual,
-- revisão genérica ou comprovação de etiqueta para registrar o pagamento.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
     or purchase.supplier_settlement_id is distinct from p_allowed_settlement
     or pg_catalog.left(purchase.id::text, 6) = 'b17d01'
     or exists (select 1 from public.supplier_cancellation_cases cc
       where cc.compra_id = p_compra_id and cc.status = 'open') then
    raise exception 'Compra não pode entrar no fechamento: %', p_compra_id using errcode = 'P0001';
  end if;

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
  if pg_catalog.lower(coalesce(sale.situacao::text, '')) = 'cancelado'
     or exists (select 1 from public.supplier_settlement_items item
       where item.compra_id = p_compra_id and item.released_at is null
         and (p_allowed_settlement is null or item.settlement_id <> p_allowed_settlement)) then
    raise exception 'Venda cancelada ou compra já incluída: %', p_compra_id using errcode = 'P0001';
  end if;
  return sale;
end;
$$;

revoke all on function private.supplier_oracle_assert_purchase(uuid,text,uuid)
  from public, anon, authenticated;
