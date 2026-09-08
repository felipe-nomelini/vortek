-- PUB-GATE marco 1: atomically claim an approved intent immediately before HTTP.
-- No remote call or new scheduler in this transaction. Runtime remains test-only/disabled.
create function public.claim_pricing_decision_dispatch(p_operation_id uuid,p_fresh_evaluation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype; d public.pricing_decisions%rowtype;
 e public.pricing_evaluations%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(
   select g.seller_id::text from public.pricing_operations o join public.ml_pricing_groups g on g.id=o.group_id
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
 result:=public.transition_pricing_operation(op.id,'requested','{}');
 return (result->>'applied')::boolean;
end $$;
revoke all on function public.claim_pricing_decision_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_pricing_decision_dispatch(uuid,uuid) to service_role;
