create sequence if not exists public.produtos_vtk_sku_seq;

create or replace function public.next_vortek_product_sku()
returns text
language sql
as $$
  select 'VTK' || lpad(nextval('public.produtos_vtk_sku_seq')::text, 6, '0')
$$;

alter table public.produtos
  alter column sku set default public.next_vortek_product_sku();

with numbered as (
  select
    id,
    'VTK' || lpad(row_number() over (order by created_at asc, id asc)::text, 6, '0') as next_sku
  from public.produtos
)
update public.produtos p
set sku = n.next_sku
from numbered n
where p.id = n.id
  and p.sku !~ '^VTK[0-9]{6}$';

select setval(
  'public.produtos_vtk_sku_seq',
  greatest(
    coalesce((
      select max((substring(sku from 4))::bigint)
      from public.produtos
      where sku ~ '^VTK[0-9]{6}$'
    ), 0),
    1
  ),
  true
);

update public.anuncios_ml a
set sku = p.sku,
    updated_at = now()
from public.produtos p
where a.produto_id = p.id
  and a.sku is distinct from p.sku;

drop index if exists public.produto_fornecedor_ofertas_sku_oferta_unique;

update public.produto_fornecedor_ofertas
set
  sku_oferta = case
    when dslite_fornecedor_id = '2' and upper(coalesce(sku_oferta, '')) like 'HYX%' then substring(sku_oferta from 4)
    when dslite_fornecedor_id = '27' and upper(coalesce(sku_oferta, '')) like 'FJ%' then substring(sku_oferta from 3)
    when dslite_fornecedor_id = '39' and upper(coalesce(sku_oferta, '')) like 'NMC%' then substring(sku_oferta from 4)
    when dslite_fornecedor_id = '81' and upper(coalesce(sku_oferta, '')) like 'VO%' then substring(sku_oferta from 3)
    else sku_oferta
  end,
  sku_fornecedor = case
    when dslite_fornecedor_id = '2' and upper(coalesce(sku_fornecedor, '')) like 'HYX%' then substring(sku_fornecedor from 4)
    when dslite_fornecedor_id = '27' and upper(coalesce(sku_fornecedor, '')) like 'FJ%' then substring(sku_fornecedor from 3)
    when dslite_fornecedor_id = '39' and upper(coalesce(sku_fornecedor, '')) like 'NMC%' then substring(sku_fornecedor from 4)
    when dslite_fornecedor_id = '81' and upper(coalesce(sku_fornecedor, '')) like 'VO%' then substring(sku_fornecedor from 3)
    else sku_fornecedor
  end,
  updated_at = now();

create index if not exists produto_fornecedor_ofertas_sku_oferta_idx
on public.produto_fornecedor_ofertas (upper(sku_oferta));

create index if not exists produto_fornecedor_ofertas_sku_fornecedor_idx
on public.produto_fornecedor_ofertas (upper(sku_fornecedor));
