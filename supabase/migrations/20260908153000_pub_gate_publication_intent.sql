-- A creation has no remote item/group before the provider returns its identity.
alter table public.pricing_operations add column operation_kind text not null default 'price_change'
 check(operation_kind in ('price_change','listing_create'));
alter table public.pricing_operations add column seller_id text;
alter table public.pricing_operations alter column group_id drop not null;
alter table public.pricing_operations alter column group_version drop not null;
alter table public.pricing_operations alter column item_id drop not null;
alter table public.pricing_operations add constraint pricing_operation_target check(
 (operation_kind='price_change' and group_id is not null and group_version is not null and item_id is not null)
 or (operation_kind='listing_create' and seller_id is not null and seller_id ~ '^[0-9]+$'
   and previous_price_cents is null and clearance_id is null
   and ((group_id is null and group_version is null) or (state='confirmed' and group_id is not null and group_version is not null))
   and (item_id is null or item_id ~ '^MLB[0-9]+$') and (state<>'confirmed' or item_id is not null)));
create unique index pricing_creation_in_flight on public.pricing_operations(seller_id,produto_id)
 where operation_kind='listing_create' and state in ('prepared','requested','inconclusive');
alter table public.pricing_alerts alter column item_id drop not null;
alter table public.pricing_alerts add constraint pricing_alert_subject_target check(item_id is not null or subject_key='product:'||produto_id::text);
alter table public.anuncios_ml_outbox alter column ml_item_id drop not null;
alter table public.anuncios_ml_outbox add constraint pricing_outbox_target check(ml_item_id is not null or (pricing_operation_id is not null and source='pricing_decision'));

-- Reused at preparation, approval, consumption and dispatch. Evaluations are immutable and server-only.
create function public.assert_publication_evaluation(p_evaluation_id uuid,p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; c jsonb; memory jsonb;
begin
 select * into e from public.pricing_evaluations where id=p_evaluation_id;
 c:=e.result->'decisionContext'; memory:=e.result#>'{current,memory}';
 if e.id is null or e.actor_id is distinct from p_actor_id or e.created_at<clock_timestamp()-interval '15 minutes'
   or not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente'))
   or c->>'operationKind' is distinct from 'listing_create' or c->>'executable' is distinct from 'true'
   or c->>'sellerId' is null or c->>'sellerId' !~ '^[0-9]+$'
   or c->>'itemId' is not null or c->>'groupId' is not null or c->>'groupVersion' is not null
   or c->>'previousPriceCents' is not null or c->>'clearance' is not null
   or c->>'expiresAt' is null or (c->>'expiresAt')::timestamptz<=clock_timestamp()
   or jsonb_typeof(c#>'{preparation,payload}') is distinct from 'object'
   or e.result#>>'{revalidation,status}' is distinct from 'queried'
   or memory->>'revenueCents' is null or (memory->>'revenueCents')::bigint is distinct from (c->>'priceCents')::bigint
   or (c->>'priceCents')::bigint<=0
   or round((c#>>'{preparation,payload,price}')::numeric*100)::bigint is distinct from (c->>'priceCents')::bigint
   or memory->>'margin' is null or memory#>>'{band,floor}' is null
   or (memory->>'margin')::numeric<(memory#>>'{band,floor}')::numeric
   or memory->>'resultCents' is null or (memory->>'resultCents')::bigint<0
   or c#>>'{preparation,payload,currency_id}' is distinct from 'BRL'
   or c#>>'{preparation,capacity}' is null or (c#>>'{preparation,capacity}')::integer<1
   or (c#>>'{preparation,payload,available_quantity}')::integer is distinct from (c#>>'{preparation,capacity}')::integer
   or not exists(select 1 from public.produtos where id=e.produto_id and ativo and ml_item_id is null)
   or exists(select 1 from public.ml_pricing_groups where produto_id=e.produto_id and state<>'retired')
   then raise exception 'publication_evaluation_invalid'; end if;
end $$;
revoke all on function public.assert_publication_evaluation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_publication_evaluation(uuid,uuid) to service_role;

-- Store remote ID immediately, before description, projections or other post-processing.
create function public.capture_pricing_created_item(p_operation_id uuid,p_item_id text,p_seller_id text) returns void
language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype;
begin
 select * into op from public.pricing_operations where id=p_operation_id for update;
 if op.id is null or op.operation_kind<>'listing_create' or op.state not in ('requested','inconclusive')
   or op.seller_id is distinct from p_seller_id or p_item_id is null or p_item_id !~ '^MLB[0-9]+$'
   then raise exception 'publication_capture_invalid'; end if;
 if op.item_id is not null then
   if op.item_id<>p_item_id then raise exception 'publication_remote_identity_conflict'; end if;
   return;
 end if;
 update public.pricing_operations set item_id=p_item_id where id=op.id;
 update public.anuncios_ml_outbox set ml_item_id=p_item_id,updated_at=clock_timestamp() where pricing_operation_id=op.id;
 insert into public.pricing_events(produto_id,item_id,operation_id,evaluation_id,kind,pricing_source,actor_id,reason,evidence)
 values(op.produto_id,p_item_id,op.id,op.evaluation_id,'requested',op.source,op.actor_id,'Identificador remoto de criação registrado',jsonb_build_object('remoteIdentityCaptured',true));
end $$;
revoke all on function public.capture_pricing_created_item(uuid,text,text) from public,anon,authenticated;
grant execute on function public.capture_pricing_created_item(uuid,text,text) to service_role;

create or replace function public.sync_pricing_alerts(p_evaluation_id uuid,p_observations jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; c jsonb; r jsonb; a public.pricing_alerts%rowtype;
 subject text; gid uuid; st text; kind text; merged public.pricing_alerts%rowtype;
begin
 select * into e from public.pricing_evaluations where id=p_evaluation_id;
 c:=e.result->'decisionContext'; gid:=(c->>'groupId')::uuid;
 if c is null or c->>'sellerId' is null or (c->>'itemId' is null and c->>'operationKind' is distinct from 'listing_create') or jsonb_typeof(p_observations)<>'array' then raise exception 'decision_evaluation_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(c->>'sellerId'),0));
 if gid is not null and not exists(select 1 from public.ml_pricing_groups where id=gid and produto_id=e.produto_id and seller_id::text=c->>'sellerId') then raise exception 'decision_group_mismatch'; end if;
 subject:=case when c->>'operationKind'='listing_create' then 'product:'||e.produto_id::text when gid is not null then 'group:'||gid::text else 'item:'||(c->>'itemId') end;
 for r in select value from jsonb_array_elements(p_observations) loop
   if r->>'rule' not in ('pricing_group','pricing_evidence','buy_box_economy','manual_proposal','pricing_operation')
      or r->>'severity' not in ('P0','P1','P2','INFO') or jsonb_typeof(r->'active')<>'boolean' then raise exception 'decision_observation_invalid'; end if;
   select * into a from public.pricing_alerts where seller_id=c->>'sellerId' and subject_key=subject and rule_id=r->>'rule' for update;
   if a.id is not null and a.observed_at>e.created_at then continue; end if;
   if a.id is null and not (r->>'active')::boolean then continue; end if;
   st:=case when (r->>'active')::boolean then 'open' else 'resolved' end;
   kind:=case when a.id is null then 'alert_opened' when a.state<>st then case when st='open' then 'alert_reopened' else 'alert_resolved' end
     when a.fingerprint is distinct from c->>'fingerprint' or a.severity<>r->>'severity' or a.reason<>r->>'reason' then 'alert_updated' else null end;
   if a.id is null then
     insert into public.pricing_alerts(produto_id,seller_id,subject_key,item_id,group_id,rule_id,severity,state,title,reason,evaluation_id,fingerprint,observed_at,last_seen_at)
     values(e.produto_id,c->>'sellerId',subject,c->>'itemId',gid,r->>'rule',r->>'severity',st,left(r->>'title',200),left(r->>'reason',500),e.id,c->>'fingerprint',e.created_at,clock_timestamp()) returning * into a;
   else
     update public.pricing_alerts set state=st,severity=r->>'severity',title=left(r->>'title',200),reason=left(r->>'reason',500),
       evaluation_id=e.id,fingerprint=c->>'fingerprint',observed_at=e.created_at,last_seen_at=clock_timestamp(),
       updated_at=case when kind is null then updated_at else clock_timestamp() end,resolved_at=case when st='resolved' then coalesce(resolved_at,clock_timestamp()) else null end where id=a.id;
   end if;
   if kind is not null then
     insert into public.pricing_events(produto_id,item_id,group_id,evaluation_id,alert_id,kind,pricing_source,reason,evidence)
     values(e.produto_id,c->>'itemId',gid,e.id,a.id,kind,'pricing_engine',r->>'reason',jsonb_build_object('severity',r->>'severity','state',st,'rule',r->>'rule'));
   end if;
   -- Preserve old item histories when a verified group consolidates a synchronized pair.
   if gid is not null then
     for merged in select old.* from public.pricing_alerts old where old.id<>a.id and old.seller_id=c->>'sellerId' and old.rule_id=r->>'rule'
       and old.merged_into is null and old.group_id is null and exists(select 1 from public.ml_pricing_group_members m join public.ml_pricing_groups g on g.id=m.group_id
       where g.id=gid and g.state='verified' and m.version=g.current_version and m.ml_item_id=old.item_id) for update loop
       update public.pricing_alerts set merged_into=a.id,state='resolved',resolved_at=clock_timestamp() where id=merged.id;
       insert into public.pricing_events(produto_id,alert_id,kind,pricing_source,reason,evidence)
       values(e.produto_id,merged.id,'alert_merged','pricing_engine','Grupo sincronizado confirmado',jsonb_build_object('canonicalAlertId',a.id));
     end loop;
   end if;
 end loop;
end $$;

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
 if c->>'operationKind'='listing_create' then
   perform public.assert_publication_evaluation(e.id,p_actor_id);
 else
 if not exists(select 1 from public.ml_pricing_groups where id=(c->>'groupId')::uuid and produto_id=e.produto_id and state='verified' and current_version=(c->>'groupVersion')::integer and seller_id::text=c->>'sellerId') then raise exception 'decision_group_changed'; end if;
 perform public.assert_pricing_governance_allows((c->>'groupId')::uuid,'manual',p_actor_id,(c#>>'{clearance,id}')::uuid,e.id,(c->>'priceCents')::bigint,c#>>'{clearance,fulfillmentSource}',(c#>>'{clearance,quantity}')::integer);
 end if;
 select id into a from public.pricing_alerts where seller_id=c->>'sellerId' and subject_key=(case when c->>'operationKind'='listing_create' then 'product:'||e.produto_id::text else 'group:'||(c->>'groupId') end) and rule_id='manual_proposal';
 select * into d from public.pricing_decisions where alert_id=a order by created_at desc,id desc limit 1 for update;
 if d.id is not null and d.fingerprint=c->>'fingerprint' and (d.state='rejected' or (d.state in ('pending','deferred','approved') and d.expires_at>clock_timestamp())) then
   insert into public.pricing_events(produto_id,alert_id,decision_id,command_id,kind,pricing_source,actor_id,reason,evidence)
   values(e.produto_id,a,d.id,p_command_id,'decision_created','manual',p_actor_id,'Proposta existente preservada',jsonb_build_object('command',cmd));
   return d.id;
 end if;
 perform public.sync_pricing_alerts(e.id,jsonb_build_array(jsonb_build_object('rule','manual_proposal','severity','P1','active',true,'title','Proposta de preço aguardando decisão','reason',p_reason)));
 select id into a from public.pricing_alerts where seller_id=c->>'sellerId' and subject_key=(case when c->>'operationKind'='listing_create' then 'product:'||e.produto_id::text else 'group:'||(c->>'groupId') end) and rule_id='manual_proposal';
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

create or replace function public.manage_pricing_decision(p_id uuid,p_command_id uuid,p_actor_id uuid,p_action text,p_reason text,p_fresh_evaluation_id uuid default null,p_deferred_until timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.pricing_decisions%rowtype; e public.pricing_evaluations%rowtype; prior public.pricing_events%rowtype; cmd jsonb; st text;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'decision_permission_denied'; end if;
 if p_command_id is null or p_action not in ('approve','reject','defer') or p_action is null or p_reason is null or length(trim(p_reason)) not between 1 and 200 then raise exception 'decision_invalid_command'; end if;
 cmd:=jsonb_build_object('decisionId',p_id,'actorId',p_actor_id,'action',p_action,'reason',p_reason,'deferredUntil',p_deferred_until);
 perform pg_advisory_xact_lock(hashtextextended('pricing-decision-command:'||p_command_id::text,0));
 select * into prior from public.pricing_events where command_id=p_command_id;
 if prior.id is not null then
   if prior.evidence->'command' is distinct from cmd then raise exception 'decision_idempotency_conflict'; end if;
   return jsonb_build_object('state',prior.evidence->>'state','replayed',true,'executionBlocked',true);
 end if;
 select * into d from public.pricing_decisions where id=p_id;
 if d.id is null then raise exception 'decision_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(d.context->>'sellerId'),0));
 select * into d from public.pricing_decisions where id=p_id for update;
 if d.operation_id is not null or d.state not in ('pending','deferred') then raise exception 'decision_state_conflict'; end if;
 if p_action='defer' and (p_deferred_until is null or p_deferred_until<=clock_timestamp()) then raise exception 'decision_invalid_deferral'; end if;
 if d.expires_at<=clock_timestamp() and p_action='approve' then st:='expired';
 elsif p_action='approve' then
   select * into e from public.pricing_evaluations where id=p_fresh_evaluation_id;
   if e.id is null or e.actor_id is distinct from p_actor_id or e.created_at<clock_timestamp()-interval '15 minutes' then raise exception 'decision_evaluation_invalid'; end if;
   if e.result#>>'{decisionContext,fingerprint}' is distinct from d.fingerprint or e.result#>>'{decisionContext,executable}' is distinct from 'true'
     or (d.context->>'operationKind' is distinct from 'listing_create' and not exists(select 1 from public.ml_pricing_groups where id=(d.context->>'groupId')::uuid and state='verified' and current_version=(d.context->>'groupVersion')::integer))
     then st:='invalidated';
   else
     if d.context->>'operationKind'='listing_create' then
       perform public.assert_publication_evaluation(e.id,p_actor_id);
     else
     perform public.assert_pricing_governance_allows((d.context->>'groupId')::uuid,'manual',p_actor_id,(d.context#>>'{clearance,id}')::uuid,e.id,(d.context->>'priceCents')::bigint,d.context#>>'{clearance,fulfillmentSource}',(d.context#>>'{clearance,quantity}')::integer);
     end if;
     st:='approved';
   end if;
 else st:=case p_action when 'reject' then 'rejected' else 'deferred' end; end if;
 update public.pricing_decisions set state=st,decided_at=clock_timestamp(),updated_at=clock_timestamp(),deferred_until=case when st='deferred' then p_deferred_until else null end where id=d.id;
 insert into public.pricing_events(produto_id,group_id,item_id,evaluation_id,alert_id,decision_id,command_id,kind,pricing_source,actor_id,reason,evidence)
 select a.produto_id,a.group_id,d.context->>'itemId',coalesce(e.id,d.evaluation_id),d.alert_id,d.id,p_command_id,'decision_'||st,'manual',p_actor_id,p_reason,jsonb_build_object('command',cmd,'state',st,'executionBlocked',true) from public.pricing_alerts a where a.id=d.alert_id;
 return jsonb_build_object('state',st,'replayed',false,'executionBlocked',true);
end $$;

create or replace function public.consume_pricing_decision(p_id uuid,p_operation_id uuid,p_actor_id uuid,p_fresh_evaluation_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.pricing_decisions%rowtype; e public.pricing_evaluations%rowtype; oid uuid; c jsonb; approver uuid;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'decision_permission_denied'; end if;
 select * into d from public.pricing_decisions where id=p_id;
 if d.id is null or p_operation_id is null then raise exception 'decision_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(d.context->>'sellerId'),0));
 select * into d from public.pricing_decisions where id=p_id for update; c:=d.context;
 select actor_id into approver from public.pricing_events where decision_id=d.id and kind='decision_approved' order by id desc limit 1;
 if approver is distinct from p_actor_id then raise exception 'decision_permission_denied'; end if;
 if d.operation_id is not null then
   if d.operation_id<>p_operation_id then raise exception 'decision_already_consumed'; end if;
   select id into oid from public.anuncios_ml_outbox where pricing_operation_id=d.operation_id; return oid;
 end if;
 select * into e from public.pricing_evaluations where id=p_fresh_evaluation_id;
 if d.state<>'approved' or d.expires_at<=clock_timestamp() then raise exception 'decision_not_approved'; end if;
 if e.id is null or e.actor_id is distinct from p_actor_id or e.created_at<clock_timestamp()-interval '15 minutes'
   or e.result#>>'{decisionContext,fingerprint}' is distinct from d.fingerprint or e.result#>>'{decisionContext,executable}' is distinct from 'true' then raise exception 'decision_evaluation_invalid'; end if;
 if c->>'operationKind'='listing_create' then
   perform public.assert_publication_evaluation(e.id,p_actor_id);
   insert into public.pricing_operations(id,evaluation_id,produto_id,operation_kind,seller_id,source,actor_id,reason,rule_id,new_price_cents)
   values(p_operation_id,e.id,e.produto_id,'listing_create',c->>'sellerId','manual',p_actor_id,d.reason,'PUB-GATE',(c->>'priceCents')::bigint);
 else
 perform public.prepare_pricing_operation(p_operation_id,e.id,(c->>'groupId')::uuid,(c->>'groupVersion')::integer,c->>'itemId',(c->>'priceCents')::bigint,'manual',p_actor_id,d.reason,'V2-13',null,
   (c#>>'{clearance,id}')::uuid,c#>>'{clearance,fulfillmentSource}',(c#>>'{clearance,quantity}')::integer);
 end if;
 insert into public.anuncios_ml_outbox(produto_id,ml_item_id,desired_price,source,payload,pricing_operation_id)
 values(e.produto_id,c->>'itemId',(c->>'priceCents')::numeric/100,'pricing_decision',jsonb_build_object('apply_price',true,'apply_quantity',false,'apply_status',false,'decision_id',d.id),p_operation_id) returning id into oid;
 update public.pricing_decisions set operation_id=p_operation_id,updated_at=clock_timestamp() where id=d.id;
 insert into public.pricing_events(produto_id,group_id,decision_id,alert_id,operation_id,evaluation_id,kind,pricing_source,actor_id,reason)
 values(e.produto_id,(c->>'groupId')::uuid,d.id,d.alert_id,p_operation_id,e.id,'decision_consumed','manual',p_actor_id,d.reason);
 return oid;
end $$;

create or replace function public.claim_pricing_decision_dispatch(p_operation_id uuid,p_fresh_evaluation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype; d public.pricing_decisions%rowtype;
 e public.pricing_evaluations%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(
   select coalesce(o.seller_id,g.seller_id::text) from public.pricing_operations o left join public.ml_pricing_groups g on g.id=o.group_id
   where o.id=p_operation_id),0));
 select * into op from public.pricing_operations where id=p_operation_id for update;
 if op.id is null then raise exception 'pricing_operation_missing'; end if;
 -- A repeated delivery may reconcile, never repeat the remote command.
 if op.state<>'prepared' then return false; end if;
 select * into d from public.pricing_decisions where operation_id=op.id for update;
 select * into e from public.pricing_evaluations where id=p_fresh_evaluation_id;
 if d.id is null or d.state<>'approved' or d.expires_at<=clock_timestamp()
   or not exists(select 1 from public.profiles where id=op.actor_id and cargo in ('admin','gerente'))
   or not exists(select 1 from public.anuncios_ml_outbox where pricing_operation_id=op.id
     and source='pricing_decision' and status in ('pending','retry','processing'))
   then raise exception 'decision_not_approved'; end if;
 if e.id is null or e.produto_id<>op.produto_id or e.actor_id is distinct from op.actor_id
   or e.created_at<clock_timestamp()-interval '1 minute'
   or e.result#>>'{decisionContext,fingerprint}' is distinct from d.fingerprint
   or e.result#>>'{decisionContext,executable}' is distinct from 'true'
   or e.result#>>'{decisionContext,expiresAt}' is null
   or (e.result#>>'{decisionContext,expiresAt}')::timestamptz<=clock_timestamp()
   or (e.result#>>'{decisionContext,previousPriceCents}')::bigint is distinct from op.previous_price_cents
   or (e.result#>>'{decisionContext,priceCents}')::bigint is distinct from op.new_price_cents
   then raise exception 'decision_evaluation_invalid'; end if;
 if op.operation_kind='listing_create' then perform public.assert_publication_evaluation(e.id,op.actor_id); end if;
 result:=public.transition_pricing_operation(op.id,'requested','{}');
 return (result->>'applied')::boolean;
end $$;

create or replace function public.transition_pricing_operation(p_id uuid,p_state text,p_evidence jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype; observed timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(select coalesce(o.seller_id,g.seller_id::text) from public.pricing_operations o left join public.ml_pricing_groups g on g.id=o.group_id where o.id=p_id),0));
 select * into op from public.pricing_operations where id=p_id for update;
 if op.id is null then raise exception 'pricing_operation_missing'; end if;
 if op.state=p_state then return jsonb_build_object('applied',false,'state',op.state); end if;
 if not ((op.state='prepared' and p_state in ('requested','failed')) or (op.state='requested' and p_state in ('confirmed','failed','inconclusive')) or (op.state='inconclusive' and p_state in ('confirmed','failed'))) then raise exception 'invalid_pricing_transition'; end if;
 if op.operation_kind='listing_create' then
   if p_state='requested' then perform public.assert_publication_evaluation(op.evaluation_id,op.actor_id); end if;
   if p_state='failed' and op.state<>'prepared' then raise exception 'publication_effect_inconclusive'; end if;
   if p_state='confirmed' then
     observed:=(p_evidence->>'observed_at')::timestamptz;
     if op.item_id is null or observed is null or observed<op.requested_at or observed>clock_timestamp()+interval '1 minute'
       or p_evidence->>'item_id' is distinct from op.item_id or p_evidence->>'seller_id' is distinct from op.seller_id
       or (p_evidence->>'price_cents')::bigint is distinct from op.new_price_cents
       or p_evidence->>'outcome' is distinct from 'readback_verified'
       or p_evidence->>'listing_verified' is distinct from 'true' then raise exception 'publication_confirmation_missing'; end if;
     select g.id,g.current_version into op.group_id,op.group_version from public.ml_pricing_groups g
       join public.ml_pricing_group_members m on m.group_id=g.id and m.version=g.current_version and m.is_current
       where g.produto_id=op.produto_id and g.seller_id::text=op.seller_id and g.state='verified' and m.ml_item_id=op.item_id;
     if op.group_id is null then raise exception 'publication_group_unconfirmed'; end if;
   end if;
   update public.pricing_operations set state=p_state,group_id=op.group_id,group_version=op.group_version,
     requested_at=case when p_state='requested' then clock_timestamp() else requested_at end where id=op.id;
   insert into public.pricing_events(produto_id,item_id,group_id,group_version,operation_id,evaluation_id,kind,pricing_source,actor_id,reason,new_price_cents,observed_at,evidence)
   values(op.produto_id,op.item_id,op.group_id,op.group_version,op.id,op.evaluation_id,p_state,op.source,op.actor_id,op.reason,op.new_price_cents,observed,
     jsonb_build_object('outcome',case when p_state='confirmed' then 'readback_verified' else null end));
   return jsonb_build_object('applied',true,'state',p_state);
 end if;
 if p_state in ('requested','confirmed') and not exists(select 1 from public.ml_pricing_groups where id=op.group_id and current_version=op.group_version and state='verified') then raise exception 'pricing_group_changed'; end if;
 if p_state='failed' and op.state in ('requested','inconclusive') then
   observed:=(p_evidence->>'observed_at')::timestamptz;
   if p_evidence->>'outcome' is distinct from 'no_effect_verified' or p_evidence->>'item_id' is distinct from op.item_id
     or (p_evidence->>'price_cents')::bigint is distinct from op.previous_price_cents or observed is null or observed<op.requested_at or observed>clock_timestamp()+interval '1 minute'
     or nullif(p_evidence->>'reference','') is null then raise exception 'pricing_no_effect_evidence_required'; end if;
   if exists(select 1 from public.ml_pricing_group_members m where m.group_id=op.group_id and m.version=op.group_version and not exists(select 1 from jsonb_array_elements(coalesce(p_evidence->'members','[]')) e where e->>'item_id'=m.ml_item_id and coalesce(e->>'variation_id','')=m.variation_id and (e->>'price_cents')::bigint=op.previous_price_cents)) then raise exception 'pricing_member_unconfirmed'; end if;
 end if;
 if p_state='requested' then perform public.assert_pricing_governance_allows(op.group_id,op.source,op.actor_id,op.clearance_id,op.evaluation_id,op.new_price_cents,op.fulfillment_source,op.clearance_quantity); end if;
 if p_state='requested' and exists(select 1 from public.ml_pricing_group_members m left join lateral (select new_price_cents from public.pricing_events e where e.item_id=m.ml_item_id and e.kind in ('observed','baseline') and e.pricing_source='mercado_livre' order by id desc limit 1) e on true where m.group_id=op.group_id and m.version=op.group_version and e.new_price_cents is distinct from op.previous_price_cents) then raise exception 'pricing_baseline_changed'; end if;
 if p_state='confirmed' then
   observed:=(p_evidence->>'observed_at')::timestamptz;
   if observed is null or observed<op.requested_at or observed>clock_timestamp()+interval '1 minute' or p_evidence->>'item_id' is distinct from op.item_id
   or (p_evidence->>'price_cents')::bigint is distinct from op.new_price_cents or p_evidence->>'outcome' is distinct from 'readback_verified'
   or nullif(p_evidence->>'reference','') is null then raise exception 'pricing_confirmation_missing'; end if;
   if exists(select 1 from public.ml_pricing_group_members m where m.group_id=op.group_id and m.version=op.group_version and not exists(select 1 from jsonb_array_elements(coalesce(p_evidence->'members','[]')) e where e->>'item_id'=m.ml_item_id and coalesce(e->>'variation_id','')=m.variation_id and (e->>'price_cents')::bigint=op.new_price_cents)) then raise exception 'pricing_member_unconfirmed'; end if;
 end if;
 update public.pricing_operations set state=p_state,requested_at=case when p_state='requested' then clock_timestamp() else requested_at end where id=p_id;
 insert into public.pricing_events(produto_id,item_id,group_id,group_version,operation_id,evaluation_id,clearance_id,kind,pricing_source,actor_id,reason,rule_id,job_id,previous_price_cents,new_price_cents,observed_at,evidence)
 values(op.produto_id,op.item_id,op.group_id,op.group_version,op.id,op.evaluation_id,op.clearance_id,p_state,op.source,op.actor_id,op.reason,op.rule_id,op.job_id,op.previous_price_cents,op.new_price_cents,observed,
 jsonb_strip_nulls(jsonb_build_object('reference',left(p_evidence->>'reference',200),'outcome',case when p_state='confirmed' then 'readback_verified' when p_state='failed' and op.state in ('requested','inconclusive') then 'no_effect_verified' else null end)));
 if p_state='confirmed' then
   insert into public.pricing_events(produto_id,item_id,group_id,group_version,operation_id,evaluation_id,clearance_id,kind,pricing_source,actor_id,reason,previous_price_cents,new_price_cents,observed_at)
   select op.produto_id,m.ml_item_id,op.group_id,op.group_version,op.id,op.evaluation_id,op.clearance_id,'confirmed','catalog_sync',null,'verified_catalog_propagation',null,op.new_price_cents,observed
   from public.ml_pricing_group_members m join public.ml_pricing_group_revisions r on r.group_id=m.group_id and r.version=m.version
   where m.group_id=op.group_id and m.version=op.group_version and m.ml_item_id<>op.item_id and r.catalog_synchronized_pair;
 end if;
 return jsonb_build_object('applied',true,'state',p_state);
end $$;
