begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.ui_read_model_state
  add column build_context_fingerprint text,
  add column build_context jsonb;

create or replace function public.enqueue_ui_read_model(
  p_entity_kind text,
  p_entity_key text,
  p_reason text default 'source_changed'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  model_state public.ui_read_model_state%rowtype;
  destination_generation integer;
begin
  if p_entity_kind not in ('product', 'listing') or nullif(trim(p_entity_key), '') is null then return; end if;
  select * into model_state from public.ui_read_model_state where scope='catalog_ui';
  destination_generation := case
    when model_state.status in ('requested','building') and model_state.target_generation<>model_state.active_generation
      then model_state.target_generation
    else model_state.active_generation
  end;
  if destination_generation <= 0 then return; end if;
  insert into public.ui_read_model_queue(scope,generation,entity_kind,entity_key,reasons)
  values ('catalog_ui',destination_generation,p_entity_kind,p_entity_key,array[p_reason])
  on conflict (scope,generation,entity_kind,entity_key) do update set
    version=public.ui_read_model_queue.version+1,
    reasons=array_append(public.ui_read_model_queue.reasons,p_reason),
    available_at=clock_timestamp(),
    queued_at=least(public.ui_read_model_queue.queued_at,clock_timestamp()),
    claim_token=null, claimed_at=null, last_error=null;
end;
$$;

create or replace function public.request_ui_read_model_rebuild(p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare model_state public.ui_read_model_state%rowtype; next_generation integer;
begin
  select * into model_state from public.ui_read_model_state where scope='catalog_ui' for update;
  next_generation := greatest(model_state.active_generation,model_state.target_generation)+1;
  delete from public.ui_read_model_queue where scope='catalog_ui';
  delete from public.ui_product_projection where generation<>model_state.active_generation;
  delete from public.ui_listing_projection where generation<>model_state.active_generation;
  update public.ui_read_model_state set target_generation=next_generation,status='requested',
    reason=coalesce(nullif(trim(p_reason),''),'global_change'),requested_at=clock_timestamp(),
    build_context_fingerprint=null,build_context=null,updated_at=clock_timestamp()
  where scope='catalog_ui';
  return next_generation;
end;
$$;

drop function public.seed_ui_read_model_rebuild();
create function public.seed_ui_read_model_rebuild(p_context_fingerprint text,p_context jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target integer; product_count integer; listing_count integer;
begin
  select target_generation into target from public.ui_read_model_state where scope='catalog_ui' for update;
  update public.ui_read_model_state set status='building',build_context_fingerprint=p_context_fingerprint,
    build_context=p_context,updated_at=clock_timestamp() where scope='catalog_ui';
  insert into public.ui_read_model_queue(scope,generation,entity_kind,entity_key,reasons)
  select 'catalog_ui',target,'product',product.id::text,array['generation_backfill'] from public.produtos product
  on conflict (scope,generation,entity_kind,entity_key) do nothing;
  get diagnostics product_count=row_count;
  insert into public.ui_read_model_queue(scope,generation,entity_kind,entity_key,reasons)
  select 'catalog_ui',target,'listing',listing.ml_item_id,array['generation_backfill'] from public.anuncios_ml listing
  on conflict (scope,generation,entity_kind,entity_key) do nothing;
  get diagnostics listing_count=row_count;
  return jsonb_build_object('generation',target,'productsQueued',product_count,'listingsQueued',listing_count);
end;
$$;

create or replace function public.claim_ui_read_model_batch(p_limit integer default 100)
returns table(entity_kind text,entity_key text,generation integer,version bigint,claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ui_read_model_queue queue set claim_token=null,claimed_at=null
  where queue.claim_token is not null and queue.claimed_at<clock_timestamp()-interval '5 minutes';
  return query
  with due as (
    select queue.scope,queue.generation,queue.entity_kind,queue.entity_key
    from public.ui_read_model_queue queue
    join public.ui_read_model_state state on state.scope=queue.scope
    where queue.scope='catalog_ui' and queue.claim_token is null and queue.available_at<=clock_timestamp()
      and queue.generation=case when state.status='building' then state.target_generation else state.active_generation end
    order by queue.queued_at,queue.entity_kind,queue.entity_key
    for update of queue skip locked
    limit least(greatest(coalesce(p_limit,100),1),250)
  )
  update public.ui_read_model_queue queue set claim_token=extensions.gen_random_uuid(),
    claimed_at=clock_timestamp(),attempts=queue.attempts+1
  from due where queue.scope=due.scope and queue.generation=due.generation
    and queue.entity_kind=due.entity_kind and queue.entity_key=due.entity_key
  returning queue.entity_kind,queue.entity_key,queue.generation,queue.version,queue.claim_token;
end;
$$;

create or replace function public.activate_ui_read_model_generation(
  p_generation integer,p_context_fingerprint text,p_context jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare pending bigint; projected_products bigint; projected_listings bigint; source_products bigint; source_listings bigint;
begin
  select count(*) into pending from public.ui_read_model_queue where scope='catalog_ui' and generation=p_generation;
  select count(*) into projected_products from public.ui_product_projection where generation=p_generation;
  select count(*) into projected_listings from public.ui_listing_projection where generation=p_generation;
  select count(*) into source_products from public.produtos;
  select count(*) into source_listings from public.anuncios_ml;
  if pending<>0 or projected_products<>source_products or projected_listings<>source_listings then
    raise exception 'ui_read_model_generation_incomplete pending=% products=%/% listings=%/%',
      pending,projected_products,source_products,projected_listings,source_listings;
  end if;
  update public.ui_read_model_state set active_generation=p_generation,target_generation=p_generation,status='ready',
    context_fingerprint=p_context_fingerprint,context=p_context,build_context_fingerprint=null,build_context=null,
    activated_at=clock_timestamp(),updated_at=clock_timestamp()
  where scope='catalog_ui' and target_generation=p_generation;
  if not found then raise exception 'ui_read_model_generation_not_target'; end if;
  delete from public.ui_product_projection where generation<>p_generation;
  delete from public.ui_listing_projection where generation<>p_generation;
  delete from public.ui_read_model_queue where generation<>p_generation;
  return jsonb_build_object('generation',p_generation,'products',projected_products,'listings',projected_listings);
end;
$$;

revoke all on function public.seed_ui_read_model_rebuild(text,jsonb) from public,anon,authenticated;
grant execute on function public.seed_ui_read_model_rebuild(text,jsonb) to service_role;

commit;
