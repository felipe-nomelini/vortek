-- A republicação preserva o anúncio encerrado como origem até o novo ID ser
-- capturado. O mesmo gate econômico e de identidade continua obrigatório.
create or replace function public.assert_publication_evaluation(p_evaluation_id uuid,p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; c jsonb; memory jsonb; prep jsonb; expected jsonb;
begin
 select * into e from public.pricing_evaluations where id=p_evaluation_id;
 c:=e.result->'decisionContext'; memory:=e.result#>'{current,memory}'; prep:=c->'preparation';
 expected:=coalesce(prep->'expected',prep->'payload');
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
   or e.result#>>'{revalidation,status}' is distinct from 'queried'
   or memory->>'revenueCents' is null or (memory->>'revenueCents')::bigint is distinct from (c->>'priceCents')::bigint
   or (c->>'priceCents')::bigint<=0
   or round((prep#>>'{payload,price}')::numeric*100)::bigint is distinct from (c->>'priceCents')::bigint
   or memory->>'margin' is null or memory#>>'{band,floor}' is null
   or (memory->>'margin')::numeric<(memory#>>'{band,floor}')::numeric
   or memory->>'resultCents' is null or (memory->>'resultCents')::bigint<0
   or expected->>'currency_id' is distinct from 'BRL'
   or prep->>'capacity' is null or (prep->>'capacity')::integer<1
   or (expected->>'available_quantity')::integer is distinct from (prep->>'capacity')::integer
   or not exists(select 1 from public.produtos p where p.id=e.produto_id and p.ativo
     and ((prep->>'action'='new' and p.ml_item_id is null)
       or (prep->>'action'='relist' and p.ml_item_id=prep->>'sourceItemId')))
   or exists(
     select 1
     from public.ml_pricing_groups g
     where g.produto_id=e.produto_id
       and g.state<>'retired'
       and (
         prep->>'action'='new'
         or not exists(
           select 1
           from public.ml_pricing_group_members m
           where m.group_id=g.id
             and m.version=g.current_version
             and m.is_current
             and m.ml_item_id=prep->>'sourceItemId'
         )
         or exists(
           select 1
           from public.ml_pricing_group_members m
           where m.group_id=g.id
             and m.version=g.current_version
             and m.is_current
             and m.ml_item_id<>prep->>'sourceItemId'
         )
       )
   )
   then raise exception 'publication_evaluation_invalid'; end if;
end $$;
revoke all on function public.assert_publication_evaluation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_publication_evaluation(uuid,uuid) to service_role;
