update storage.buckets
set allowed_mime_types = array['application/pdf', 'text/plain']
where id = 'etiquetas';

alter table public.pedidos
  add column if not exists ml_thermal_label_storage_path text,
  add column if not exists ml_thermal_label_downloaded_at timestamptz,
  add column if not exists ml_thermal_label_bytes integer;

create index if not exists idx_pedidos_ml_thermal_label_storage_path
  on public.pedidos (ml_thermal_label_storage_path)
  where ml_thermal_label_storage_path is not null;
