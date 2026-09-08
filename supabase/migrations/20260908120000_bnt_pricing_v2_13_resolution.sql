-- Resolve only the current proposal, never an economic alert with another cause.
create or replace function public.observe_pricing_operation_alert() returns trigger
language plpgsql security definer set search_path='' as $$
declare did uuid; a public.pricing_alerts%rowtype;
begin
 if new.operation_id is not null and new.kind in ('failed','inconclusive','confirmed')
   and exists(select 1 from public.pricing_evaluations where id=new.evaluation_id and result ? 'decisionContext') then
   perform public.sync_pricing_alerts(new.evaluation_id,jsonb_build_array(jsonb_build_object('rule','pricing_operation','severity','P1','active',new.kind<>'confirmed',
     'title','Aplicação de preço requer conferência','reason',case when new.kind='confirmed' then 'Aplicação confirmada por leitura dos anúncios' else 'Não repetir a escrita. Verifique o resultado no item e nos membros do grupo.' end)));
 end if;
 if new.kind='decision_rejected' then did:=new.decision_id;
 elsif new.kind='confirmed' and new.operation_id is not null then
   select id into did from public.pricing_decisions where operation_id=new.operation_id;
 end if;
 if did is not null then
   select al.* into a from public.pricing_alerts al join public.pricing_decisions d on d.alert_id=al.id
     where d.id=did and al.latest_decision_id=did and al.rule_id='manual_proposal' for update of al;
   if a.id is not null and a.state='open' then
     update public.pricing_alerts set state='resolved',resolved_at=clock_timestamp(),updated_at=clock_timestamp() where id=a.id;
     insert into public.pricing_events(produto_id,alert_id,decision_id,operation_id,kind,pricing_source,actor_id,reason)
     values(a.produto_id,a.id,did,new.operation_id,'alert_resolved',new.pricing_source,new.actor_id,
       case when new.kind='decision_rejected' then 'Proposta rejeitada pelo responsável' else 'Aplicação da proposta confirmada por leitura' end);
   end if;
 end if;
 return new;
end $$;

-- Unchanged/rejected proposals must be deduplicated before reopening an alert.
create or replace function public.prepare_pricing_decision(p_command_id uuid,p_evaluation_id uuid,p_actor_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; c jsonb; a uuid; d public.pricing_decisions%rowtype; prior public.pricing_events%rowtype; cmd jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'decision_permission_denied'; end if;
 if p_command_id is null or p_reason is null or length(trim(p_reason)) not between 1 and 200 then raise exception 'decision_invalid_command'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pricing-decision-command:'||p_command_id::text,0));
 cmd:=jsonb_build_object('action','prepare','evaluationId',p_evaluation_id,'actorId',p_actor_id,'reason',p_reason);
 select * into prior from public.pricing_events where command_id=p_command_id;
 if prior.id is not null then
   if prior.evidence->'command' is distinct from cmd then raise exception 'decision_idempotency_conflict'; end if;
   return prior.decision_id;
 end if;
 select * into e from public.pricing_evaluations where id=p_evaluation_id; c:=e.result->'decisionContext';
 if c is null or e.actor_id is distinct from p_actor_id or e.created_at<clock_timestamp()-interval '15 minutes' or (c->>'executable')::boolean is distinct from true then raise exception 'decision_evaluation_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(c->>'sellerId'),0));
 if not exists(select 1 from public.ml_pricing_groups where id=(c->>'groupId')::uuid and produto_id=e.produto_id and state='verified' and current_version=(c->>'groupVersion')::integer and seller_id::text=c->>'sellerId') then raise exception 'decision_group_changed'; end if;
 perform public.assert_pricing_governance_allows((c->>'groupId')::uuid,'manual',p_actor_id,(c#>>'{clearance,id}')::uuid,e.id,(c->>'priceCents')::bigint,c#>>'{clearance,fulfillmentSource}',(c#>>'{clearance,quantity}')::integer);
 select id into a from public.pricing_alerts where seller_id=c->>'sellerId' and subject_key='group:'||(c->>'groupId') and rule_id='manual_proposal';
 select * into d from public.pricing_decisions where alert_id=a order by created_at desc,id desc limit 1 for update;
 if d.id is not null and d.fingerprint=c->>'fingerprint' and (d.state='rejected' or (d.state in ('pending','deferred','approved') and d.expires_at>clock_timestamp())) then
   insert into public.pricing_events(produto_id,alert_id,decision_id,command_id,kind,pricing_source,actor_id,reason,evidence)
   values(e.produto_id,a,d.id,p_command_id,'decision_created','manual',p_actor_id,'Proposta existente preservada',jsonb_build_object('command',cmd));
   return d.id;
 end if;
 perform public.sync_pricing_alerts(e.id,jsonb_build_array(jsonb_build_object('rule','manual_proposal','severity','P1','active',true,'title','Proposta de preço aguardando decisão','reason',p_reason)));
 select id into a from public.pricing_alerts where seller_id=c->>'sellerId' and subject_key='group:'||(c->>'groupId') and rule_id='manual_proposal';
 update public.pricing_decisions set state=case when expires_at<=clock_timestamp() then 'expired' else 'invalidated' end,updated_at=clock_timestamp() where alert_id=a and state in ('pending','deferred','approved') and operation_id is null;
 insert into public.pricing_events(produto_id,alert_id,decision_id,kind,pricing_source,actor_id,reason)
 select e.produto_id,a,id,case state when 'expired' then 'decision_expired' else 'decision_invalidated' end,'manual',p_actor_id,'Proposta substituída por nova avaliação' from public.pricing_decisions
 where alert_id=a and state in ('expired','invalidated') and not exists(select 1 from public.pricing_events ev where ev.decision_id=pricing_decisions.id and ev.kind in ('decision_expired','decision_invalidated'));
 insert into public.pricing_decisions(alert_id,evaluation_id,actor_id,reason,context,fingerprint,expires_at)
 values(a,e.id,p_actor_id,p_reason,c,c->>'fingerprint',least(e.created_at+interval '15 minutes',(c->>'expiresAt')::timestamptz)) returning * into d;
 update public.pricing_alerts set latest_decision_id=d.id where id=a;
 insert into public.pricing_events(produto_id,group_id,group_version,item_id,evaluation_id,alert_id,decision_id,command_id,kind,pricing_source,actor_id,reason,previous_price_cents,new_price_cents,evidence)
 values(e.produto_id,(c->>'groupId')::uuid,(c->>'groupVersion')::integer,c->>'itemId',e.id,a,d.id,p_command_id,'decision_created','manual',p_actor_id,p_reason,(c->>'previousPriceCents')::bigint,(c->>'priceCents')::bigint,jsonb_build_object('command',cmd));
 return d.id;
end $$;
