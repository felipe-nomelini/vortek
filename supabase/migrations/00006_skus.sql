-- Fix SKUs with MLB prefix (ML listing codes) — use dslite_produto_id
update public.produtos
set sku = 'VO' || dslite_produto_id
where sku like 'MLB%' and fornecedor = 'VITRINE OUTLET';

-- Add prefixes to fornecedores that don't have them
update public.produtos
set sku = 'NMC' || sku
where fornecedor = 'NOVA CENTER' and sku not like 'NMC%';

update public.produtos
set sku = 'FJ' || sku
where fornecedor = 'FLORATTA JOIAS' and sku not like 'FJ%';

update public.produtos
set sku = 'VO' || sku
where fornecedor = 'VITRINE OUTLET' and sku not like 'VO%' and sku not like 'MLB%';
