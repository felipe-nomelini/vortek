create table if not exists public.produto_fornecedor_ofertas (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  dslite_fornecedor_id text not null,
  fornecedor_nome text null,
  dslite_produto_id text not null,
  sku_fornecedor text null,
  custo numeric not null default 0,
  estoque integer not null default 0,
  ativo boolean not null default true,
  prioridade integer not null default 100,
  payment_mode text not null default 'postpaid',
  lead_time_dias integer null,
  last_sync_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint produto_fornecedor_ofertas_payment_mode_check check (payment_mode in ('postpaid', 'prepaid_pix'))
);

create unique index if not exists produto_fornecedor_ofertas_produto_supplier_unique
on public.produto_fornecedor_ofertas (produto_id, dslite_fornecedor_id);

create unique index if not exists produto_fornecedor_ofertas_dslite_identity_unique
on public.produto_fornecedor_ofertas (dslite_fornecedor_id, dslite_produto_id);

create index if not exists produto_fornecedor_ofertas_produto_id_idx
on public.produto_fornecedor_ofertas (produto_id);

create index if not exists produto_fornecedor_ofertas_supplier_idx
on public.produto_fornecedor_ofertas (dslite_fornecedor_id);

alter table public.compras
  add column if not exists supplier_payment_mode text null,
  add column if not exists supplier_payment_status text null,
  add column if not exists supplier_payment_amount numeric null,
  add column if not exists supplier_payment_reference text null,
  add column if not exists supplier_payment_confirmed_at timestamptz null,
  add column if not exists supplier_payment_confirmed_by text null,
  add column if not exists supplier_payment_receipt_url text null,
  add column if not exists supplier_payment_notes text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'compras_supplier_payment_mode_check'
  ) then
    alter table public.compras
      add constraint compras_supplier_payment_mode_check
      check (supplier_payment_mode is null or supplier_payment_mode in ('postpaid', 'prepaid_pix'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'compras_supplier_payment_status_check'
  ) then
    alter table public.compras
      add constraint compras_supplier_payment_status_check
      check (supplier_payment_status is null or supplier_payment_status in ('pending', 'paid', 'failed', 'cancelled'));
  end if;
end $$;

insert into public.produto_fornecedor_ofertas (
  produto_id,
  dslite_fornecedor_id,
  fornecedor_nome,
  dslite_produto_id,
  sku_fornecedor,
  custo,
  estoque,
  ativo,
  prioridade,
  payment_mode,
  last_sync_at,
  created_at,
  updated_at
)
select
  p.id,
  p.dslite_fornecedor_id,
  p.fornecedor,
  p.dslite_produto_id,
  p.sku,
  p.custo,
  p.estoque,
  true,
  100,
  case when p.dslite_fornecedor_id = '97' then 'prepaid_pix' else 'postpaid' end,
  p.dslite_ultima_sync,
  now(),
  now()
from public.produtos p
where p.dslite_fornecedor_id is not null
  and p.dslite_produto_id is not null
on conflict (dslite_fornecedor_id, dslite_produto_id)
do update set
  produto_id = excluded.produto_id,
  fornecedor_nome = excluded.fornecedor_nome,
  sku_fornecedor = excluded.sku_fornecedor,
  custo = excluded.custo,
  estoque = excluded.estoque,
  ativo = excluded.ativo,
  payment_mode = excluded.payment_mode,
  last_sync_at = excluded.last_sync_at,
  updated_at = now();

update public.compras
set supplier_payment_mode = case when fornecedor_id = '97' then 'prepaid_pix' else 'postpaid' end
where supplier_payment_mode is null
  and fornecedor_id is not null;

update public.compras
set supplier_payment_status = 'pending'
where supplier_payment_mode = 'prepaid_pix'
  and supplier_payment_status is null
  and coalesce(status, '') <> 'Cancelado';
