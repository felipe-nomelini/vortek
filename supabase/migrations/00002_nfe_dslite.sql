-- Add brasilnfe to integracao_tipo enum
alter type integracao_tipo add value if not exists 'brasilnfe';

-- Add NFe details columns to pedidos
alter table public.pedidos add column if not exists nfe_chave text;
alter table public.pedidos add column if not exists nfe_xml text;
alter table public.pedidos add column if not exists nfe_danfe_url text;
alter table public.pedidos add column if not exists nfe_protocolo text;
alter table public.pedidos add column if not exists nfe_status text default 'pendente';

-- Add DSLite columns to pedidos
alter table public.pedidos add column if not exists dslite_id text;
alter table public.pedidos add column if not exists dslite_status text;

-- Add sync tracking columns to produtos
alter table public.produtos add column if not exists dslite_fornecedor_id text;
alter table public.produtos add column if not exists dslite_produto_id text;
alter table public.produtos add column if not exists dslite_ultima_sync timestamptz;

-- Insert brasilnfe integration placeholder
insert into public.integracoes (tipo, conectado)
values ('brasilnfe', false)
on conflict (tipo) do nothing;
