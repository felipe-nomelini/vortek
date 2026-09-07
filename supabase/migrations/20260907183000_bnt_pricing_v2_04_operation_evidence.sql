-- V2-04: preservar baseline de todos os membros; resultado desconhecido não pode liberar nova tentativa sem prova.
create or replace function public.prepare_pricing_operation(p_id uuid,p_evaluation_id uuid,p_group_id uuid,p_group_version integer,p_item_id text,p_price_cents bigint,p_source text,p_actor_id uuid,p_reason text,p_rule_id text default null,p_job_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare evaluation public.pricing_evaluations%rowtype; existing public.pricing_operations%rowtype; baseline bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('pricing-operation:'||p_id::text,0));
 select * into existing from public.pricing_operations where id=p_id;
 if existing.id is not null then
   if row(existing.evaluation_id,existing.group_id,existing.group_version,existing.item_id,existing.new_price_cents,existing.source,existing.actor_id,existing.reason,existing.rule_id,existing.job_id)
   is distinct from row(p_evaluation_id,p_group_id,p_group_version,p_item_id,p_price_cents,p_source,p_actor_id,p_reason,p_rule_id,p_job_id) then raise exception 'pricing_idempotency_conflict'; end if;
   return existing.id;
 end if;
 select * into evaluation from public.pricing_evaluations where id=p_evaluation_id;
 if evaluation.id is null or not exists(select 1 from public.ml_pricing_groups g join public.ml_pricing_group_members m on m.group_id=g.id and m.version=g.current_version and m.is_current where g.id=p_group_id and g.current_version=p_group_version and g.state='verified' and g.produto_id=evaluation.produto_id and m.ml_item_id=p_item_id) then raise exception 'pricing_group_not_valid'; end if;
 select new_price_cents into baseline from public.pricing_events where item_id=p_item_id and kind in ('observed','baseline') and pricing_source='mercado_livre' order by id desc limit 1;
 if baseline is null then raise exception 'pricing_baseline_missing'; end if;
 if exists(select 1 from public.ml_pricing_group_members m left join lateral (select new_price_cents from public.pricing_events e where e.item_id=m.ml_item_id and e.kind in ('observed','baseline') and e.pricing_source='mercado_livre' order by id desc limit 1) e on true where m.group_id=p_group_id and m.version=p_group_version and e.new_price_cents is distinct from baseline) then raise exception 'pricing_member_baseline_missing_or_divergent'; end if;
 insert into public.pricing_operations(id,evaluation_id,produto_id,group_id,group_version,source,actor_id,reason,rule_id,job_id,item_id,previous_price_cents,new_price_cents)
 values(p_id,p_evaluation_id,evaluation.produto_id,p_group_id,p_group_version,p_source,p_actor_id,p_reason,p_rule_id,p_job_id,p_item_id,baseline,p_price_cents);
 return p_id;
end $$;

create or replace function public.transition_pricing_operation(p_id uuid,p_state text,p_evidence jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype; observed timestamptz;
begin
 select * into op from public.pricing_operations where id=p_id for update;
 if op.id is null then raise exception 'pricing_operation_missing'; end if;
 if op.state=p_state then return jsonb_build_object('applied',false,'state',op.state); end if;
 if not ((op.state='prepared' and p_state in ('requested','failed')) or (op.state='requested' and p_state in ('confirmed','failed','inconclusive')) or (op.state='inconclusive' and p_state in ('confirmed','failed'))) then raise exception 'invalid_pricing_transition'; end if;
 if p_state in ('requested','confirmed') and not exists(select 1 from public.ml_pricing_groups where id=op.group_id and current_version=op.group_version and state='verified') then raise exception 'pricing_group_changed'; end if;
 if p_state='failed' and op.state in ('requested','inconclusive') then
   observed:=(p_evidence->>'observed_at')::timestamptz;
   if p_evidence->>'outcome' is distinct from 'no_effect_verified' or p_evidence->>'item_id' is distinct from op.item_id
     or (p_evidence->>'price_cents')::bigint is distinct from op.previous_price_cents or observed is null or observed<op.requested_at or observed>clock_timestamp()+interval '1 minute'
     or nullif(p_evidence->>'reference','') is null then raise exception 'pricing_no_effect_evidence_required'; end if;
   if exists(select 1 from public.ml_pricing_group_members m where m.group_id=op.group_id and m.version=op.group_version and not exists(select 1 from jsonb_array_elements(coalesce(p_evidence->'members','[]')) e where e->>'item_id'=m.ml_item_id and coalesce(e->>'variation_id','')=m.variation_id and (e->>'price_cents')::bigint=op.previous_price_cents)) then raise exception 'pricing_member_unconfirmed'; end if;
 end if;
 if p_state='requested' and exists(select 1 from public.ml_pricing_group_members m left join lateral (select new_price_cents from public.pricing_events e where e.item_id=m.ml_item_id and e.kind in ('observed','baseline') and e.pricing_source='mercado_livre' order by id desc limit 1) e on true where m.group_id=op.group_id and m.version=op.group_version and e.new_price_cents is distinct from op.previous_price_cents) then raise exception 'pricing_baseline_changed'; end if;
 if p_state='confirmed' then
   observed:=(p_evidence->>'observed_at')::timestamptz;
   if observed is null or observed<op.requested_at or observed>clock_timestamp()+interval '1 minute' or p_evidence->>'item_id' is distinct from op.item_id
   or (p_evidence->>'price_cents')::bigint is distinct from op.new_price_cents or p_evidence->>'outcome' is distinct from 'readback_verified'
   or nullif(p_evidence->>'reference','') is null then raise exception 'pricing_confirmation_missing'; end if;
   if exists(select 1 from public.ml_pricing_group_members m where m.group_id=op.group_id and m.version=op.group_version and not exists(select 1 from jsonb_array_elements(coalesce(p_evidence->'members','[]')) e where e->>'item_id'=m.ml_item_id and coalesce(e->>'variation_id','')=m.variation_id and (e->>'price_cents')::bigint=op.new_price_cents)) then raise exception 'pricing_member_unconfirmed'; end if;
 end if;
 update public.pricing_operations set state=p_state,requested_at=case when p_state='requested' then clock_timestamp() else requested_at end where id=p_id;
 insert into public.pricing_events(produto_id,item_id,group_id,group_version,operation_id,evaluation_id,kind,pricing_source,actor_id,reason,rule_id,job_id,previous_price_cents,new_price_cents,observed_at,evidence)
 values(op.produto_id,op.item_id,op.group_id,op.group_version,op.id,op.evaluation_id,p_state,op.source,op.actor_id,op.reason,op.rule_id,op.job_id,op.previous_price_cents,op.new_price_cents,observed,
 jsonb_strip_nulls(jsonb_build_object('reference',left(p_evidence->>'reference',200),'outcome',case when p_state='confirmed' then 'readback_verified' when p_state='failed' and op.state in ('requested','inconclusive') then 'no_effect_verified' else null end)));
 if p_state='confirmed' then
   insert into public.pricing_events(produto_id,item_id,group_id,group_version,operation_id,evaluation_id,kind,pricing_source,actor_id,reason,previous_price_cents,new_price_cents,observed_at)
   select op.produto_id,m.ml_item_id,op.group_id,op.group_version,op.id,op.evaluation_id,'confirmed','catalog_sync',null,'verified_catalog_propagation',null,op.new_price_cents,observed
   from public.ml_pricing_group_members m join public.ml_pricing_group_revisions r on r.group_id=m.group_id and r.version=m.version
   where m.group_id=op.group_id and m.version=op.group_version and m.ml_item_id<>op.item_id and r.catalog_synchronized_pair;
 end if;
 return jsonb_build_object('applied',true,'state',p_state);
end $$;
