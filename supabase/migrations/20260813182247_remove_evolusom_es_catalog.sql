-- EVOLUSOM-ES (DSLite 134) não opera dropshipping. Esta limpeza mantém
-- EVOLUSOM-PR (DSLite 133) e fornecedores alternativos válidos.
-- Aplicar somente após gerar backup do banco.

-- Índices necessários para validar as FKs sem varrer tabelas inteiras para
-- cada produto removido.
create index if not exists idx_anuncios_ml_produto_id
  on public.anuncios_ml (produto_id);
create index if not exists idx_anuncios_ml_outbox_produto_id
  on public.anuncios_ml_outbox (produto_id);

create temp table _evolusom_es_affected_products on commit drop as
select distinct produto_id as id
from public.produto_fornecedor_ofertas
where dslite_fornecedor_id = '134'
union
select id
from public.produtos
where dslite_fornecedor_id = '134';

create temp table _evolusom_es_shared_products on commit drop as
select affected.id
from _evolusom_es_affected_products affected
where exists (
  select 1
  from public.produto_fornecedor_ofertas offer
  where offer.produto_id = affected.id
    and offer.dslite_fornecedor_id <> '134'
);

create temp table _evolusom_es_exclusive_products on commit drop as
select affected.id
from _evolusom_es_affected_products affected
where not exists (
  select 1
  from public.produto_fornecedor_ofertas offer
  where offer.produto_id = affected.id
    and offer.dslite_fornecedor_id <> '134'
);

create unique index on _evolusom_es_affected_products (id);
create unique index on _evolusom_es_shared_products (id);
create unique index on _evolusom_es_exclusive_products (id);
analyze _evolusom_es_affected_products;
analyze _evolusom_es_shared_products;
analyze _evolusom_es_exclusive_products;

do $$
declare
  unsafe_count bigint;
begin
  select count(*)
  into unsafe_count
  from _evolusom_es_shared_products shared
  where not exists (
    select 1
    from public.produto_fornecedor_ofertas offer
    where offer.produto_id = shared.id
      and offer.dslite_fornecedor_id <> '134'
      and offer.ativo = true
      and offer.custo > 0
  );

  if unsafe_count > 0 then
    raise exception
      'Limpeza EVOLUSOM-ES abortada: % produtos compartilhados sem oferta alternativa ativa e válida',
      unsafe_count;
  end if;
end
$$;

do $$
declare
  unsafe_count bigint;
begin
  select
    (select count(*)
     from _evolusom_es_exclusive_products exclusive
     join public.produtos product on product.id = exclusive.id
     where product.ml_item_id is not null)
    + (select count(*)
       from _evolusom_es_exclusive_products exclusive
       join public.anuncios_ml listing on listing.produto_id = exclusive.id)
    + (select count(*)
       from _evolusom_es_exclusive_products exclusive
       join public.catalogo_ml_snapshot snapshot on snapshot.produto_id = exclusive.id)
    + (select count(*)
       from _evolusom_es_exclusive_products exclusive
       join public.estoque_interno_movimentacoes movement on movement.produto_id = exclusive.id)
    + (select count(*)
       from _evolusom_es_exclusive_products exclusive
       join public.produto_kits kit on kit.produto_id = exclusive.id)
    + (select count(*)
       from _evolusom_es_exclusive_products exclusive
       join public.produto_kit_componentes component on component.componente_produto_id = exclusive.id)
    + (select count(*)
       from _evolusom_es_exclusive_products exclusive
       join public.anuncios_ml_outbox outbox on outbox.produto_id = exclusive.id)
  into unsafe_count;

  if unsafe_count > 0 then
    raise exception
      'Limpeza EVOLUSOM-ES abortada: % produtos exclusivos possuem dependências operacionais',
      unsafe_count;
  end if;
end
$$;

do $$
declare
  unsafe_count bigint;
begin
  select count(*)
  into unsafe_count
  from public.compras purchase
  join public.produto_fornecedor_ofertas offer
    on offer.id = purchase.produto_fornecedor_oferta_id
  where offer.dslite_fornecedor_id = '134';

  if unsafe_count > 0 then
    raise exception
      'Limpeza EVOLUSOM-ES abortada: % compras estão vinculadas a ofertas ES',
      unsafe_count;
  end if;
end
$$;

delete from public.produto_fornecedor_ofertas offer
using _evolusom_es_shared_products shared
where offer.produto_id = shared.id
  and offer.dslite_fornecedor_id = '134';

with ranked_offers as (
  select
    offer.*,
    row_number() over (
      partition by offer.produto_id
      order by
        case when offer.estoque > 0 then 0 else 1 end,
        offer.custo asc,
        offer.prioridade asc,
        offer.estoque desc,
        offer.id asc
    ) as position
  from public.produto_fornecedor_ofertas offer
  join _evolusom_es_shared_products shared
    on shared.id = offer.produto_id
  where offer.dslite_fornecedor_id <> '134'
    and offer.ativo = true
    and offer.custo > 0
)
update public.produtos product
set
  oferta_preferencial_id = offer.id,
  fornecedor_preferencial_manual = false,
  fornecedor = coalesce(nullif(trim(offer.fornecedor_nome), ''), product.fornecedor),
  custo = offer.custo,
  estoque = offer.estoque,
  dslite_fornecedor_id = offer.dslite_fornecedor_id,
  dslite_produto_id = offer.dslite_produto_id,
  dslite_ultima_sync = coalesce(offer.last_sync_at, product.dslite_ultima_sync),
  updated_at = now()
from ranked_offers offer
where product.id = offer.produto_id
  and offer.position = 1;

delete from public.produtos product
using _evolusom_es_exclusive_products exclusive
where product.id = exclusive.id;

update public.fornecedores
set ativo = false,
    updated_at = now()
where dslite_id = '134';

do $$
begin
  if exists (
    select 1
    from public.produto_fornecedor_ofertas
    where dslite_fornecedor_id = '134'
  ) then
    raise exception 'Limpeza EVOLUSOM-ES incompleta: ofertas do fornecedor 134 permanecem';
  end if;

  if exists (
    select 1
    from public.produtos
    where dslite_fornecedor_id = '134'
  ) then
    raise exception 'Limpeza EVOLUSOM-ES incompleta: produtos ainda apontam para o fornecedor 134';
  end if;

  if exists (
    select 1
    from public.fornecedores
    where dslite_id = '134'
      and ativo = true
  ) then
    raise exception 'Limpeza EVOLUSOM-ES incompleta: fornecedor 134 permanece ativo';
  end if;
end
$$;
