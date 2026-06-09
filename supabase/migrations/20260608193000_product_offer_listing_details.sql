alter table public.produto_fornecedor_ofertas
  add column if not exists sku_oferta text null,
  add column if not exists nome text null,
  add column if not exists descricao text null,
  add column if not exists marca text null,
  add column if not exists imagens jsonb not null default '[]'::jsonb,
  add column if not exists gtin text null,
  add column if not exists ncm text null,
  add column if not exists cest text null;

update public.produto_fornecedor_ofertas o
set
  sku_oferta = coalesce(
    nullif(o.sku_oferta, ''),
    nullif(o.sku_fornecedor, ''),
    concat('OFERTA-', o.dslite_fornecedor_id, '-', o.dslite_produto_id)
  ),
  nome = coalesce(nullif(o.nome, ''), nullif(p.nome, ''), concat('Oferta ', o.dslite_produto_id)),
  descricao = coalesce(nullif(o.descricao, ''), nullif(p.descricao, ''), ''),
  marca = coalesce(nullif(o.marca, ''), nullif(p.marca, ''), ''),
  imagens = case
    when jsonb_typeof(coalesce(o.imagens, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(o.imagens, '[]'::jsonb)) > 0 then o.imagens
    when jsonb_typeof(to_jsonb(coalesce(p.imagens, array[]::text[]))) = 'array' then to_jsonb(coalesce(p.imagens, array[]::text[]))
    else '[]'::jsonb
  end,
  gtin = coalesce(nullif(o.gtin, ''), nullif(p.gtin, ''), ''),
  ncm = coalesce(nullif(o.ncm, ''), p.ncm),
  cest = coalesce(nullif(o.cest, ''), p.cest)
from public.produtos p
where p.id = o.produto_id;

alter table public.produto_fornecedor_ofertas
  alter column sku_oferta set not null,
  alter column nome set not null;

create unique index if not exists produto_fornecedor_ofertas_sku_oferta_unique
on public.produto_fornecedor_ofertas (upper(sku_oferta));

create index if not exists produto_fornecedor_ofertas_fornecedor_nome_idx
on public.produto_fornecedor_ofertas (fornecedor_nome);

alter table public.compras
  add column if not exists produto_fornecedor_oferta_id uuid null references public.produto_fornecedor_ofertas(id) on delete set null;

create index if not exists compras_produto_fornecedor_oferta_id_idx
on public.compras (produto_fornecedor_oferta_id);
