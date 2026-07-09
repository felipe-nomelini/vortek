alter table public.pedidos
  add column if not exists dslite_label_source text;

comment on column public.pedidos.dslite_label_source is
  'Origem da etiqueta enviada para DSLite: placeholder_release_window, mercado_livre ou null para legado/indefinido.';
