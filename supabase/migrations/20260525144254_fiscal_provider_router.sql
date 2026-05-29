alter type public.integracao_tipo add value if not exists 'brasilnfe';

alter table public.pedidos
  add column if not exists nfe_provider text,
  add column if not exists nfe_external_id text,
  add column if not exists nfe_cfop text,
  add column if not exists nfe_last_sync_at timestamptz;

alter table public.configuracoes
  add column if not exists nfe_provider_default text not null default 'brasilnfe';

update public.configuracoes
set nfe_provider_default = 'brasilnfe'
where nfe_provider_default is null or nfe_provider_default = '';

insert into public.integracoes (tipo, conectado)
values ('brasilnfe', false)
on conflict (tipo) do nothing;

create index if not exists idx_pedidos_nfe_provider on public.pedidos (nfe_provider);
create index if not exists idx_pedidos_nfe_external_id on public.pedidos (nfe_external_id);
