-- Timestamp de refresh sem alteração de custo/oferta/composição não invalida economia.
begin;
set local lock_timeout='5s';
create or replace view public.current_pricing_evaluations with (security_invoker = true) as
select distinct on (e.produto_id, coalesce(e.ml_item_id,''), e.scenario) e.*
from public.pricing_evaluations e
join public.produtos p on p.id=e.produto_id
left join public.produto_fornecedor_ofertas o on o.id=e.offer_id
where e.valid_until>now()
  and not (e.memory ? 'variableCosts')
  and jsonb_typeof(e.memory->'costComponents')='array'
  and jsonb_array_length(e.memory->'costComponents')>0
  and not exists (
    select 1 from jsonb_array_elements(e.memory->'costComponents') c
    left join public.produto_fornecedor_ofertas co on co.id=(c->>'offerId')::uuid
    left join public.produtos cp on cp.id=(c->>'productId')::uuid
    where co.id is null or co.ativo is not true or co.produto_id is distinct from cp.id
      or co.custo is distinct from (c->>'unitCost')::numeric
      or not exists(select 1 from public.fornecedores f where f.dslite_id=co.dslite_fornecedor_id and f.ativo)
      or co.id is distinct from (
        select eligible.id from public.produto_fornecedor_ofertas eligible
        where eligible.produto_id=cp.id and eligible.ativo and eligible.custo>0
          and exists(select 1 from public.fornecedores f where f.dslite_id=eligible.dslite_fornecedor_id and f.ativo)
        order by (cp.fornecedor_preferencial_manual is true and eligible.id=cp.oferta_preferencial_id) desc nulls last,
          (eligible.estoque>0) desc nulls last, eligible.custo, coalesce(eligible.prioridade,100), eligible.estoque desc nulls last, eligible.id
        limit 1
      )
      or (cp.id<>p.id and (cp.ativo is not true or not exists(
         select 1 from public.produto_kits k join public.produto_kit_componentes kc on kc.kit_produto_id=k.produto_id
         where k.produto_id=p.id and k.ativo and kc.componente_produto_id=cp.id and kc.quantidade=(c->>'quantity')::integer
      )))
  )
  and (e.offer_id is null or (o.ativo and o.custo=(e.memory->>'cost')::numeric and exists (select 1 from public.fornecedores f where f.dslite_id=o.dslite_fornecedor_id and f.ativo)))
  and (e.scenario<>'current' or exists (select 1 from public.anuncios_ml a where a.ml_item_id=e.ml_item_id and a.produto_id=e.produto_id and a.preco_ml=e.price))
  and e.memory#>>'{tax,referenceMonth}'=to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM')
  and e.policy_version=coalesce((select c.pricing_policy->>'version' from public.configuracoes c limit 1),'VORTEK-CANON-1.0-ECON-2')
order by e.produto_id,coalesce(e.ml_item_id,''),e.scenario,e.evaluated_at desc,e.id;
notify pgrst, 'reload schema';
commit;
