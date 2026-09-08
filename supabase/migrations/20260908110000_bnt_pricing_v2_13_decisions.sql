-- V2-13. DEV only. No price writer or commercial gate is enabled here.
create table public.pricing_alerts (
 id uuid primary key default gen_random_uuid(), produto_id uuid not null references public.produtos(id),
 seller_id text not null, subject_key text not null, item_id text not null, group_id uuid references public.ml_pricing_groups(id),
 rule_id text not null check(rule_id in ('pricing_group','pricing_evidence','buy_box_economy','manual_proposal','pricing_operation')),
 severity text not null check(severity in ('P0','P1','P2','INFO')),
 state text not null check(state in ('open','resolved')), title text not null, reason text not null,
 evaluation_id uuid not null references public.pricing_evaluations(id), fingerprint text not null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 observed_at timestamptz not null, last_seen_at timestamptz not null, resolved_at timestamptz,
 merged_into uuid references public.pricing_alerts(id), check(merged_into is null or merged_into<>id),
 unique(seller_id,subject_key,rule_id)
);
create index pricing_alerts_open on public.pricing_alerts(state,severity,created_at,id) where merged_into is null;
create index pricing_alerts_product on public.pricing_alerts(produto_id,id);
create table public.pricing_decisions (
 id uuid primary key default gen_random_uuid(), alert_id uuid not null references public.pricing_alerts(id),
 evaluation_id uuid not null references public.pricing_evaluations(id),
 state text not null default 'pending' check(state in ('pending','approved','rejected','deferred','expired','invalidated')),
 actor_id uuid not null references public.profiles(id), reason text not null check(length(reason) between 1 and 200),
 context jsonb not null check(jsonb_typeof(context)='object'), fingerprint text not null,
 expires_at timestamptz not null, deferred_until timestamptz, decided_at timestamptz,
 operation_id uuid unique references public.pricing_operations(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index pricing_decisions_alert on public.pricing_decisions(alert_id,created_at desc,id);
alter table public.pricing_alerts add column latest_decision_id uuid references public.pricing_decisions(id);
create unique index pricing_decisions_pending on public.pricing_decisions(alert_id) where state in ('pending','deferred');
alter table public.pricing_events add column alert_id uuid references public.pricing_alerts(id);
alter table public.pricing_events add column decision_id uuid references public.pricing_decisions(id);
create index pricing_events_alert on public.pricing_events(alert_id,id);
create index pricing_events_decision on public.pricing_events(decision_id,id);
alter table public.pricing_events drop constraint pricing_events_kind_check;
alter table public.pricing_events add constraint pricing_events_kind_check check(kind in
 ('baseline','observed','projection_changed','requested','confirmed','failed','inconclusive','override_activated','override_revoked','override_propagated','clearance_activated','clearance_revoked','clearance_completed','clearance_transferred',
 'alert_opened','alert_updated','alert_resolved','alert_reopened','alert_merged','decision_created','decision_approved','decision_rejected','decision_deferred','decision_expired','decision_invalidated','decision_consumed'));

-- Only authoritative server evaluations may produce observations. Collection order is not event order.
create function public.sync_pricing_alerts(p_evaluation_id uuid,p_observations jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; c jsonb; r jsonb; a public.pricing_alerts%rowtype;
 subject text; gid uuid; st text; kind text; merged public.pricing_alerts%rowtype;
begin
 select * into e from public.pricing_evaluations where id=p_evaluation_id;
 c:=e.result->'decisionContext'; gid:=(c->>'groupId')::uuid;
 if c is null or c->>'sellerId' is null or c->>'itemId' is null or jsonb_typeof(p_observations)<>'array' then raise exception 'decision_evaluation_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(c->>'sellerId'),0));
 if gid is not null and not exists(select 1 from public.ml_pricing_groups where id=gid and produto_id=e.produto_id and seller_id::text=c->>'sellerId') then raise exception 'decision_group_mismatch'; end if;
 subject:=case when gid is not null then 'group:'||gid::text else 'item:'||(c->>'itemId') end;
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

create function public.prepare_pricing_decision(p_command_id uuid,p_evaluation_id uuid,p_actor_id uuid,p_reason text) returns uuid
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
 perform public.sync_pricing_alerts(e.id,jsonb_build_array(jsonb_build_object('rule','manual_proposal','severity','P1','active',true,'title','Proposta de preço aguardando decisão','reason',p_reason)));
 select id into a from public.pricing_alerts where seller_id=c->>'sellerId' and subject_key='group:'||(c->>'groupId') and rule_id='manual_proposal';
 select * into d from public.pricing_decisions where alert_id=a order by created_at desc,id desc limit 1 for update;
 if d.id is not null and d.fingerprint=c->>'fingerprint' and (d.state='rejected' or (d.state in ('pending','deferred','approved') and d.expires_at>clock_timestamp())) then
   insert into public.pricing_events(produto_id,alert_id,decision_id,command_id,kind,pricing_source,actor_id,reason,evidence)
   values(e.produto_id,a,d.id,p_command_id,'decision_created','manual',p_actor_id,'Proposta existente preservada',jsonb_build_object('command',cmd));
   return d.id;
 end if;
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

create function public.manage_pricing_decision(p_id uuid,p_command_id uuid,p_actor_id uuid,p_action text,p_reason text,p_fresh_evaluation_id uuid default null,p_deferred_until timestamptz default null) returns jsonb
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
     or not exists(select 1 from public.ml_pricing_groups where id=(d.context->>'groupId')::uuid and state='verified' and current_version=(d.context->>'groupVersion')::integer)
     then st:='invalidated';
   else
     perform public.assert_pricing_governance_allows((d.context->>'groupId')::uuid,'manual',p_actor_id,(d.context#>>'{clearance,id}')::uuid,e.id,(d.context->>'priceCents')::bigint,d.context#>>'{clearance,fulfillmentSource}',(d.context#>>'{clearance,quantity}')::integer);
     st:='approved';
   end if;
 else st:=case p_action when 'reject' then 'rejected' else 'deferred' end; end if;
 update public.pricing_decisions set state=st,decided_at=clock_timestamp(),updated_at=clock_timestamp(),deferred_until=case when st='deferred' then p_deferred_until else null end where id=d.id;
 insert into public.pricing_events(produto_id,group_id,item_id,evaluation_id,alert_id,decision_id,command_id,kind,pricing_source,actor_id,reason,evidence)
 select a.produto_id,a.group_id,d.context->>'itemId',coalesce(e.id,d.evaluation_id),d.alert_id,d.id,p_command_id,'decision_'||st,'manual',p_actor_id,p_reason,jsonb_build_object('command',cmd,'state',st,'executionBlocked',true) from public.pricing_alerts a where a.id=d.alert_id;
 return jsonb_build_object('state',st,'replayed',false,'executionBlocked',true);
end $$;

-- Contract for PUB-GATE. No runtime caller may consume while pricing_execution_not_ready is active.
alter table public.anuncios_ml_outbox add column pricing_operation_id uuid unique references public.pricing_operations(id);
create function public.consume_pricing_decision(p_id uuid,p_operation_id uuid,p_actor_id uuid,p_fresh_evaluation_id uuid) returns uuid
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
 perform public.prepare_pricing_operation(p_operation_id,e.id,(c->>'groupId')::uuid,(c->>'groupVersion')::integer,c->>'itemId',(c->>'priceCents')::bigint,'manual',p_actor_id,d.reason,'V2-13',null,
   (c#>>'{clearance,id}')::uuid,c#>>'{clearance,fulfillmentSource}',(c#>>'{clearance,quantity}')::integer);
 insert into public.anuncios_ml_outbox(produto_id,ml_item_id,desired_price,source,payload,pricing_operation_id)
 values(e.produto_id,c->>'itemId',(c->>'priceCents')::numeric/100,'pricing_decision',jsonb_build_object('apply_price',true,'apply_quantity',false,'apply_status',false,'decision_id',d.id),p_operation_id) returning id into oid;
 update public.pricing_decisions set operation_id=p_operation_id,updated_at=clock_timestamp() where id=d.id;
 insert into public.pricing_events(produto_id,group_id,decision_id,alert_id,operation_id,evaluation_id,kind,pricing_source,actor_id,reason)
 values(e.produto_id,(c->>'groupId')::uuid,d.id,d.alert_id,p_operation_id,e.id,'decision_consumed','manual',p_actor_id,d.reason);
 return oid;
end $$;
revoke all on function public.consume_pricing_decision(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.consume_pricing_decision(uuid,uuid,uuid,uuid) to service_role;

create function public.observe_pricing_operation_alert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.operation_id is not null and new.kind in ('failed','inconclusive','confirmed')
   and exists(select 1 from public.pricing_evaluations where id=new.evaluation_id and result ? 'decisionContext') then
   perform public.sync_pricing_alerts(new.evaluation_id,jsonb_build_array(jsonb_build_object('rule','pricing_operation','severity','P1','active',new.kind<>'confirmed',
     'title','Aplicação de preço requer conferência','reason',case when new.kind='confirmed' then 'Aplicação confirmada por leitura dos anúncios' else 'Não repetir a escrita. Verifique o resultado no item e nos membros do grupo.' end)));
 end if;
 return new;
end $$;
create trigger pricing_operation_alert after insert on public.pricing_events for each row execute function public.observe_pricing_operation_alert();
revoke all on function public.observe_pricing_operation_alert() from public,anon,authenticated;

alter table public.pricing_alerts enable row level security;
alter table public.pricing_decisions enable row level security;
revoke all on public.pricing_alerts,public.pricing_decisions from public,anon,authenticated,service_role;
grant select on public.pricing_alerts,public.pricing_decisions to service_role;
revoke all on function public.sync_pricing_alerts(uuid,jsonb),public.prepare_pricing_decision(uuid,uuid,uuid,text),public.manage_pricing_decision(uuid,uuid,uuid,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_pricing_alerts(uuid,jsonb),public.prepare_pricing_decision(uuid,uuid,uuid,text),public.manage_pricing_decision(uuid,uuid,uuid,text,text,uuid,timestamptz) to service_role;
