drop index if exists public.idx_anuncios_ml_catalog_review_pending;

alter table public.anuncios_ml
  drop column if exists catalog_review_pending;
