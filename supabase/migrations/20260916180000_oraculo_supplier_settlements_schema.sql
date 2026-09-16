-- ORC-01: estrutura passiva do Oraculo de Fornecedores.
-- Nenhum pagamento, credito ou compra existente e migrado nesta etapa.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.supplier_settlements (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores(id) on delete restrict,
  fornecedor_dslite_id text not null check (btrim(fornecedor_dslite_id) <> ''),
  fornecedor_nome_snapshot text not null check (btrim(fornecedor_nome_snapshot) <> ''),
  cnpj_snapshot text not null check (cnpj_snapshot ~ '^[0-9]{14}$'),
  supplier_pix_key_snapshot text not null check (btrim(supplier_pix_key_snapshot) <> ''),
  contact_phone_snapshot text,
  status text not null default 'prepared'
    check (status in ('prepared', 'confirmed', 'cancelled')),
  gross_amount numeric(14,2) not null check (gross_amount > 0),
  credit_amount numeric(14,2) not null default 0 check (credit_amount >= 0),
  pix_amount numeric(14,2) not null check (pix_amount >= 0),
  payment_reference text,
  receipt_path text,
  notes text,
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  version integer not null default 1 check (version > 0),
  prepared_by text not null check (btrim(prepared_by) <> ''),
  prepared_at timestamptz not null default clock_timestamp(),
  confirmed_by text,
  confirmed_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint supplier_settlements_amounts_check
    check (gross_amount = credit_amount + pix_amount),
  constraint supplier_settlements_lifecycle_check
    check (
      (status = 'prepared' and confirmed_at is null and cancelled_at is null)
      or (status = 'confirmed' and confirmed_at is not null and confirmed_by is not null and cancelled_at is null)
      or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and confirmed_at is null)
    )
);

create table if not exists public.supplier_settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.supplier_settlements(id) on delete restrict,
  compra_id uuid not null references public.compras(id) on delete restrict,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  dsid_snapshot text not null check (btrim(dsid_snapshot) <> ''),
  sale_number_snapshot bigint not null,
  ml_order_id_snapshot text,
  product_description_snapshot text,
  quantity_snapshot integer check (quantity_snapshot > 0),
  gross_amount numeric(14,2) not null check (gross_amount > 0),
  credit_amount numeric(14,2) not null default 0 check (credit_amount >= 0),
  pix_amount numeric(14,2) not null check (pix_amount >= 0),
  released_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint supplier_settlement_items_amounts_check
    check (gross_amount = credit_amount + pix_amount),
  constraint supplier_settlement_items_settlement_compra_unique
    unique (settlement_id, compra_id)
);

alter table public.compras
  add column if not exists supplier_settlement_id uuid,
  add column if not exists supply_status text not null default 'unknown',
  add column if not exists supply_status_changed_by text,
  add column if not exists supply_status_changed_at timestamptz,
  add column if not exists supply_status_note text;

alter table public.pedidos
  add column if not exists label_type text,
  add column if not exists label_delivery_channel text,
  add column if not exists label_delivered_at timestamptz;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compras'::regclass
      and conname = 'compras_supplier_settlement_id_fkey'
  ) then
    alter table public.compras
      add constraint compras_supplier_settlement_id_fkey
      foreign key (supplier_settlement_id)
      references public.supplier_settlements(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compras'::regclass
      and conname = 'compras_supply_status_check'
  ) then
    alter table public.compras
      add constraint compras_supply_status_check
      check (supply_status in ('unknown', 'ready', 'blocked', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pedidos'::regclass
      and conname = 'pedidos_label_type_check'
  ) then
    alter table public.pedidos
      add constraint pedidos_label_type_check
      check (label_type is null or label_type in ('provisional', 'real'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pedidos'::regclass
      and conname = 'pedidos_label_delivery_channel_check'
  ) then
    alter table public.pedidos
      add constraint pedidos_label_delivery_channel_check
      check (label_delivery_channel is null or label_delivery_channel in ('dslite', 'whatsapp'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pedidos'::regclass
      and conname = 'pedidos_label_delivered_consistency_check'
  ) then
    alter table public.pedidos
      add constraint pedidos_label_delivered_consistency_check
      check (label_delivered_at is null or (coalesce(label_type = 'real', false) and label_delivery_channel is not null));
  end if;
end;
$migration$;

create index if not exists supplier_settlements_fornecedor_status_idx
  on public.supplier_settlements (fornecedor_id, status, prepared_at desc);

create index if not exists supplier_settlements_account_status_idx
  on public.supplier_settlements (cnpj_snapshot, supplier_pix_key_snapshot, status);

create index if not exists supplier_settlement_items_settlement_idx
  on public.supplier_settlement_items (settlement_id);

create index if not exists supplier_settlement_items_pedido_idx
  on public.supplier_settlement_items (pedido_id);

create index if not exists supplier_settlement_items_compra_idx
  on public.supplier_settlement_items (compra_id);

create unique index if not exists supplier_settlement_items_compra_active_unique
  on public.supplier_settlement_items (compra_id)
  where released_at is null;

create index if not exists compras_supplier_settlement_idx
  on public.compras (supplier_settlement_id)
  where supplier_settlement_id is not null;

create index if not exists compras_supplier_pending_supply_idx
  on public.compras (fornecedor_id, supply_status, created_at)
  where supplier_payment_mode = 'prepaid_pix' and supplier_payment_status = 'pending';

alter table public.supplier_settlements enable row level security;
alter table public.supplier_settlement_items enable row level security;

revoke all on table public.supplier_settlements, public.supplier_settlement_items
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.supplier_settlements, public.supplier_settlement_items
  to service_role;

comment on table public.supplier_settlements is
  'ORC-01: cabecalho passivo da liquidacao de fornecedor; nenhum writer fica habilitado nesta etapa.';
comment on table public.supplier_settlement_items is
  'ORC-01: alocacoes auditaveis de compras; released_at libera apenas preparacoes canceladas.';
comment on column public.compras.supplier_settlement_id is
  'Liquidacao ativa ou confirmada; historico completo em supplier_settlement_items.';
comment on column public.compras.supply_status is
  'Estado de abastecimento do Oraculo; unknown ate confirmacao operacional na ORC-02.';
comment on column public.pedidos.label_type is
  'Tipo formal da etiqueta do fornecedor; null significa legado ou ainda nao classificado.';
