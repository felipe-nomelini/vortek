-- Add fornecedor column to produtos
alter table public.produtos add column if not exists fornecedor text;
