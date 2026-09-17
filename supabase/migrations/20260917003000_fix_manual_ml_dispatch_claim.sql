set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Qualifique o campo result: a variável PL/pgSQL de mesmo nome impedia o claim.
create or replace function public.claim_manual_ml_dispatch(p_operation_id uuid,p_fresh_evaluation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype; old_context jsonb; fresh public.pricing_evaluations%rowtype;
 c jsonb; transition_result jsonb;
begin
 select * into op from public.pricing_operations where id=p_operation_id;
 if op.id is null then raise exception 'manual_command_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||op.seller_id,0));
 select * into op from public.pricing_operations where id=p_operation_id for update;
 if op.state<>'prepared' then return false; end if;
 select evaluation.result->'decisionContext' into old_context
   from public.pricing_evaluations evaluation where evaluation.id=op.evaluation_id;
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
 transition_result:=public.transition_pricing_operation(op.id,'requested','{}');
 return (transition_result->>'applied')::boolean;
end $$;

revoke all on function public.claim_manual_ml_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_manual_ml_dispatch(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
