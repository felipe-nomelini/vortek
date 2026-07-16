alter table public.pedidos
  add column if not exists envio_interno_at timestamptz;

comment on column public.pedidos.envio_interno_at is
  'Momento em que a etiqueta foi processada para envio interno, sem pedido de compra DSLite.';

create index if not exists idx_pedidos_envio_interno_at
  on public.pedidos (envio_interno_at)
  where envio_interno_at is not null;
