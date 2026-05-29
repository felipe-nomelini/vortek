alter table public.empresa
  add column if not exists uf_fiscal char(2),
  add column if not exists cod_municipio_fiscal char(7);

update public.empresa
set
  uf_fiscal = coalesce(nullif(trim(uf_fiscal), ''), 'RS'),
  cod_municipio_fiscal = coalesce(nullif(trim(cod_municipio_fiscal), ''), '4314902')
where cnpj = '65.850.289/0001-83'
   or replace(cnpj, '.', '') = '65850289/0001-83'
   or replace(replace(replace(cnpj, '.', ''), '/', ''), '-', '') = '65850289000183';

update public.empresa
set uf_fiscal = 'RS'
where uf_fiscal is null or trim(uf_fiscal) = '';

alter table public.empresa
  alter column uf_fiscal set not null;
