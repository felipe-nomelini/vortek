alter table public.produtos
  add column if not exists oferta_preferencial_id uuid null;

drop index if exists public.produto_fornecedor_ofertas_produto_supplier_unique;

create index if not exists produto_fornecedor_ofertas_produto_supplier_idx
on public.produto_fornecedor_ofertas (produto_id, dslite_fornecedor_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'produtos_oferta_preferencial_id_fkey'
  ) then
    alter table public.produtos
      add constraint produtos_oferta_preferencial_id_fkey
      foreign key (oferta_preferencial_id)
      references public.produto_fornecedor_ofertas(id)
      on delete set null;
  end if;
end $$;

create index if not exists produtos_oferta_preferencial_id_idx
on public.produtos (oferta_preferencial_id);

create temp table tmp_produto_gtin_merge as
with normalized as (
  select
    p.id,
    nullif(regexp_replace(coalesce(p.gtin, ''), '\D', '', 'g'), '') as gtin_norm,
    p.ml_item_id,
    p.created_at,
    row_number() over (
      partition by nullif(regexp_replace(coalesce(p.gtin, ''), '\D', '', 'g'), '')
      order by
        case when coalesce(p.ml_item_id, '') <> '' then 0 else 1 end,
        p.created_at asc,
        p.id asc
    ) as rn,
    count(*) over (
      partition by nullif(regexp_replace(coalesce(p.gtin, ''), '\D', '', 'g'), '')
    ) as cnt
  from public.produtos p
)
select
  dup.id as duplicate_id,
  canon.id as canonical_id,
  canon.gtin_norm
from normalized dup
join normalized canon
  on canon.gtin_norm = dup.gtin_norm
 and canon.rn = 1
where dup.gtin_norm is not null
  and dup.cnt > 1
  and dup.rn > 1;

update public.produto_fornecedor_ofertas o
set produto_id = m.canonical_id
from tmp_produto_gtin_merge m
where o.produto_id = m.duplicate_id;

update public.anuncios_ml a
set produto_id = m.canonical_id
from tmp_produto_gtin_merge m
where a.produto_id = m.duplicate_id;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'catalogo_ml_snapshot'
  ) then
    update public.catalogo_ml_snapshot s
    set produto_id = m.canonical_id
    from tmp_produto_gtin_merge m
    where s.produto_id = m.duplicate_id;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'ml_publish_outbox'
  ) then
    update public.ml_publish_outbox o
    set produto_id = m.canonical_id
    from tmp_produto_gtin_merge m
    where o.produto_id = m.duplicate_id;
  end if;
end $$;

delete from public.produtos p
using tmp_produto_gtin_merge m
where p.id = m.duplicate_id;

update public.produtos p
set gtin = regexp_replace(coalesce(p.gtin, ''), '\D', '', 'g')
where coalesce(p.gtin, '') <> regexp_replace(coalesce(p.gtin, ''), '\D', '', 'g');

with preferred_offers as (
  select distinct on (o.produto_id)
    o.produto_id,
    o.id as oferta_id,
    o.custo,
    o.estoque,
    o.fornecedor_nome,
    o.dslite_fornecedor_id,
    o.dslite_produto_id,
    o.last_sync_at
  from public.produto_fornecedor_ofertas o
  where o.produto_id is not null
  order by
    o.produto_id,
    case when o.ativo = false then 1 else 0 end asc,
    case when coalesce(o.estoque, 0) > 0 then 0 else 1 end asc,
    coalesce(o.custo, 0) asc,
    coalesce(o.prioridade, 100) asc,
    coalesce(o.estoque, 0) desc,
    o.created_at asc,
    o.id asc
)
update public.produtos p
set
  oferta_preferencial_id = po.oferta_id,
  custo = coalesce(po.custo, p.custo),
  estoque = coalesce(po.estoque, p.estoque),
  fornecedor = coalesce(po.fornecedor_nome, p.fornecedor),
  dslite_fornecedor_id = nullif(po.dslite_fornecedor_id, ''),
  dslite_produto_id = nullif(po.dslite_produto_id, ''),
  dslite_ultima_sync = coalesce(po.last_sync_at, p.dslite_ultima_sync)
from preferred_offers po
where p.id = po.produto_id;

create unique index if not exists produtos_gtin_normalized_unique
on public.produtos ((nullif(regexp_replace(coalesce(gtin, ''), '\D', '', 'g'), '')))
where nullif(regexp_replace(coalesce(gtin, ''), '\D', '', 'g'), '') is not null;
