alter table public.produtos
  add column if not exists ativo boolean not null default true;

create index if not exists idx_produtos_ativo
  on public.produtos (ativo);
