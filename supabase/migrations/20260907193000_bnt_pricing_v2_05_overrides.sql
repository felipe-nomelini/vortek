-- V2-05: proteção por grupo até revogação humana. Não publica nem altera preços.
create table public.manual_pricing_overrides (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.ml_pricing_groups(id),
 group_version integer not null,
 foreign key(group_id,group_version) references public.ml_pricing_group_revisions(group_id,version),
 state text not null default 'active' check(state in ('active','revoked')),
 created_at timestamptz not null default clock_timestamp(),
 actor_id uuid, reason text not null check(length(btrim(reason)) between 1 and 200),
 origin text not null check(origin in ('manual','propagated')),
 revoked_at timestamptz, revoked_by uuid, revoke_reason text,
 check(origin<>'manual' or actor_id is not null),
 check((state='active' and revoked_at is null and revoked_by is null and revoke_reason is null)
   or (state='revoked' and revoked_at is not null and revoked_by is not null and length(btrim(revoke_reason)) between 1 and 200))
);
create unique index manual_pricing_override_active on public.manual_pricing_overrides(group_id) where state='active';
create index manual_pricing_override_history on public.manual_pricing_overrides(group_id,created_at desc);
alter table public.manual_pricing_overrides enable row level security;
revoke all on public.manual_pricing_overrides from public,anon,authenticated,service_role;
grant select on public.manual_pricing_overrides to service_role;
alter table public.pricing_events add column override_id uuid references public.manual_pricing_overrides(id);
alter table public.pricing_events add column command_id uuid;
create index pricing_events_override on public.pricing_events(override_id);
create unique index pricing_events_command on public.pricing_events(command_id) where command_id is not null;
alter table public.pricing_events drop constraint pricing_events_kind_check;
alter table public.pricing_events add constraint pricing_events_kind_check check(kind in
 ('baseline','observed','projection_changed','requested','confirmed','failed','inconclusive','override_activated','override_revoked','override_propagated'));

create function public.manage_manual_pricing_override(p_command_id uuid,p_product_id uuid,p_group_id uuid,p_group_version integer,p_action text,p_actor_id uuid,p_reason text,p_override_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare g public.ml_pricing_groups%rowtype; protection public.manual_pricing_overrides%rowtype;
 prior public.pricing_events%rowtype; command jsonb;
begin
 if p_command_id is null or p_actor_id is null or p_action is null or p_action not in ('activate','revoke')
   or p_reason is null or length(btrim(p_reason)) not between 1 and 200 then raise exception 'invalid_override_command'; end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'override_permission_denied'; end if;
 select * into g from public.ml_pricing_groups where id=p_group_id;
 if g.id is null or g.produto_id is distinct from p_product_id then raise exception 'override_group_mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||g.seller_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pricing-override-command:'||p_command_id::text,0));
 command:=jsonb_build_object('productId',p_product_id,'groupId',p_group_id,'groupVersion',p_group_version,'action',p_action,'actorId',p_actor_id,'reason',btrim(p_reason),'overrideId',p_override_id);
 select * into prior from public.pricing_events where command_id=p_command_id;
 if prior.id is not null then
   if prior.evidence->'command' is distinct from command then raise exception 'override_idempotency_conflict'; end if;
   return prior.override_id;
 end if;
 select * into g from public.ml_pricing_groups where id=p_group_id;
 if g.current_version is distinct from p_group_version then raise exception 'override_group_changed'; end if;
 select * into protection from public.manual_pricing_overrides where group_id=g.id and state='active';
 if p_action='activate' then
   if g.state<>'verified' then raise exception 'override_group_unverified'; end if;
   if p_override_id is not null or protection.id is not null then raise exception 'override_state_conflict'; end if;
   insert into public.manual_pricing_overrides(group_id,group_version,actor_id,reason,origin)
     values(g.id,g.current_version,p_actor_id,btrim(p_reason),'manual') returning * into protection;
 else
   if protection.id is null or protection.id is distinct from p_override_id then raise exception 'override_state_conflict'; end if;
   update public.manual_pricing_overrides set state='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_id,revoke_reason=btrim(p_reason) where id=protection.id;
 end if;
 insert into public.pricing_events(produto_id,group_id,group_version,override_id,command_id,kind,pricing_source,actor_id,reason,evidence)
 values(g.produto_id,g.id,g.current_version,protection.id,p_command_id,case when p_action='activate' then 'override_activated' else 'override_revoked' end,
   'manual',p_actor_id,btrim(p_reason),jsonb_build_object('command',command));
 return protection.id;
end $$;
revoke all on function public.manage_manual_pricing_override(uuid,uuid,uuid,integer,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.manage_manual_pricing_override(uuid,uuid,uuid,integer,text,uuid,text,uuid) to service_role;

-- Atualizações das funções existentes abaixo preservam assinaturas e grants.

create function public.assert_pricing_override_allows(p_group_id uuid,p_source text,p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_source='manual' then
   if not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'override_permission_denied'; end if;
 elsif exists(select 1 from public.manual_pricing_overrides where group_id=p_group_id and state='active') then raise exception 'manual_pricing_override_active';
 end if;
end $$;
revoke all on function public.assert_pricing_override_allows(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.assert_pricing_override_allows(uuid,text,uuid) to service_role;

create or replace function public.reconcile_ml_pricing_groups(
  p_seller_id bigint, p_product_id uuid, p_observed_at timestamptz, p_complete boolean, p_groups jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  entry jsonb; member jsonb; old_group public.ml_pricing_groups%rowtype;
  group_id uuid; next_version integer; fingerprint text; old_fingerprint text;
  protected_before jsonb; previous_members jsonb; origins uuid[]; protected_id uuid; target_group record;
  incoming jsonb; touched uuid[] := '{}'; predecessors uuid[]; result jsonb := '[]';
begin
  if p_seller_id is null or p_seller_id <= 0 or p_product_id is null or p_observed_at is null
    or p_observed_at > clock_timestamp() + interval '1 minute' or p_complete is null
    or jsonb_typeof(p_groups) is distinct from 'array' then raise exception 'invalid_group_observation'; end if;
  -- Curto e apenas local: nenhum HTTP dentro da transação. Serializa uniões entre produtos.
  perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:' || p_seller_id::text, 0));
  if exists(select 1 from public.ml_pricing_groups g where g.seller_id=p_seller_id and g.produto_id=p_product_id and g.observed_at > p_observed_at) then
    return jsonb_build_object('applied',false,'reason','older_observation');
  end if;
  -- Snapshot da composição imediatamente anterior, nunca de membros históricos arbitrários.
  select coalesce(jsonb_agg(jsonb_build_object('groupId',m.group_id,'itemId',m.ml_item_id,'variationId',m.variation_id,'overrideId',o.id)),'[]') into protected_before
    from public.ml_pricing_group_members m join public.ml_pricing_groups g on g.id=m.group_id
    join public.manual_pricing_overrides o on o.group_id=g.id and o.state='active'
    where m.is_current and g.seller_id=p_seller_id and g.produto_id=p_product_id;
  select coalesce(jsonb_agg(jsonb_build_object('groupId',m.group_id,'itemId',m.ml_item_id,'variationId',m.variation_id)),'[]') into previous_members
    from public.ml_pricing_group_members m join public.ml_pricing_groups g on g.id=m.group_id
    where m.is_current and g.seller_id=p_seller_id and g.produto_id=p_product_id;
  if not p_complete then
    -- Falha não dissolve grupos nem inventa novos membros. Registra invalidação do estado atual.
    select coalesce(jsonb_agg(jsonb_build_object(
      'anchorItemId',g.anchor_item_id,'anchorVariationId',g.anchor_variation_id,'state','unverified','synchronized',false,
      'reasons',jsonb_build_array('REVALIDATION_INCOMPLETE'),'evidence','[]'::jsonb,
      'members',(select coalesce(jsonb_agg(jsonb_build_object('itemId',m.ml_item_id,'variationId',m.variation_id,'catalog',m.catalog_listing) order by m.ml_item_id,m.variation_id),'[]') from public.ml_pricing_group_members m where m.group_id=g.id and m.is_current)
    )), '[]') into incoming from public.ml_pricing_groups g where g.seller_id=p_seller_id and g.produto_id=p_product_id and g.state<>'retired';
  else incoming := p_groups; end if;
  if p_complete and exists(select 1 from jsonb_array_elements(incoming) e where e->>'state' is distinct from 'verified') then raise exception 'unverified_complete_observation'; end if;
  -- Checa colisões antes de desligar a composição vigente deste produto.
  if exists(select 1 from jsonb_array_elements(incoming) e cross join lateral jsonb_array_elements(e->'members') m
    join public.ml_pricing_group_members current_member on current_member.seller_id=p_seller_id and current_member.ml_item_id=m->>'itemId' and current_member.variation_id=coalesce(m->>'variationId','') and current_member.is_current
    join public.ml_pricing_groups g on g.id=current_member.group_id where g.produto_id<>p_product_id) then raise exception 'listing_group_product_conflict'; end if;
  for entry in select value from jsonb_array_elements(incoming) loop
    if nullif(entry->>'anchorItemId','') is null or jsonb_typeof(entry->'members') is distinct from 'array' or jsonb_array_length(entry->'members')=0
      or jsonb_typeof(entry->'evidence') is distinct from 'array' or jsonb_typeof(entry->'reasons') is distinct from 'array'
      or not exists(select 1 from jsonb_array_elements(entry->'members') m where m->>'itemId'=entry->>'anchorItemId' and coalesce(m->>'variationId','')=coalesce(entry->>'anchorVariationId','')) then raise exception 'invalid_group_composition'; end if;
    entry := jsonb_set(entry,'{members}',(select jsonb_agg(m order by m->>'itemId',m->>'variationId') from jsonb_array_elements(entry->'members') m));
    if entry->>'state'='verified' and (jsonb_array_length(entry->'evidence')=0
      or exists(select 1 from jsonb_array_elements(entry->'evidence') e where e->>'condition' is distinct from 'valid' or nullif(e->>'reference','') is null or nullif(e->>'collectedAt','') is null)) then raise exception 'group_evidence_required'; end if;
    if (entry->>'synchronized')::boolean and (jsonb_array_length(entry->'members')<>2
      or (select count(*) from jsonb_array_elements(entry->'members') m where (m->>'catalog')::boolean)<>1)
      then raise exception 'invalid_synchronized_pair'; end if;
    select * into old_group from public.ml_pricing_groups g where g.seller_id=p_seller_id and g.anchor_item_id=entry->>'anchorItemId' and g.anchor_variation_id=coalesce(entry->>'anchorVariationId','');
    if found and old_group.produto_id<>p_product_id then raise exception 'group_anchor_product_conflict'; end if;
    group_id := old_group.id;
    if group_id is null then
      insert into public.ml_pricing_groups(seller_id,produto_id,anchor_item_id,anchor_variation_id,state,observed_at)
      values(p_seller_id,p_product_id,entry->>'anchorItemId',coalesce(entry->>'anchorVariationId',''),entry->>'state',p_observed_at) returning id into group_id;
    end if;
    if group_id=any(touched) then raise exception 'duplicate_group_anchor'; end if;
    touched := array_append(touched,group_id);
    select coalesce(array_agg(distinct m.group_id) filter(where m.group_id<>group_id),'{}') into predecessors
      from public.ml_pricing_group_members m where m.is_current and m.seller_id=p_seller_id
      and exists(select 1 from jsonb_array_elements(entry->'members') x where x->>'itemId'=m.ml_item_id and coalesce(x->>'variationId','')=m.variation_id);
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('state',entry->>'state','synchronized',entry->'synchronized','members',entry->'members')::text,'UTF8'),'sha256'),'hex');
    select r.fingerprint into old_fingerprint from public.ml_pricing_group_revisions r where r.group_id=group_id and r.version=coalesce(old_group.current_version,0);
    if old_fingerprint is distinct from fingerprint then
      next_version := coalesce(old_group.current_version,0)+1;
      insert into public.ml_pricing_group_revisions(group_id,version,state,catalog_synchronized_pair,fingerprint,observed_at,evidence,reasons,predecessor_ids)
      values(group_id,next_version,entry->>'state',(entry->>'synchronized')::boolean,fingerprint,p_observed_at,entry->'evidence',array(select jsonb_array_elements_text(entry->'reasons')),predecessors);
      for member in select value from jsonb_array_elements(entry->'members') loop
        insert into public.ml_pricing_group_members values(group_id,next_version,p_seller_id,member->>'itemId',coalesce(member->>'variationId',''),(member->>'catalog')::boolean,false);
      end loop;
    else next_version := old_group.current_version; end if;
    update public.ml_pricing_groups g set current_version=next_version,state=entry->>'state',observed_at=p_observed_at,latest_evidence=entry->'evidence' where g.id=group_id;
    result := result || jsonb_build_array(jsonb_build_object('groupId',group_id,'version',next_version));
  end loop;
  -- Grupos absorvidos conservam ID e revisões; revisão terminal referencia sucessores.
  for old_group in select * from public.ml_pricing_groups g where g.seller_id=p_seller_id and g.produto_id=p_product_id and g.state<>'retired' and not(g.id=any(touched)) loop
    next_version := old_group.current_version+1;
    insert into public.ml_pricing_group_revisions values(old_group.id,next_version,'retired',false,'retired',p_observed_at,'[]',array['COMPOSITION_REPLACED'],touched);
    update public.ml_pricing_groups g set current_version=next_version,state='retired',observed_at=p_observed_at,latest_evidence='[]' where g.id=old_group.id;
  end loop;
  update public.ml_pricing_group_members m set is_current=false from public.ml_pricing_groups g where g.id=m.group_id and g.seller_id=p_seller_id and g.produto_id=p_product_id and m.is_current;
  update public.ml_pricing_group_members m set is_current=true from public.ml_pricing_groups g where g.id=m.group_id and g.current_version=m.version and g.seller_id=p_seller_id and g.produto_id=p_product_id and g.state<>'retired';
  if p_complete then
    for target_group in select g.* from public.ml_pricing_groups g where g.id=any(touched) loop
      -- Mudança apenas de estado/evidência não aumenta alcance nem ressuscita override revogado.
      if (select coalesce(jsonb_agg(jsonb_build_array(m.ml_item_id,m.variation_id) order by m.ml_item_id,m.variation_id),'[]') from public.ml_pricing_group_members m where m.group_id=target_group.id and m.is_current)
        is not distinct from (select coalesce(jsonb_agg(jsonb_build_array(e->>'itemId',e->>'variationId') order by e->>'itemId',e->>'variationId'),'[]') from jsonb_array_elements(previous_members) e where (e->>'groupId')::uuid=target_group.id) then continue; end if;
      select array_agg(distinct (e->>'overrideId')::uuid) into origins from jsonb_array_elements(protected_before) e
        where exists(select 1 from public.ml_pricing_group_members m where m.group_id=target_group.id and m.is_current and m.ml_item_id=e->>'itemId' and m.variation_id=e->>'variationId');
      if coalesce(cardinality(origins),0)=0 then continue; end if;
      select o.id into protected_id from public.manual_pricing_overrides o where o.group_id=target_group.id and o.state='active';
      if protected_id is null then
        insert into public.manual_pricing_overrides(group_id,group_version,actor_id,reason,origin)
          values(target_group.id,target_group.current_version,null,'Proteção propagada por mudança de composição','propagated') returning id into protected_id;
      end if;
      insert into public.pricing_events(produto_id,group_id,group_version,override_id,kind,pricing_source,reason,evidence)
        values(p_product_id,target_group.id,target_group.current_version,protected_id,'override_propagated','catalog_sync','Proteção propagada por mudança de composição',jsonb_build_object('sourceOverrideIds',origins));
    end loop;
  end if;
  return jsonb_build_object('applied',true,'groups',result);
end;
$$;

-- V2-04: preservar baseline de todos os membros; resultado desconhecido não pode liberar nova tentativa sem prova.
create or replace function public.prepare_pricing_operation(p_id uuid,p_evaluation_id uuid,p_group_id uuid,p_group_version integer,p_item_id text,p_price_cents bigint,p_source text,p_actor_id uuid,p_reason text,p_rule_id text default null,p_job_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare evaluation public.pricing_evaluations%rowtype; existing public.pricing_operations%rowtype; baseline bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(select seller_id::text from public.ml_pricing_groups where id=p_group_id),0));
 perform pg_advisory_xact_lock(hashtextextended('pricing-operation:'||p_id::text,0));
 select * into existing from public.pricing_operations where id=p_id;
 if existing.id is not null then
   if row(existing.evaluation_id,existing.group_id,existing.group_version,existing.item_id,existing.new_price_cents,existing.source,existing.actor_id,existing.reason,existing.rule_id,existing.job_id)
   is distinct from row(p_evaluation_id,p_group_id,p_group_version,p_item_id,p_price_cents,p_source,p_actor_id,p_reason,p_rule_id,p_job_id) then raise exception 'pricing_idempotency_conflict'; end if;
   return existing.id;
 end if;
 select * into evaluation from public.pricing_evaluations where id=p_evaluation_id;
 if evaluation.id is null or not exists(select 1 from public.ml_pricing_groups g join public.ml_pricing_group_members m on m.group_id=g.id and m.version=g.current_version and m.is_current where g.id=p_group_id and g.current_version=p_group_version and g.state='verified' and g.produto_id=evaluation.produto_id and m.ml_item_id=p_item_id) then raise exception 'pricing_group_not_valid'; end if;
 perform public.assert_pricing_override_allows(p_group_id,p_source,p_actor_id);
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
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(select g.seller_id::text from public.pricing_operations o join public.ml_pricing_groups g on g.id=o.group_id where o.id=p_id),0));
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
 if p_state='requested' then perform public.assert_pricing_override_allows(op.group_id,op.source,op.actor_id); end if;
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
