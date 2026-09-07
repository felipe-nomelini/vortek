-- CFL-03: identidade/composição observada. Não publica nem dispara outbox.
create table public.ml_pricing_groups (
  id uuid primary key default gen_random_uuid(),
  seller_id bigint not null check (seller_id > 0),
  produto_id uuid not null references public.produtos(id),
  anchor_item_id text not null check (anchor_item_id <> ''),
  anchor_variation_id text not null default '',
  current_version integer not null default 0,
  state text not null check (state in ('verified','unverified','retired')),
  observed_at timestamptz not null,
  latest_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(latest_evidence) = 'array'),
  unique (seller_id, anchor_item_id, anchor_variation_id)
);
create index ml_pricing_groups_product on public.ml_pricing_groups(produto_id, seller_id);
create table public.ml_pricing_group_revisions (
  group_id uuid not null references public.ml_pricing_groups(id),
  version integer not null check (version > 0),
  state text not null check (state in ('verified','unverified','retired')),
  catalog_synchronized_pair boolean not null,
  fingerprint text not null,
  observed_at timestamptz not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array'),
  reasons text[] not null,
  predecessor_ids uuid[] not null default '{}',
  primary key (group_id,version),
  check (not catalog_synchronized_pair or state = 'verified')
);
create table public.ml_pricing_group_members (
  group_id uuid not null,
  version integer not null,
  seller_id bigint not null,
  ml_item_id text not null check (ml_item_id <> ''),
  variation_id text not null default '',
  catalog_listing boolean not null,
  is_current boolean not null,
  primary key (group_id,version,ml_item_id,variation_id),
  foreign key (group_id,version) references public.ml_pricing_group_revisions(group_id,version)
);
create unique index ml_pricing_group_member_current on public.ml_pricing_group_members(seller_id,ml_item_id,variation_id) where is_current;
alter table public.ml_pricing_groups enable row level security;
alter table public.ml_pricing_group_revisions enable row level security;
alter table public.ml_pricing_group_members enable row level security;
revoke all on public.ml_pricing_groups, public.ml_pricing_group_revisions, public.ml_pricing_group_members from anon, authenticated, service_role;
grant select on public.ml_pricing_groups, public.ml_pricing_group_revisions, public.ml_pricing_group_members to service_role;

create function public.reconcile_ml_pricing_groups(
  p_seller_id bigint, p_product_id uuid, p_observed_at timestamptz, p_complete boolean, p_groups jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  entry jsonb; member jsonb; old_group public.ml_pricing_groups%rowtype;
  group_id uuid; next_version integer; fingerprint text; old_fingerprint text;
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
  return jsonb_build_object('applied',true,'groups',result);
end;
$$;
revoke all on function public.reconcile_ml_pricing_groups(bigint,uuid,timestamptz,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_ml_pricing_groups(bigint,uuid,timestamptz,boolean,jsonb) to service_role;
