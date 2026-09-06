create or replace view public.current_pricing_evaluations with (security_invoker=true) as  SELECT DISTINCT ON (e.produto_id, (COALESCE(e.ml_item_id, ''::text)), e.scenario) e.id,
    e.produto_id,
    e.ml_item_id,
    e.pricing_group_id,
    e.scenario,
    e.fingerprint,
    e.policy_version,
    e.product_version,
    e.offer_id,
    e.offer_version,
    e.memory,
    e.price,
    e.result,
    e.margin,
    e.status,
    e.evaluated_at,
    e.valid_until,
    e.job_id,
    e.created_at
   FROM pricing_evaluations e
     JOIN produtos p ON p.id = e.produto_id
     LEFT JOIN produto_fornecedor_ofertas o ON o.id = e.offer_id
  WHERE e.valid_until > now() AND (e.offer_id IS NULL OR o.ativo AND o.custo = ((e.memory ->> 'cost'::text)::numeric) AND p.oferta_preferencial_id = e.offer_id AND (EXISTS ( SELECT 1
           FROM fornecedores f
          WHERE f.dslite_id = o.dslite_fornecedor_id AND f.ativo))) AND (e.scenario <> 'current'::text OR (EXISTS ( SELECT 1
           FROM anuncios_ml a
          WHERE a.ml_item_id = e.ml_item_id AND a.produto_id = e.produto_id AND a.preco_ml = e.price))) AND (e.memory #>> '{tax,referenceMonth}'::text[]) = to_char((now() AT TIME ZONE 'America/Sao_Paulo'::text), 'YYYY-MM'::text) AND e.policy_version = COALESCE(( SELECT c.pricing_policy ->> 'version'::text
           FROM configuracoes c
         LIMIT 1), 'M2M-PRC-01-v1'::text)
  ORDER BY e.produto_id, (COALESCE(e.ml_item_id, ''::text)), e.scenario, e.evaluated_at DESC, e.id;;
CREATE OR REPLACE FUNCTION public.update_canonical_pricing_config(p_policy jsonb, p_tax jsonb, p_expected_version text, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.configuracoes%rowtype;
begin
  select * into c from public.configuracoes limit 1 for update;
  if not found then raise exception 'CONFIGURACAO_INEXISTENTE'; end if;
  if p_policy is null or p_tax is null or p_expected_version is null or nullif(trim(p_actor),'') is null or nullif(trim(p_reason),'') is null then raise exception 'CONFIGURACAO_INVALIDA'; end if;
  if coalesce(c.pricing_policy->>'version','M2M-PRC-01-v1') <> p_expected_version then raise exception 'CONFIGURACAO_ALTERADA_CONCORRENTEMENTE'; end if;
  if p_policy->>'autonomy' is distinct from 'REQUIRES_CONFIRMATION' or p_policy#>>'{radar,mode}' is distinct from 'AUTO_OBSERVE' then raise exception 'AUTONOMIA_NAO_HOMOLOGADA'; end if;
  insert into public.pricing_events(event_type,pricing_source,actor,reason,rule_id,payload)
  values ('CONFIG_CHANGED','settings',p_actor,p_reason,p_policy->>'version',jsonb_build_object('previous_policy',c.pricing_policy,'policy',p_policy,'previous_tax',c.pricing_tax_config,'tax',p_tax));
  update public.configuracoes set pricing_policy=p_policy,pricing_tax_config=p_tax,updated_at=now() where id=c.id;
  return jsonb_build_object('pricing_policy',p_policy,'pricing_tax_config',p_tax,'impact','SIMULACAO_REQUERIDA');
end $function$

