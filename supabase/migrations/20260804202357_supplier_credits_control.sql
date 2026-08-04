alter table public.supplier_balance_movements
  add column if not exists status text not null default 'confirmed',
  add column if not exists source text null,
  add column if not exists pedido_id uuid null references public.pedidos(id) on delete set null,
  add column if not exists ml_order_id text null,
  add column if not exists confirmed_at timestamptz null,
  add column if not exists confirmed_by text null,
  add column if not exists updated_at timestamptz not null default now();

update public.supplier_balance_movements
set confirmed_at = coalesce(confirmed_at, created_at),
    source = coalesce(source, 'legacy')
where status = 'confirmed';

alter table public.supplier_balance_movements
  drop constraint if exists supplier_balance_movements_type_check,
  drop constraint if exists supplier_balance_movements_amount_check,
  drop constraint if exists supplier_balance_movements_status_check;

alter table public.supplier_balance_movements
  add constraint supplier_balance_movements_type_check
    check (movement_type in (
      'topup',
      'purchase_debit',
      'adjustment',
      'manual_credit',
      'cancellation_credit',
      'credit_usage'
    )),
  add constraint supplier_balance_movements_amount_check
    check (
      (movement_type in ('topup', 'manual_credit', 'cancellation_credit') and amount > 0)
      or (movement_type in ('purchase_debit', 'credit_usage') and amount < 0)
      or (movement_type = 'adjustment' and amount <> 0)
    ),
  add constraint supplier_balance_movements_status_check
    check (status in ('pending', 'confirmed', 'rejected', 'voided'));

create index if not exists supplier_balance_movements_status_idx
  on public.supplier_balance_movements (status, created_at desc);

create index if not exists supplier_balance_movements_pedido_idx
  on public.supplier_balance_movements (pedido_id)
  where pedido_id is not null;

create or replace function public.enforce_supplier_credit_non_negative()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_balance numeric;
begin
  if new.fornecedor_id = '2' or new.status <> 'confirmed' or new.amount >= 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.fornecedor_id));

  select coalesce(sum(amount), 0)
    into current_balance
  from public.supplier_balance_movements
  where fornecedor_id = new.fornecedor_id
    and status = 'confirmed'
    and id <> new.id;

  if current_balance + new.amount < 0 then
    raise exception 'Crédito confirmado insuficiente para este fornecedor.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_supplier_credit_non_negative() from public, anon, authenticated;
grant execute on function public.enforce_supplier_credit_non_negative() to service_role;

drop trigger if exists supplier_balance_non_negative on public.supplier_balance_movements;
create trigger supplier_balance_non_negative
  before insert or update of fornecedor_id, status, amount
  on public.supplier_balance_movements
  for each row
  execute function public.enforce_supplier_credit_non_negative();

drop trigger if exists supplier_balance_movements_updated_at on public.supplier_balance_movements;
create trigger supplier_balance_movements_updated_at
  before update on public.supplier_balance_movements
  for each row
  execute function public.update_updated_at_column();

revoke all on table public.supplier_balance_movements from anon, authenticated;
grant all on table public.supplier_balance_movements to service_role;

insert into public.supplier_balance_movements (
  fornecedor_id,
  fornecedor_nome,
  movement_type,
  amount,
  reference,
  compra_id,
  notes,
  created_by,
  movement_key,
  status,
  source,
  pedido_id,
  ml_order_id
)
select
  c.fornecedor_id,
  c.fornecedor_nome,
  'cancellation_credit',
  c.supplier_payment_amount,
  concat('Venda ML #', coalesce(p.ml_order_id, p.numero::text), ' · Pedido DSLite #', c.dsid),
  c.id,
  'Detectado automaticamente: venda cancelada após pagamento ao fornecedor. Confirmar crédito com o fornecedor.',
  'historical_reconciliation',
  concat('cancellation_credit:', c.id::text),
  'pending',
  'ml_cancellation',
  p.id,
  p.ml_order_id
from public.pedidos p
join public.compras c on c.dsid = p.dslite_id
where p.situacao = 'cancelado'
  and c.supplier_payment_mode = 'prepaid_pix'
  and c.supplier_payment_status = 'paid'
  and c.supplier_payment_amount > 0
  and c.fornecedor_id is not null
  and c.fornecedor_id <> '2'
on conflict (movement_key) where movement_key is not null do nothing;
