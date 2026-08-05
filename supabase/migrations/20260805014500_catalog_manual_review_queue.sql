alter table public.anuncios_ml
  add column if not exists catalog_review_pending boolean not null default false;

comment on column public.anuncios_ml.catalog_review_pending is
  'Mantém o anúncio próprio na fila manual de elegibilidade até a conversão segura para catálogo.';

create index if not exists idx_anuncios_ml_catalog_review_pending
  on public.anuncios_ml (catalog_review_pending, status, catalogo)
  where catalog_review_pending = true;
