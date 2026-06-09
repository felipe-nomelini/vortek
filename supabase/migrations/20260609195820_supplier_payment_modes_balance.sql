alter table public.produto_fornecedor_ofertas
  drop constraint if exists produto_fornecedor_ofertas_payment_mode_check;

alter table public.produto_fornecedor_ofertas
  add constraint produto_fornecedor_ofertas_payment_mode_check
  check (payment_mode in ('postpaid', 'prepaid_pix', 'balance_account'));

alter table public.compras
  drop constraint if exists compras_supplier_payment_mode_check;

alter table public.compras
  add constraint compras_supplier_payment_mode_check
  check (supplier_payment_mode is null or supplier_payment_mode in ('postpaid', 'prepaid_pix', 'balance_account'));

create table if not exists public.supplier_balance_movements (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id text not null,
  fornecedor_nome text null,
  movement_type text not null,
  amount numeric not null,
  reference text null,
  compra_id uuid null references public.compras(id) on delete set null,
  notes text null,
  created_by text null,
  movement_key text null,
  created_at timestamptz not null default now(),
  constraint supplier_balance_movements_type_check
    check (movement_type in ('topup', 'purchase_debit', 'adjustment')),
  constraint supplier_balance_movements_amount_check
    check (
      (movement_type = 'topup' and amount > 0)
      or (movement_type = 'purchase_debit' and amount < 0)
      or (movement_type = 'adjustment' and amount <> 0)
    )
);

create unique index if not exists supplier_balance_movements_key_unique
on public.supplier_balance_movements (movement_key)
where movement_key is not null;

create index if not exists supplier_balance_movements_fornecedor_idx
on public.supplier_balance_movements (fornecedor_id, created_at desc);

create index if not exists supplier_balance_movements_compra_idx
on public.supplier_balance_movements (compra_id)
where compra_id is not null;

alter table public.supplier_balance_movements enable row level security;

update public.produto_fornecedor_ofertas
set payment_mode = case
  when dslite_fornecedor_id = '2' then 'balance_account'
  else 'prepaid_pix'
end,
updated_at = now()
where dslite_fornecedor_id is not null;

update public.compras
set supplier_payment_mode = case
  when fornecedor_id = '2' then 'balance_account'
  else 'prepaid_pix'
end
where fornecedor_id is not null
  and coalesce(status, '') <> 'Cancelado';

update public.compras
set supplier_payment_status = null
where supplier_payment_mode = 'balance_account';

update public.compras
set supplier_payment_status = 'pending'
where supplier_payment_mode = 'prepaid_pix'
  and supplier_payment_status is null
  and coalesce(status, '') <> 'Cancelado';
