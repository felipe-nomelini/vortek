-- Esquema sintético mínimo para exercitar as migrations ORC-01 e ORC-03.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant usage on schema public to service_role;
create schema auth;
create table auth.users (id uuid primary key);

create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  dslite_id text unique,
  nome text not null,
  apelido text not null default '',
  cnpj text not null,
  supplier_pix_key text not null,
  telefone text not null default '',
  ativo boolean not null default true
);

create table public.compras (
  id uuid primary key default gen_random_uuid(),
  dsid text not null unique,
  fornecedor_id text,
  status text not null default 'Iniciado',
  status_dslite text not null default 'Confirmado',
  supplier_payment_mode text,
  supplier_payment_status text,
  supplier_payment_amount numeric(14,2),
  supplier_payment_confirmed_at timestamptz,
  supplier_payment_confirmed_by text,
  supplier_payment_reference text,
  supplier_payment_notes text,
  produto_descricao text,
  quantidade integer not null default 1,
  data_criacao timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  dslite_id text,
  numero bigint not null,
  ml_order_id text,
  ml_bundle_primary boolean,
  snapshot_source text,
  situacao text,
  snapshot_incompleto boolean,
  snapshot_pendencias jsonb,
  ml_claim_id text
);

create table public.supplier_balance_movements (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id text not null,
  fornecedor_nome text,
  movement_type text not null,
  amount numeric(14,2) not null,
  reference text,
  compra_id uuid,
  notes text,
  created_by text,
  movement_key text unique,
  status text not null default 'confirmed',
  source text,
  pedido_id uuid,
  ml_order_id text,
  confirmed_at timestamptz,
  confirmed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.enforce_supplier_credit_non_negative()
returns trigger language plpgsql as $$ begin return new; end; $$;
create trigger supplier_balance_non_negative
  before insert or update of fornecedor_id, status, amount
  on public.supplier_balance_movements for each row
  execute function public.enforce_supplier_credit_non_negative();

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  status text not null default 'pendente',
  progresso integer not null default 0,
  total integer not null default 0,
  processados integer not null default 0,
  log jsonb not null default '[]',
  created_by uuid references auth.users(id),
  dedupe_key text unique,
  unidade_progresso text not null default 'execucao',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
