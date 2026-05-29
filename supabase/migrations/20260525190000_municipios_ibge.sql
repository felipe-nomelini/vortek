create table if not exists public.municipios_ibge (
  id uuid primary key default gen_random_uuid(),
  uf char(2) not null,
  nome text not null,
  nome_normalizado text not null,
  codigo_ibge char(7) not null,
  cep_inicio text null,
  cep_fim text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_municipios_ibge_codigo
  on public.municipios_ibge (codigo_ibge);

create index if not exists idx_municipios_ibge_uf_nome_normalizado
  on public.municipios_ibge (uf, nome_normalizado);

alter table public.municipios_ibge enable row level security;

drop policy if exists municipios_ibge_select_authenticated on public.municipios_ibge;

create policy municipios_ibge_select_authenticated
  on public.municipios_ibge
  for select
  to authenticated
  using (true);
