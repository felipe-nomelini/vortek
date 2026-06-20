alter table public.fornecedores
  add column if not exists supplier_pix_key text not null default '';

update public.fornecedores
set supplier_pix_key = '11940733061'
where dslite_id = '39'
  and coalesce(nullif(trim(supplier_pix_key), ''), '') = '';
