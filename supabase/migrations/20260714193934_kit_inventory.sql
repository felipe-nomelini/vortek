create table if not exists public.produto_kits (
  produto_id uuid primary key references public.produtos(id) on delete cascade,
  fornecedor_dslite_id text not null,
  sku_origem text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fornecedor_dslite_id, sku_origem)
);

create table if not exists public.produto_kit_componentes (
  kit_produto_id uuid not null references public.produto_kits(produto_id) on delete cascade,
  componente_produto_id uuid not null references public.produtos(id) on delete restrict,
  quantidade integer not null check (quantidade > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kit_produto_id, componente_produto_id),
  check (kit_produto_id <> componente_produto_id)
);

create index if not exists produto_kit_componentes_componente_idx
  on public.produto_kit_componentes (componente_produto_id);

alter table public.produto_kits enable row level security;
alter table public.produto_kit_componentes enable row level security;

drop policy if exists "Todos podem ver kits de produto" on public.produto_kits;
create policy "Todos podem ver kits de produto"
  on public.produto_kits for select using (true);

drop policy if exists "Admin pode gerenciar kits de produto" on public.produto_kits;
create policy "Admin pode gerenciar kits de produto"
  on public.produto_kits for all using (auth.role() = 'authenticated');

drop policy if exists "Todos podem ver componentes de kit" on public.produto_kit_componentes;
create policy "Todos podem ver componentes de kit"
  on public.produto_kit_componentes for select using (true);

drop policy if exists "Admin pode gerenciar componentes de kit" on public.produto_kit_componentes;
create policy "Admin pode gerenciar componentes de kit"
  on public.produto_kit_componentes for all using (auth.role() = 'authenticated');

drop trigger if exists set_updated_at_produto_kits on public.produto_kits;
create trigger set_updated_at_produto_kits
  before update on public.produto_kits
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_produto_kit_componentes on public.produto_kit_componentes;
create trigger set_updated_at_produto_kit_componentes
  before update on public.produto_kit_componentes
  for each row execute function public.set_updated_at();
