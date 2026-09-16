-- ORC-05: comprovante opcional pertence ao cabeçalho preparado.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.supplier_oracle_guard_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.status <> 'prepared' then
    raise exception 'Liquidação final é imutável.' using errcode = 'P0001';
  end if;
  if new.status = 'prepared' then
    if old.receipt_path is not null or new.receipt_path is null
       or new.version <> old.version + 1
       or (to_jsonb(new) - array['receipt_path','version','updated_at'])
          <> (to_jsonb(old) - array['receipt_path','version','updated_at']) then
      raise exception 'Liquidação preparada só aceita comprovante por operação controlada.' using errcode = 'P0001';
    end if;
  elsif new.status not in ('confirmed', 'cancelled')
     or (to_jsonb(new) - array['status','payment_reference','receipt_path','notes','version','confirmed_by','confirmed_at','cancelled_by','cancelled_at','updated_at'])
       <> (to_jsonb(old) - array['status','payment_reference','receipt_path','notes','version','confirmed_by','confirmed_at','cancelled_by','cancelled_at','updated_at']) then
    raise exception 'Liquidação preparada não pode ser alterada.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.supplier_oracle_attach_receipt(
  p_settlement_id uuid, p_expected_version integer, p_path text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare settlement public.supplier_settlements;
begin
  if p_settlement_id is null or p_expected_version is null or p_expected_version < 1
     or p_path is null or p_path !~ ('^liquidacoes/' || p_settlement_id::text || '/[0-9a-f]{64}[.](pdf|jpg|png|webp)$')
     or nullif(pg_catalog.btrim(p_actor), '') is null then
    raise exception 'Comprovante inválido.' using errcode = '22023';
  end if;
  select * into settlement from public.supplier_settlements where id = p_settlement_id for update;
  if not found then raise exception 'Liquidação não encontrada.' using errcode = 'P0002'; end if;
  if settlement.status <> 'prepared' then
    raise exception 'Liquidação não está preparada.' using errcode = 'P0001';
  end if;
  if settlement.receipt_path = p_path then
    return pg_catalog.jsonb_build_object('id', settlement.id, 'version', settlement.version, 'replayed', true);
  end if;
  if settlement.receipt_path is not null or settlement.version <> p_expected_version then
    raise exception 'Comprovante ou versão mudou.' using errcode = 'P0001';
  end if;
  update public.supplier_settlements set receipt_path = p_path,
    version = version + 1, updated_at = pg_catalog.clock_timestamp()
    where id = p_settlement_id;
  return pg_catalog.jsonb_build_object('id', settlement.id, 'version', settlement.version + 1, 'replayed', false);
end;
$$;

revoke all on function public.supplier_oracle_attach_receipt(uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.supplier_oracle_attach_receipt(uuid,integer,text,text) to service_role;
