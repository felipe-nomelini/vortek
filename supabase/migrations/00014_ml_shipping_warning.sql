alter table public.produtos
  add column if not exists ml_shipping_warning text;
