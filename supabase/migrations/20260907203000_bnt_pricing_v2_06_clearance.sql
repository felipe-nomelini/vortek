-- V2-06: autorização local, não execução comercial. Estoque continua no ledger existente.
create table public.internal_stock_clearance (
 id uuid primary key default gen_random_uuid(),
 produto_id uuid not null references public.produtos(id),
 actor_id uuid not null, reason text not null check(length(btrim(reason)) between 1 and 200),
 starts_at timestamptz not null default clock_timestamp(), ends_at timestamptz,
 quantity integer not null check(quantity > 0),
 max_loss_cents bigint not null check(max_loss_cents between 0 and 9007199254740991),
 evaluation_id uuid references public.pricing_evaluations(id),
 state text not null default 'active' check(state in ('active','revoked','completed')),
 closed_at timestamptz, closed_by uuid, close_reason text,
 check(ends_at is null or ends_at > starts_at),
 check(quantity::numeric * max_loss_cents <= 9007199254740991),
 check((state='active' and closed_at is null and closed_by is null and close_reason is null)
   or(state<>'active' and closed_at is not null and closed_by is not null and length(btrim(close_reason)) between 1 and 200))
);
create index internal_clearance_product on public.internal_stock_clearance(produto_id,starts_at desc);
-- Cada recorte identifica unidades da entrada (intervalo fechado), não um novo saldo.
create table public.internal_stock_clearance_entries (
 clearance_id uuid not null references public.internal_stock_clearance(id),
 entry_id uuid not null references public.estoque_interno_movimentacoes(id),
 component_id uuid not null references public.produtos(id),
 units_per_sale integer not null check(units_per_sale>0),
 first_unit integer not null check(first_unit>0), last_unit integer not null check(last_unit>=first_unit),
 primary key(clearance_id,entry_id)
);
create index internal_clearance_entry on public.internal_stock_clearance_entries(entry_id);
create table public.internal_stock_clearance_groups (
 clearance_id uuid not null references public.internal_stock_clearance(id),
 group_id uuid not null references public.ml_pricing_groups(id),
 group_version integer not null,
 foreign key(group_id,group_version) references public.ml_pricing_group_revisions(group_id,version),
 primary key(clearance_id,group_id)
);
create index internal_clearance_group on public.internal_stock_clearance_groups(group_id);
alter table public.internal_stock_clearance enable row level security;
alter table public.internal_stock_clearance_entries enable row level security;
alter table public.internal_stock_clearance_groups enable row level security;
revoke all on public.internal_stock_clearance,public.internal_stock_clearance_entries,public.internal_stock_clearance_groups from public,anon,authenticated,service_role;
grant select on public.internal_stock_clearance,public.internal_stock_clearance_entries,public.internal_stock_clearance_groups to service_role;
alter table public.pricing_events add column clearance_id uuid references public.internal_stock_clearance(id);
create index pricing_events_clearance on public.pricing_events(clearance_id,id desc);
alter table public.pricing_events drop constraint pricing_events_kind_check;
alter table public.pricing_events add constraint pricing_events_kind_check check(kind in
 ('baseline','observed','projection_changed','requested','confirmed','failed','inconclusive','override_activated','override_revoked','override_propagated','clearance_activated','clearance_revoked','clearance_completed','clearance_transferred'));
alter table public.pricing_operations add column clearance_id uuid references public.internal_stock_clearance(id);
alter table public.pricing_operations add column fulfillment_source text check(fulfillment_source in ('internal','supplier'));
alter table public.pricing_operations add column clearance_quantity integer check(clearance_quantity>0);
create unique index pricing_operations_active_clearance on public.pricing_operations(clearance_id)
 where clearance_id is not null and state in ('prepared','requested','inconclusive');

-- Mesmo FIFO das entradas visíveis; inclui compromissos ativos e exclui estornos.
-- Esta consulta existe no banco para validar recortes atomicamente com os locks do estoque.
create function public.internal_clearance_fifo(p_product_id uuid)
returns table(entry_id uuid,first_available bigint,last_unit integer,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 with outgoing as (
 select coalesce(sum(quantidade),0) q from public.estoque_interno_movimentacoes
 where produto_id=p_product_id and tipo in ('saida_envio_interno','ajuste_negativo') and estornada_em is null
 ), entries as (
 select m.*, coalesce(sum(quantidade) over(order by m.created_at,m.id rows between unbounded preceding and 1 preceding),0) prior
 from public.estoque_interno_movimentacoes m where produto_id=p_product_id
 and tipo in ('entrada_devolucao','entrada_compra','ajuste_positivo') and situacao_estoque='liberado' and estornada_em is null
 ) select id,least(quantidade::bigint+1,greatest(0,outgoing.q-entries.prior)::bigint+1),quantidade,entries.created_at
 from entries cross join outgoing order by entries.created_at,id;
$$;

create function public.get_internal_clearance_stock(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare requirements jsonb; entries jsonb; cap bigint; req record; result jsonb;
begin
 if not exists(select 1 from public.produtos where id=p_product_id and ativo) then return jsonb_build_object('capacity',0,'fingerprint','','requirements','[]'::jsonb,'entries','[]'::jsonb); end if;
 if exists(select 1 from public.produto_kits where produto_id=p_product_id) then
   if not exists(select 1 from public.produto_kits where produto_id=p_product_id and ativo) then return jsonb_build_object('capacity',0,'fingerprint','','requirements','[]'::jsonb,'entries','[]'::jsonb); end if;
   select jsonb_agg(jsonb_build_object('productId',componente_produto_id,'units',quantidade) order by componente_produto_id) into requirements
   from public.produto_kit_componentes where kit_produto_id=p_product_id;
 else requirements:=jsonb_build_array(jsonb_build_object('productId',p_product_id,'units',1)); end if;
 if requirements is null or exists(select 1 from jsonb_array_elements(requirements) r
   where (r->>'units')::integer<=0 or not exists(select 1 from public.produtos where id=(r->>'productId')::uuid and ativo)
   or exists(select 1 from public.produto_kits where produto_id=(r->>'productId')::uuid)) then return jsonb_build_object('capacity',0,'fingerprint','','requirements','[]'::jsonb,'entries','[]'::jsonb); end if;
 entries:='[]'; cap:=2147483647;
 for req in select (r->>'productId')::uuid product_id,(r->>'units')::integer units from jsonb_array_elements(requirements) r loop
   -- Não sobrepor autorizações na mesma entrada, inclusive entre produto e kit.
   select coalesce(jsonb_agg(jsonb_build_object('entryId',f.entry_id,'productId',req.product_id,'units',req.units,'firstUnit',f.first_available,'lastUnit',f.last_unit) order by f.created_at,f.entry_id),'[]') into result
   from public.internal_clearance_fifo(req.product_id) f join public.estoque_interno_movimentacoes m on m.id=f.entry_id
   where f.first_available<=f.last_unit and m.snapshot_source='operacional' and not exists(
     select 1 from public.internal_stock_clearance_entries e join public.internal_stock_clearance c on c.id=e.clearance_id
     where e.entry_id=f.entry_id and c.state='active' and(c.ends_at is null or c.ends_at>statement_timestamp()));
   entries:=entries||result;
   cap:=least(cap,(select coalesce(sum((r->>'lastUnit')::bigint-(r->>'firstUnit')::bigint+1),0)/req.units from jsonb_array_elements(result) r));
 end loop;
 result:=jsonb_build_object('capacity',cap,'requirements',requirements,'entries',entries);
 return result||jsonb_build_object('fingerprint',encode(extensions.digest(convert_to(result::text,'UTF8'),'sha256'),'hex'));
end $$;

create function public.internal_clearance_available(p_clearance_id uuid) returns integer
language sql stable security definer set search_path='' as $$
 select coalesce(min(capacity),0)::integer from (
 select e.component_id,sum(case when f.entry_id is null then 0 else greatest(0,least(e.last_unit,f.last_unit)-greatest(e.first_unit,f.first_available)+1) end)/max(e.units_per_sale) capacity
 from public.internal_stock_clearance_entries e left join lateral public.internal_clearance_fifo(e.component_id) f on f.entry_id=e.entry_id
 where e.clearance_id=p_clearance_id group by e.component_id
 ) amounts;
$$;

create function public.manage_internal_stock_clearance(p_product_id uuid,p_actor_id uuid,p_command jsonb,p_evaluation jsonb default null) returns uuid
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare g public.ml_pricing_groups%rowtype; c public.internal_stock_clearance%rowtype; prior public.pricing_events%rowtype;
 command_id uuid:=(p_command->>'commandId')::uuid; action text:=p_command->>'action'; command jsonb;
 stock jsonb; req record; entry record; needed bigint; allocated integer; cid uuid; v_quantity integer; evaluation_id uuid;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'clearance_permission_denied'; end if;
 if command_id is null or action is null or action not in ('activate','revoke','complete')
   or coalesce(length(btrim(p_command->>'reason')),0) not between 1 and 200 then raise exception 'clearance_invalid_command'; end if;
 -- Sempre seller -> comando -> produtos ordenados; compatível com grupos e reservas.
 select * into g from public.ml_pricing_groups where id=(p_command->>'groupId')::uuid and produto_id=p_product_id;
 if g.id is null then raise exception 'clearance_group_mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||g.seller_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('pricing-clearance-command:'||command_id::text,0));
 command:=jsonb_build_object('productId',p_product_id,'actorId',p_actor_id,'input',p_command);
 select * into prior from public.pricing_events where pricing_events.command_id=command_id;
 if found then
   if prior.evidence->'command' is distinct from command then raise exception 'clearance_idempotency_conflict'; end if;
   return prior.clearance_id;
 end if;
 select * into g from public.ml_pricing_groups where id=g.id;
 if g.current_version is distinct from (p_command->>'groupVersion')::integer then raise exception 'clearance_group_changed'; end if;
 if action='activate' then
   if g.state<>'verified' then raise exception 'clearance_group_unverified'; end if;
   v_quantity:=(p_command->>'quantity')::integer;
   if v_quantity is null or v_quantity<=0 or (p_command->>'maxLossCents') is null
     or ((p_command->>'maxLossCents')::bigint>0 and coalesce((p_command->>'acceptLoss')::boolean,false)=false)
     or not(p_command ? 'endsAt') or (p_command->>'endsAt')::timestamptz<=clock_timestamp() then raise exception 'clearance_invalid_command'; end if;
   if exists(select 1 from public.internal_stock_clearance_groups b join public.internal_stock_clearance a on a.id=b.clearance_id
     where b.group_id=g.id and a.state='active' and(a.ends_at is null or a.ends_at>clock_timestamp())) then raise exception 'clearance_group_conflict'; end if;
   perform p.id from public.produtos p where p.id=p_product_id or p.id in(select componente_produto_id from public.produto_kit_componentes where kit_produto_id=p_product_id) order by p.id for update;
   stock:=public.get_internal_clearance_stock(p_product_id);
   if stock->>'fingerprint' is distinct from p_command->>'stockFingerprint' then raise exception 'clearance_stock_changed'; end if;
   if v_quantity>(stock->>'capacity')::integer then raise exception 'clearance_stock_insufficient'; end if;
   if jsonb_typeof(p_evaluation) is distinct from 'object' or p_evaluation->'current'->>'status' is null then raise exception 'clearance_evaluation_missing'; end if;
   insert into public.pricing_evaluations(produto_id,actor_id,result,fingerprint)
     values(p_product_id,p_actor_id,p_evaluation,encode(extensions.digest(convert_to(p_evaluation::text,'UTF8'),'sha256'),'hex')) returning id into evaluation_id;
   insert into public.internal_stock_clearance(produto_id,actor_id,reason,ends_at,quantity,max_loss_cents,evaluation_id)
   values(p_product_id,p_actor_id,btrim(p_command->>'reason'),(p_command->>'endsAt')::timestamptz,v_quantity,(p_command->>'maxLossCents')::bigint,evaluation_id) returning id into cid;
   for req in select (r->>'productId')::uuid product_id,(r->>'units')::integer units from jsonb_array_elements(stock->'requirements') r loop
     needed:=v_quantity::bigint*req.units;
     for entry in select (r->>'entryId')::uuid id,(r->>'firstUnit')::integer first_unit,(r->>'lastUnit')::integer last_unit
       from jsonb_array_elements(stock->'entries') r where (r->>'productId')::uuid=req.product_id loop
       exit when needed=0;
       allocated:=least(needed,entry.last_unit-entry.first_unit+1);
       insert into public.internal_stock_clearance_entries values(cid,entry.id,req.product_id,req.units,entry.first_unit,entry.first_unit+allocated-1);
       needed:=needed-allocated;
     end loop;
     if needed<>0 then raise exception 'clearance_stock_insufficient'; end if;
   end loop;
   insert into public.internal_stock_clearance_groups values(cid,g.id,g.current_version);
 else
   cid:=(p_command->>'clearanceId')::uuid;
   select * into c from public.internal_stock_clearance where id=cid and produto_id=p_product_id for update;
   if c.id is null or c.state<>'active' or not exists(select 1 from public.internal_stock_clearance_groups where clearance_id=cid and group_id=g.id) then raise exception 'clearance_state_conflict'; end if;
   update public.internal_stock_clearance set state=case when action='revoke' then 'revoked' else 'completed' end,
     closed_at=clock_timestamp(),closed_by=p_actor_id,close_reason=btrim(p_command->>'reason') where id=cid;
 end if;
 insert into public.pricing_events(produto_id,group_id,group_version,clearance_id,command_id,kind,pricing_source,actor_id,reason,evidence)
 values(p_product_id,g.id,g.current_version,cid,command_id,case action when 'activate' then 'clearance_activated' when 'revoke' then 'clearance_revoked' else 'clearance_completed' end,
 'manual',p_actor_id,btrim(p_command->>'reason'),jsonb_build_object('command',command));
 return cid;
end $$;

-- Verificação compartilhada por preparação e envio. Observações/read-back não são impedidos.
create function public.assert_pricing_governance_allows(p_group_id uuid,p_source text,p_actor_id uuid,p_clearance_id uuid,
 p_evaluation_id uuid,p_price_cents bigint,p_fulfillment_source text,p_quantity integer) returns void
language plpgsql security definer set search_path='' as $$
declare c public.internal_stock_clearance%rowtype; n integer; memory jsonb; evaluation jsonb; composition jsonb;
begin
 if p_source='manual' and not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'override_permission_denied'; end if;
 select count(*) into n from public.internal_stock_clearance candidate join public.internal_stock_clearance_groups b on b.clearance_id=candidate.id
 where b.group_id=p_group_id and candidate.state='active' and(candidate.ends_at is null or candidate.ends_at>clock_timestamp());
 if n>1 then raise exception 'clearance_group_conflict'; end if;
 if p_clearance_id is not null then
   select a.* into c from public.internal_stock_clearance a join public.internal_stock_clearance_groups b on b.clearance_id=a.id where a.id=p_clearance_id and b.group_id=p_group_id for update of a;
   if c.id is null or c.state<>'active' or (c.ends_at is not null and c.ends_at<=clock_timestamp()) then raise exception 'clearance_not_active'; end if;
   if p_source<>'manual' then raise exception 'clearance_manual_only'; end if;
   if p_fulfillment_source is distinct from 'internal' or p_quantity is null or p_quantity<=0 then raise exception 'clearance_internal_only'; end if;
   if not exists(select 1 from public.ml_pricing_groups where id=p_group_id and produto_id=c.produto_id and state='verified') then raise exception 'clearance_group_unverified'; end if;
   if not exists(select 1 from public.produtos where id=c.produto_id and ativo) then raise exception 'clearance_product_inactive'; end if;
   perform p.id from public.produtos p where p.id=c.produto_id or p.id in(select component_id from public.internal_stock_clearance_entries where clearance_id=c.id) order by p.id for update;
   -- Produto/composição não pode mudar silenciosamente sob uma autorização.
   composition:=public.get_internal_clearance_stock(c.produto_id)->'requirements';
   if composition is distinct from (select jsonb_agg(jsonb_build_object('productId',component_id,'units',units) order by component_id)
     from(select component_id,max(units_per_sale) units from public.internal_stock_clearance_entries where clearance_id=c.id group by component_id) r) then raise exception 'clearance_composition_changed'; end if;
   if public.internal_clearance_available(c.id)<p_quantity then raise exception 'clearance_stock_insufficient'; end if;
   select result into evaluation from public.pricing_evaluations where id=p_evaluation_id and produto_id=c.produto_id;
   memory:=evaluation->'current'->'memory';
   if coalesce(evaluation->'current'->>'status','') not in ('available','estimated') or memory is null
     or (memory->>'revenueCents')::bigint is distinct from p_price_cents then raise exception 'clearance_economy_inconclusive'; end if;
   if memory->>'resultCents' is null or memory->'context'->>'productId' is distinct from c.produto_id::text
     or memory->'context'->>'mlItemId' is null or not exists(select 1 from public.ml_pricing_group_members where group_id=p_group_id and is_current and ml_item_id=memory->'context'->>'mlItemId')
     or memory->'cost'->>'source' is distinct from 'offer' then raise exception 'clearance_economy_inconclusive'; end if;
   if (memory->>'resultCents')::bigint < -c.max_loss_cents then raise exception 'clearance_loss_exceeded'; end if;
   if exists(select 1 from jsonb_each(jsonb_build_object('cost',memory->'cost','fee',memory->'fee','shipping',memory->'shipping')) v
     where v.value->>'condition' in ('missing','invalid','stale') or (v.value->>'expiresAt')::timestamptz<=clock_timestamp()) then raise exception 'clearance_economy_inconclusive'; end if;
   if not exists(select 1 from public.produto_fornecedor_ofertas o where o.id=(memory->'cost'->>'sourceId')::uuid and o.ativo
     and o.produto_id=coalesce((memory->'cost'->'composition'->>'productId')::uuid,c.produto_id)
     and round(o.custo*100)::bigint * coalesce((memory->'cost'->'composition'->>'quantity')::integer,1)=(memory->'cost'->>'amountCents')::bigint)
     then raise exception 'clearance_economy_changed'; end if;
   -- Evidência viva e contexto material são obrigatórios antes do futuro envio comercial.
   if evaluation->'revalidation'->>'status' is distinct from 'queried' then raise exception 'clearance_economy_inconclusive'; end if;
   return;
 end if;
 if n>0 then raise exception 'clearance_explicit_context_required'; end if;
 perform public.assert_pricing_override_allows(p_group_id,p_source,p_actor_id);
end $$;

revoke all on function public.internal_clearance_fifo(uuid),public.get_internal_clearance_stock(uuid),public.internal_clearance_available(uuid),public.manage_internal_stock_clearance(uuid,uuid,jsonb,jsonb),public.assert_pricing_governance_allows(uuid,text,uuid,uuid,uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.internal_clearance_fifo(uuid),public.get_internal_clearance_stock(uuid),public.internal_clearance_available(uuid),public.manage_internal_stock_clearance(uuid,uuid,jsonb,jsonb),public.assert_pricing_governance_allows(uuid,text,uuid,uuid,uuid,bigint,text,integer) to service_role;

create function public.get_product_pricing_clearances(p_product_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'state',case when c.state='active' and c.ends_at<=statement_timestamp() then 'expired' else c.state end,
 'reason',c.reason,'startsAt',c.starts_at,'endsAt',c.ends_at,'quantity',c.quantity,'maxLossCents',c.max_loss_cents,
 'available',public.internal_clearance_available(c.id),'actorName',p.nome,'closedAt',c.closed_at,'closeReason',c.close_reason,
 'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'version',g.current_version,'state',g.state,'conflict',
   (select count(*)>1 from public.internal_stock_clearance_groups bx join public.internal_stock_clearance cx on cx.id=bx.clearance_id
    where bx.group_id=g.id and cx.state='active' and(cx.ends_at is null or cx.ends_at>statement_timestamp()))))
   from public.internal_stock_clearance_groups b join public.ml_pricing_groups g on g.id=b.group_id where b.clearance_id=c.id),'[]')) order by c.starts_at desc),'[]')
 from public.internal_stock_clearance c left join public.profiles p on p.id=c.actor_id where c.produto_id=p_product_id;
$$;
revoke all on function public.get_product_pricing_clearances(uuid) from public,anon,authenticated;
grant execute on function public.get_product_pricing_clearances(uuid) to service_role;

-- Atualizar os donos existentes sem wrapper, outbox ou alteração de migrations históricas.
create or replace function public.reconcile_ml_pricing_groups(
  p_seller_id bigint, p_product_id uuid, p_observed_at timestamptz, p_complete boolean, p_groups jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  entry jsonb; member jsonb; old_group public.ml_pricing_groups%rowtype;
  group_id uuid; next_version integer; fingerprint text; old_fingerprint text;
  clearances_before jsonb; clearance_origin record; protected_before jsonb; previous_members jsonb; origins uuid[]; protected_id uuid; target_group record;
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
  select coalesce(jsonb_agg(jsonb_build_object('clearanceId',c.id,'itemId',m.ml_item_id,'variationId',m.variation_id)),'[]') into clearances_before
    from public.internal_stock_clearance c join public.internal_stock_clearance_groups b on b.clearance_id=c.id
    join public.ml_pricing_group_members m on m.group_id=b.group_id and m.is_current
    join public.ml_pricing_groups g on g.id=m.group_id
    where c.state='active' and(c.ends_at is null or c.ends_at>clock_timestamp())
    and g.seller_id=p_seller_id and g.produto_id=p_product_id;
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
  if p_complete then
    for clearance_origin in
      select distinct (e->>'clearanceId')::uuid cid,g.id gid,g.current_version ver
      from jsonb_array_elements(clearances_before) e
      join public.ml_pricing_group_members m on m.is_current and m.ml_item_id=e->>'itemId' and m.variation_id=e->>'variationId'
      join public.ml_pricing_groups g on g.id=m.group_id and g.seller_id=p_seller_id and g.produto_id=p_product_id
    loop
      if not exists(select 1 from public.internal_stock_clearance_groups binding where binding.clearance_id=clearance_origin.cid and binding.group_id=clearance_origin.gid and binding.group_version=clearance_origin.ver) then
        insert into public.internal_stock_clearance_groups values(clearance_origin.cid,clearance_origin.gid,clearance_origin.ver)
          on conflict on constraint internal_stock_clearance_groups_pkey do update set group_version=excluded.group_version;
        insert into public.pricing_events(produto_id,group_id,group_version,clearance_id,kind,pricing_source,reason)
          values(p_product_id,clearance_origin.gid,clearance_origin.ver,clearance_origin.cid,'clearance_transferred','catalog_sync','Autorização compartilhada; quantidade, perda e vigência preservadas');
      end if;
    end loop;
  end if;
  return jsonb_build_object('applied',true,'groups',result);
end;
$$;


drop function public.prepare_pricing_operation(uuid,uuid,uuid,integer,text,bigint,text,uuid,text,text,uuid);
create or replace function public.prepare_pricing_operation(p_id uuid,p_evaluation_id uuid,p_group_id uuid,p_group_version integer,p_item_id text,p_price_cents bigint,p_source text,p_actor_id uuid,p_reason text,p_rule_id text default null,p_job_id uuid default null,p_clearance_id uuid default null,p_fulfillment_source text default null,p_quantity integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare evaluation public.pricing_evaluations%rowtype; existing public.pricing_operations%rowtype; baseline bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(select seller_id::text from public.ml_pricing_groups where id=p_group_id),0));
 perform pg_advisory_xact_lock(hashtextextended('pricing-operation:'||p_id::text,0));
 select * into existing from public.pricing_operations where id=p_id;
 if existing.id is not null then
   if row(existing.evaluation_id,existing.group_id,existing.group_version,existing.item_id,existing.new_price_cents,existing.source,existing.actor_id,existing.reason,existing.rule_id,existing.job_id,existing.clearance_id,existing.fulfillment_source,existing.clearance_quantity)
   is distinct from row(p_evaluation_id,p_group_id,p_group_version,p_item_id,p_price_cents,p_source,p_actor_id,p_reason,p_rule_id,p_job_id,p_clearance_id,p_fulfillment_source,p_quantity) then raise exception 'pricing_idempotency_conflict'; end if;
   return existing.id;
 end if;
 select * into evaluation from public.pricing_evaluations where id=p_evaluation_id;
 if evaluation.id is null or not exists(select 1 from public.ml_pricing_groups g join public.ml_pricing_group_members m on m.group_id=g.id and m.version=g.current_version and m.is_current where g.id=p_group_id and g.current_version=p_group_version and g.state='verified' and g.produto_id=evaluation.produto_id and m.ml_item_id=p_item_id) then raise exception 'pricing_group_not_valid'; end if;
 perform public.assert_pricing_governance_allows(p_group_id,p_source,p_actor_id,p_clearance_id,p_evaluation_id,p_price_cents,p_fulfillment_source,p_quantity);
 select new_price_cents into baseline from public.pricing_events where item_id=p_item_id and kind in ('observed','baseline') and pricing_source='mercado_livre' order by id desc limit 1;
 if baseline is null then raise exception 'pricing_baseline_missing'; end if;
 if exists(select 1 from public.ml_pricing_group_members m left join lateral (select new_price_cents from public.pricing_events e where e.item_id=m.ml_item_id and e.kind in ('observed','baseline') and e.pricing_source='mercado_livre' order by id desc limit 1) e on true where m.group_id=p_group_id and m.version=p_group_version and e.new_price_cents is distinct from baseline) then raise exception 'pricing_member_baseline_missing_or_divergent'; end if;
 insert into public.pricing_operations(id,evaluation_id,produto_id,group_id,group_version,source,actor_id,reason,rule_id,job_id,item_id,previous_price_cents,new_price_cents,clearance_id,fulfillment_source,clearance_quantity)
 values(p_id,p_evaluation_id,evaluation.produto_id,p_group_id,p_group_version,p_source,p_actor_id,p_reason,p_rule_id,p_job_id,p_item_id,baseline,p_price_cents,p_clearance_id,p_fulfillment_source,p_quantity);
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

revoke all on function public.prepare_pricing_operation(uuid,uuid,uuid,integer,text,bigint,text,uuid,text,text,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.prepare_pricing_operation(uuid,uuid,uuid,integer,text,bigint,text,uuid,text,text,uuid,uuid,text,integer) to service_role;
