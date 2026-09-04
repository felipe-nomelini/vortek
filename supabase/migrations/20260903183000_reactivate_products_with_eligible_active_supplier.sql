-- produtos.ativo representa exclusivamente a decisão manual do usuário.
-- Repara apenas produtos legados inativos que já possuem uma oferta elegível
-- em fornecedor ativo; anúncios e ofertas não são alterados por esta migração.
with eligible_products as (
  select distinct product.id
  from public.produtos product
  join public.produto_fornecedor_ofertas offer
    on offer.produto_id = product.id
  join public.fornecedores supplier
    on supplier.dslite_id = offer.dslite_fornecedor_id
  where product.ativo = false
    and supplier.ativo = true
    and offer.ativo = true
    and offer.custo > 0
    and offer.custo <= 2000
)
update public.produtos product
set
  ativo = true,
  updated_at = now()
from eligible_products eligible
where product.id = eligible.id;
