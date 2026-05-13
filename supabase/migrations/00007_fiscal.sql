-- Add fiscal data columns to produtos
alter table public.produtos add column if not exists cest text;
alter table public.produtos add column if not exists origem_fiscal text;
alter table public.produtos add column if not exists origem_uf text;
alter table public.produtos add column if not exists csosn text default '102';
