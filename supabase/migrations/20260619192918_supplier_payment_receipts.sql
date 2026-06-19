alter table public.compras
add column if not exists supplier_payment_receipt_path text null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-payment-receipts',
  'supplier-payment-receipts',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
