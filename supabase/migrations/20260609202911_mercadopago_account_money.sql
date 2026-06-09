do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'integracao_tipo'
      and e.enumlabel = 'mercadopago'
  ) then
    alter type public.integracao_tipo add value 'mercadopago';
  end if;
end $$;

create table if not exists public.mercadopago_account_movements (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  movement_date timestamptz null,
  description text null,
  reference text null,
  amount numeric not null default 0,
  movement_type text null,
  currency text null,
  raw_payload jsonb not null default '{}'::jsonb,
  matched_supplier text null,
  supplier_balance_movement_id uuid null references public.supplier_balance_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mercadopago_account_movements_external_id_key
on public.mercadopago_account_movements (external_id);

create index if not exists mercadopago_account_movements_date_idx
on public.mercadopago_account_movements (movement_date desc);

create index if not exists mercadopago_account_movements_supplier_idx
on public.mercadopago_account_movements (matched_supplier, created_at desc);

alter table public.mercadopago_account_movements enable row level security;
