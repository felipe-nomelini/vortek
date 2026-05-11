-- Remove Bling columns from produtos
alter table public.produtos drop column if exists bling_id;
alter table public.produtos drop column if exists bling_status;
alter table public.produtos drop column if exists preco_bling;

-- Remove Bling columns from pedidos
alter table public.pedidos drop column if exists bling_id;

-- Remove Bling columns from clientes
alter table public.clientes drop column if exists bling_contato_id;

-- Remove Bling columns from anuncios_ml
alter table public.anuncios_ml drop column if exists preco_bling;

-- Drop bling_status enum type
drop type if exists bling_status;

-- Remove bling integration row
delete from public.integracoes where tipo = 'bling';
