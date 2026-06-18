insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('etiquetas', 'etiquetas', false, 10485760, array['application/pdf'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.pedidos
  add column if not exists ml_label_storage_path text,
  add column if not exists ml_label_url text,
  add column if not exists ml_label_downloaded_at timestamptz,
  add column if not exists ml_label_bytes integer;

create index if not exists idx_pedidos_ml_label_storage_path
  on public.pedidos (ml_label_storage_path)
  where ml_label_storage_path is not null;

create index if not exists idx_pedidos_ml_shipment_label_missing
  on public.pedidos (ml_shipment_id)
  where ml_shipment_id is not null and ml_label_storage_path is null;
