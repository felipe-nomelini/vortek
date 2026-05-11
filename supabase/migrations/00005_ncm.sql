-- Add missing columns to produtos
alter table public.produtos add column if not exists ncm text;
