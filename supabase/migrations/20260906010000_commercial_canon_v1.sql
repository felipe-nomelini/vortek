-- Cânon Comercial 1.0: alteração incremental; histórico econômico permanece imutável.
begin;
set local lock_timeout='5s';
lock table public.configuracoes in row exclusive mode;
insert into public.pricing_events(event_type,pricing_source,actor,reason,rule_id,dedupe_key,payload)
select 'CANON_MIGRATED','canon_migration','Diretoria / implementação autorizada','Remoção de custo variável; garantia produto a produto; políticas comerciais homologadas','VORTEK-CANON-1.0-ECON-2','canon-economic-v2',jsonb_build_object('previous_policy',pricing_policy,'previous_tax',pricing_tax_config,'canon_version','1.0') from public.configuracoes
on conflict(dedupe_key) do nothing;
update public.configuracoes set pricing_tax_config=pricing_tax_config-'variableCosts'-'custo_variavel',
pricing_policy=coalesce(pricing_policy,'{"version":"VORTEK-CANON-1.0-ECON-2","bands":[{"id":"BELOW_200","maxCents":20000,"floor":0.05,"target":0.07,"limit":0.1},{"id":"FROM_200_TO_1000","maxCents":100000,"floor":0.07,"target":0.1,"limit":0.15},{"id":"ABOVE_1000","maxCents":null,"floor":0.1,"target":0.15,"limit":0.2}],"maxIterations":12,"feeFallbackRate":0.15,"evidenceMaxAgeHours":24,"autonomy":"REQUIRES_CONFIRMATION","radar":{"mode":"AUTO_OBSERVE","hour":2,"batchSize":50,"concurrency":4}}'::jsonb)||jsonb_build_object('version','VORTEK-CANON-1.0-ECON-2','bands','[{"id":"BELOW_200","maxCents":20000,"floor":0.05,"target":0.07,"limit":0.1},{"id":"FROM_200_TO_1000","maxCents":100000,"floor":0.07,"target":0.1,"limit":0.15},{"id":"ABOVE_1000","maxCents":null,"floor":0.1,"target":0.15,"limit":0.2}]'::jsonb),updated_at=now();
comment on column public.configuracoes.margem_lucro is 'DEPRECATED: histórico/compatibilidade somente; sem autoridade comercial na V2.';
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
      or co.updated_at is distinct from (c->>'observedAt')::timestamptz
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
revoke all on public.current_pricing_evaluations from anon,authenticated;
grant select on public.current_pricing_evaluations to service_role;


create or replace function public.update_canonical_pricing_config(p_policy jsonb,p_tax jsonb,p_expected_version text,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.configuracoes%rowtype;
begin
  select * into c from public.configuracoes limit 1 for update;
  if not found then raise exception 'CONFIGURACAO_INEXISTENTE'; end if;
  if p_policy is null or p_tax is null or p_expected_version is null or nullif(trim(p_actor),'') is null or nullif(trim(p_reason),'') is null then raise exception 'CONFIGURACAO_INVALIDA'; end if;
  if coalesce(c.pricing_policy->>'version','VORTEK-CANON-1.0-ECON-2') <> p_expected_version then raise exception 'CONFIGURACAO_ALTERADA_CONCORRENTEMENTE'; end if;
  if p_tax ? 'variableCosts' or p_tax ? 'custo_variavel' then raise exception 'POLITICA_REMOVIDA'; end if;
  if p_policy->'bands' is distinct from '[{"id":"BELOW_200","maxCents":20000,"floor":0.05,"target":0.07,"limit":0.1},{"id":"FROM_200_TO_1000","maxCents":100000,"floor":0.07,"target":0.1,"limit":0.15},{"id":"ABOVE_1000","maxCents":null,"floor":0.1,"target":0.15,"limit":0.2}]'::jsonb then raise exception 'POLITICA_NAO_HOMOLOGADA'; end if;
  if p_policy->>'version' not like 'VORTEK-CANON-1.0-ECON-2%' then raise exception 'VERSAO_ECONOMICA_INCOMPATIVEL'; end if;
  if p_policy->>'autonomy' is distinct from 'REQUIRES_CONFIRMATION' or p_policy#>>'{radar,mode}' is distinct from 'AUTO_OBSERVE' then raise exception 'AUTONOMIA_NAO_HOMOLOGADA'; end if;
  insert into public.pricing_events(event_type,pricing_source,actor,reason,rule_id,payload)
  values ('CONFIG_CHANGED','settings',p_actor,p_reason,p_policy->>'version',jsonb_build_object('previous_policy',c.pricing_policy,'policy',p_policy,'previous_tax',c.pricing_tax_config,'tax',p_tax));
  update public.configuracoes set pricing_policy=p_policy,pricing_tax_config=p_tax,updated_at=now() where id=c.id;
  return jsonb_build_object('pricing_policy',p_policy,'pricing_tax_config',p_tax,'impact','SIMULACAO_REQUERIDA');
end $$;
revoke all on function public.update_canonical_pricing_config(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.update_canonical_pricing_config(jsonb,jsonb,text,text,text) to service_role;

-- Serializa decisões do mesmo grupo para evitar ativações concorrentes e revogação perdida.
create or replace function public.register_commercial_strategy(p_event jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_group text:=p_event->>'pricing_group_id'; v_kind text:=p_event#>>'{payload,kind}'; v_id uuid:=(p_event->>'id')::uuid;
begin
 if nullif(v_group,'') is null or nullif(p_event->>'actor','') is null or nullif(trim(p_event->>'reason'),'') is null then raise exception 'ESTRATEGIA_INVALIDA'; end if;
 perform pg_advisory_xact_lock(hashtextextended('commercial:'||v_group,0));
 if p_event->>'event_type'='STRATEGY_REGISTERED' then
   if v_kind not in ('functional','clearance','manual_pricing_override') then raise exception 'ESTRATEGIA_INVALIDA'; end if;
   if exists(select 1 from public.pricing_events s where s.pricing_group_id=v_group and s.event_type='STRATEGY_REGISTERED' and s.payload->>'kind'=v_kind
     and ((s.payload->>'untilRevoked'='true' and (s.payload->>'validUntil') is null) or (s.payload->>'validUntil')::timestamptz>now())
     and not exists(select 1 from public.pricing_events r where r.event_type='STRATEGY_REVOKED' and r.payload->>'strategyId'=s.id::text)) then raise exception 'ESTRATEGIA_JA_VIGENTE'; end if;
 elsif p_event->>'event_type'='STRATEGY_REVOKED' then
   if not exists(select 1 from public.pricing_events s where s.id=(p_event#>>'{payload,strategyId}')::uuid and s.pricing_group_id=v_group and s.event_type='STRATEGY_REGISTERED') then raise exception 'ESTRATEGIA_NAO_ENCONTRADA'; end if;
 else raise exception 'EVENTO_INVALIDO'; end if;
 insert into public.pricing_events(id,event_type,produto_id,ml_item_id,pricing_group_id,pricing_source,actor,reason,rule_id,dedupe_key,payload)
 values(v_id,p_event->>'event_type',(p_event->>'produto_id')::uuid,p_event->>'ml_item_id',v_group,p_event->>'pricing_source',p_event->>'actor',p_event->>'reason',p_event->>'rule_id',p_event->>'dedupe_key',p_event->'payload') on conflict(dedupe_key) do nothing;
 return v_id;
end $$;
revoke all on function public.register_commercial_strategy(jsonb) from public,anon,authenticated;
grant execute on function public.register_commercial_strategy(jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
