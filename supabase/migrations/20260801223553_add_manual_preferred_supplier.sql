alter table public.produtos
  add column if not exists fornecedor_preferencial_manual boolean not null default false;

comment on column public.produtos.fornecedor_preferencial_manual is
  'Quando true, oferta_preferencial_id foi escolhida manualmente e prevalece sobre menor custo.';
