set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A avaliação é uma fotografia técnica. A decisão do operador é a própria operação.
create or replace function public.assert_publication_evaluation(p_evaluation_id uuid,p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; c jsonb; prep jsonb; expected jsonb;
begin
 select * into e from public.pricing_evaluations where id=p_evaluation_id;
 c:=e.result->'decisionContext'; prep:=c->'preparation'; expected:=prep->'expected';
 if e.id is null or e.actor_id is distinct from p_actor_id or e.created_at<clock_timestamp()-interval '15 minutes'
   or not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente'))
   or c->>'operationKind' is distinct from 'listing_create' or c->>'executable' is distinct from 'true'
   or c->>'sellerId' is null or c->>'sellerId' !~ '^[0-9]+$'
   or c->>'itemId' is not null or c->>'groupId' is not null or c->>'groupVersion' is not null
   or c->>'previousPriceCents' is not null or c->>'clearance' is not null
   or c->>'expiresAt' is null or (c->>'expiresAt')::timestamptz<=clock_timestamp()
   or jsonb_typeof(prep->'payload') is distinct from 'object'
   or jsonb_typeof(expected) is distinct from 'object'
   or prep->>'action' not in ('new','relist')
   or (prep->>'action'='new' and prep->>'sourceItemId' is not null)
   or (prep->>'action'='relist' and (prep->>'sourceItemId' is null or prep->>'sourceItemId' !~ '^MLB[0-9]+$'))
   or c->>'priceCents' is null or (c->>'priceCents')::bigint<=0
   or round((prep#>>'{payload,price}')::numeric*100)::bigint is distinct from (c->>'priceCents')::bigint
   or expected->>'currency_id' is distinct from 'BRL'
   or prep->>'capacity' is null or (prep->>'capacity')::integer<1
   or (expected->>'available_quantity')::integer is distinct from (prep->>'capacity')::integer
   or not exists(select 1 from public.produtos p where p.id=e.produto_id and p.ativo
     and ((prep->>'action'='new' and p.ml_item_id is null)
       or (prep->>'action'='relist' and p.ml_item_id=prep->>'sourceItemId')))
   or exists(select 1 from public.ml_pricing_groups g where g.produto_id=e.produto_id and g.state<>'retired'
     and (prep->>'action'='new' or not exists(select 1 from public.ml_pricing_group_members m
       where m.group_id=g.id and m.version=g.current_version and m.is_current and m.ml_item_id=prep->>'sourceItemId')
       or exists(select 1 from public.ml_pricing_group_members m where m.group_id=g.id
         and m.version=g.current_version and m.is_current and m.ml_item_id<>prep->>'sourceItemId')))
   then raise exception 'publication_evaluation_invalid'; end if;
end $$;

create function public.enqueue_manual_ml_command(p_operation_id uuid,p_evaluation_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; previous public.pricing_operations%rowtype;
 c jsonb; original jsonb; outbox_id uuid; reason text;
begin
 if p_operation_id is null or p_evaluation_id is null or p_actor_id is null then raise exception 'manual_command_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('manual-ml-command:'||p_operation_id::text,0));
 select * into e from public.pricing_evaluations where id=p_evaluation_id;
 c:=e.result->'decisionContext';
 select * into previous from public.pricing_operations where id=p_operation_id;
 if previous.id is not null then
   select result->'decisionContext' into original from public.pricing_evaluations where id=previous.evaluation_id;
   if previous.rule_id is distinct from 'MANUAL-ML' or previous.actor_id is distinct from p_actor_id
     or previous.produto_id is distinct from e.produto_id or previous.operation_kind is distinct from c->>'operationKind'
     or previous.new_price_cents is distinct from (c->>'priceCents')::bigint
     or previous.item_id is distinct from c->>'itemId'
     or original#>>'{preparation,action}' is distinct from c#>>'{preparation,action}'
     or original#>>'{preparation,sourceItemId}' is distinct from c#>>'{preparation,sourceItemId}'
     then raise exception 'manual_command_idempotency_conflict'; end if;
   select id into outbox_id from public.anuncios_ml_outbox where pricing_operation_id=p_operation_id;
   return outbox_id;
 end if;
 if e.id is null or e.actor_id is distinct from p_actor_id or c->>'executable' is distinct from 'true'
   or c->>'operationKind' not in ('price_change','listing_create') then raise exception 'manual_command_evaluation_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(c->>'sellerId'),0));
 if c->>'operationKind'='listing_create' then
   perform public.assert_publication_evaluation(e.id,p_actor_id);
   reason:='Publicação manual confirmada';
   insert into public.pricing_operations(id,evaluation_id,produto_id,operation_kind,seller_id,source,actor_id,reason,rule_id,new_price_cents)
   values(p_operation_id,e.id,e.produto_id,'listing_create',c->>'sellerId','manual',p_actor_id,reason,'MANUAL-ML',(c->>'priceCents')::bigint);
 else
   perform public.assert_manual_price_evaluation(e.id,p_actor_id);
   reason:='Alteração manual confirmada';
   perform public.prepare_pricing_operation(p_operation_id,e.id,(c->>'groupId')::uuid,(c->>'groupVersion')::integer,
     c->>'itemId',(c->>'priceCents')::bigint,'manual',p_actor_id,reason,'MANUAL-ML',null,
     (c#>>'{clearance,id}')::uuid,c#>>'{clearance,fulfillmentSource}',(c#>>'{clearance,quantity}')::integer);
 end if;
 insert into public.anuncios_ml_outbox(produto_id,ml_item_id,desired_price,source,payload,pricing_operation_id)
 values(e.produto_id,c->>'itemId',(c->>'priceCents')::numeric/100,'pricing_decision',
   jsonb_build_object('apply_price',true,'apply_quantity',false,'apply_status',false,'manual_command_id',p_operation_id,'target_origin','manual_input'),p_operation_id)
 returning id into outbox_id;
 return outbox_id;
end $$;

create function public.claim_manual_ml_dispatch(p_operation_id uuid,p_fresh_evaluation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype; old_context jsonb; fresh public.pricing_evaluations%rowtype; c jsonb; result jsonb;
begin
 select * into op from public.pricing_operations where id=p_operation_id;
 if op.id is null then raise exception 'manual_command_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||op.seller_id,0));
 select * into op from public.pricing_operations where id=p_operation_id for update;
 if op.state<>'prepared' then return false; end if;
 select result->'decisionContext' into old_context from public.pricing_evaluations where id=op.evaluation_id;
 select * into fresh from public.pricing_evaluations where id=p_fresh_evaluation_id;
 c:=fresh.result->'decisionContext';
 if op.rule_id is distinct from 'MANUAL-ML' or op.source is distinct from 'manual'
   or not exists(select 1 from public.profiles where id=op.actor_id and cargo in ('admin','gerente'))
   or not exists(select 1 from public.anuncios_ml_outbox where pricing_operation_id=op.id
     and status in ('pending','retry','processing'))
   or fresh.id is null or fresh.produto_id is distinct from op.produto_id or fresh.actor_id is distinct from op.actor_id
   or fresh.created_at<clock_timestamp()-interval '1 minute'
   or c->>'fingerprint' is distinct from old_context->>'fingerprint'
   or c->>'executable' is distinct from 'true'
   or c->>'expiresAt' is null or (c->>'expiresAt')::timestamptz<=clock_timestamp()
   or (c->>'previousPriceCents')::bigint is distinct from op.previous_price_cents
   or (c->>'priceCents')::bigint is distinct from op.new_price_cents
   then raise exception 'manual_command_revalidation_failed'; end if;
 if op.operation_kind='listing_create' then perform public.assert_publication_evaluation(fresh.id,op.actor_id); end if;
 update public.pricing_operations set evaluation_id=fresh.id where id=op.id;
 result:=public.transition_pricing_operation(op.id,'requested','{}');
 return (result->>'applied')::boolean;
end $$;

revoke all on function public.enqueue_manual_ml_command(uuid,uuid,uuid),public.claim_manual_ml_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_manual_ml_command(uuid,uuid,uuid),public.claim_manual_ml_dispatch(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
