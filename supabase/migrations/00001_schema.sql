-- Vortek Database Schema

-- ── Extensions ─────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── User Roles ─────────────────────────────────────────────
create type user_role as enum ('admin', 'gerente', 'operador', 'visualizador');
create type pedido_status as enum ('aberto', 'atendido', 'cancelado', 'faturado', 'entregue');
create type ml_status as enum ('ativo', 'pausado', 'sem_anuncio');
create type bling_status as enum ('ativo', 'inativo');
create type integracao_tipo as enum ('mercadolivre', 'bling', 'dslite');

-- ── Profiles (extends Supabase auth.users) ─────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  avatar_url text,
  cargo user_role not null default 'operador',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Usuários podem ver seu próprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Usuários podem atualizar seu próprio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- ── Empresa ────────────────────────────────────────────────
create table public.empresa (
  id uuid primary key default uuid_generate_v4(),
  nome text not null default '',
  nickname text not null default '',
  cnpj text not null default '',
  endereco text not null default '',
  email text not null default '',
  telefone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Integrações ────────────────────────────────────────────
create table public.integracoes (
  id uuid primary key default uuid_generate_v4(),
  tipo integracao_tipo not null,
  client_id text,
  client_secret text,
  redirect_uri text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  url text,
  conectado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Produtos ───────────────────────────────────────────────
create table public.produtos (
  id uuid primary key default uuid_generate_v4(),
  sku text not null unique,
  nome text not null,
  marca text not null default '',
  estoque integer not null default 0,
  custo numeric(10,2) not null default 0,
  preco_bling numeric(10,2) not null default 0,
  ml_fee numeric(4,3) not null default 0,
  ml_shipping numeric(10,2) not null default 0,
  custom_price numeric(10,2),
  bling_status bling_status not null default 'ativo',
  ml_status ml_status not null default 'sem_anuncio',
  peso_liq numeric(8,3) not null default 0,
  peso_bruto numeric(8,3) not null default 0,
  largura numeric(8,1) not null default 0,
  altura numeric(8,1) not null default 0,
  profundidade numeric(8,1) not null default 0,
  gtin text not null default '',
  descricao text not null default '',
  imagens text[] not null default '{}',
  categoria text,
  bling_id text,
  ml_item_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.produtos enable row level security;
create policy "Todos podem ver produtos" on public.produtos for select using (true);
create policy "Admin pode gerenciar produtos" on public.produtos for all using (auth.role() = 'authenticated');

-- ── Pedidos ────────────────────────────────────────────────
create table public.pedidos (
  id uuid primary key default uuid_generate_v4(),
  numero bigint not null,
  numero_loja text,
  data timestamptz not null default now(),
  data_saida timestamptz,
  data_prevista timestamptz,
  contato_nome text not null,
  contato_documento text not null default '',
  total numeric(10,2) not null default 0,
  frete numeric(10,2) not null default 0,
  situacao pedido_status not null default 'aberto',
  rastreio text,
  lucro numeric(10,2) not null default 0,
  ml_order_id text unique,
  bling_id text,
  nota_fiscal_numero text,
  nota_fiscal_emitida boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pedidos enable row level security;
create policy "Todos podem ver pedidos" on public.pedidos for select using (true);

-- ── Clientes ───────────────────────────────────────────────
create table public.clientes (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  nickname text,
  tipo_pessoa char(1) not null default 'F',
  documento text not null default '',
  endereco text not null default '',
  email text not null default '',
  telefone text not null default '',
  total_vendas integer not null default 0,
  ml_nickname text,
  ml_id text,
  bling_contato_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clientes enable row level security;
create policy "Todos podem ver clientes" on public.clientes for select using (true);

-- ── Fornecedores ───────────────────────────────────────────
create table public.fornecedores (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  cnpj text not null default '',
  endereco text not null default '',
  email text not null default '',
  telefone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fornecedores enable row level security;
create policy "Todos podem ver fornecedores" on public.fornecedores for select using (true);

-- ── Anúncios ML ────────────────────────────────────────────
create table public.anuncios_ml (
  id uuid primary key default uuid_generate_v4(),
  ml_item_id text not null unique,
  produto_id uuid references public.produtos(id),
  sku text not null,
  titulo text not null,
  tipo text not null default 'gold_special',
  preco_ml numeric(10,2) not null default 0,
  preco_bling numeric(10,2) not null default 0,
  vendidos integer not null default 0,
  visitas integer not null default 0,
  qualidade numeric(5,2) not null default 0,
  qualidade_info jsonb,
  status ml_status not null default 'ativo',
  catalogo boolean not null default false,
  thumbnail text,
  permalink text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Jobs ───────────────────────────────────────────────────
create table public.jobs (
  id uuid primary key default uuid_generate_v4(),
  tipo text not null,
  status text not null default 'pendente',
  progresso integer not null default 0,
  total integer not null default 0,
  processados integer not null default 0,
  log jsonb not null default '[]',
  cancelado boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ── Configurações ──────────────────────────────────────────
create table public.configuracoes (
  id uuid primary key default uuid_generate_v4(),
  margem_lucro integer not null default 30,
  notificacoes_email boolean not null default true,
  notificacoes_push boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Trigger: updated_at ────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_produtos before update on public.produtos for each row execute function public.set_updated_at();
create trigger set_updated_at_pedidos before update on public.pedidos for each row execute function public.set_updated_at();
create trigger set_updated_at_clientes before update on public.clientes for each row execute function public.set_updated_at();
create trigger set_updated_at_fornecedores before update on public.fornecedores for each row execute function public.set_updated_at();
create trigger set_updated_at_empresa before update on public.empresa for each row execute function public.set_updated_at();
create trigger set_updated_at_integracoes before update on public.integracoes for each row execute function public.set_updated_at();
create trigger set_updated_at_configuracoes before update on public.configuracoes for each row execute function public.set_updated_at();
