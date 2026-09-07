-- WARRANTY-01. Append-only source decisions and product assessments. No ML writes.
create table public.warranty_sources (
 id uuid primary key, scope text not null, host text not null,
 state text not null check(state in ('approved','revoked')),
 reason text not null check(length(reason) between 1 and 200),
 reference text not null, actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp()
);
create index warranty_sources_scope_idx on public.warranty_sources(scope,host,created_at desc);
create table public.product_warranty_assessments (
 id uuid primary key, produto_id uuid not null references public.produtos(id),
 actor_id uuid not null references public.profiles(id), action text not null check(action in ('research','review','revoke','source')),
 command jsonb not null, fingerprint text not null,
 state text not null check(state in ('running','done','inconclusive')),
 result jsonb, created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 deadline timestamptz not null default (clock_timestamp()+interval '50 seconds')
);
create index product_warranty_history_idx on public.product_warranty_assessments(produto_id,created_at desc,id);
alter table public.warranty_sources enable row level security;
alter table public.product_warranty_assessments enable row level security;
revoke all on public.warranty_sources,public.product_warranty_assessments from public,anon,authenticated,service_role;
grant select on public.warranty_sources,public.product_warranty_assessments to service_role;

create function public.get_product_warranty_context(p_product_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('product',jsonb_build_object('id',p.id,'nome',p.nome,'marca',p.marca,'gtin',p.gtin,'descricao',p.descricao,
 'oferta_preferencial_id',p.oferta_preferencial_id,'fornecedor_preferencial_manual',p.fornecedor_preferencial_manual),
 'offers',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'ativo',o.ativo,'custo',o.custo,'estoque',o.estoque,'prioridade',o.prioridade,
 'nome',o.nome,'descricao',o.descricao,'marca',o.marca,'gtin',o.gtin,'dslite_fornecedor_id',o.dslite_fornecedor_id,
 'sku_oferta',o.sku_oferta,'sku_fornecedor',o.sku_fornecedor) order by o.id) from public.produto_fornecedor_ofertas o
 join public.fornecedores f on f.dslite_id::text=o.dslite_fornecedor_id::text
 where o.produto_id=p.id and f.ativo and f.dropshipping_retired_at is null),'[]'::jsonb),
 'kit',coalesce((select to_jsonb(k) from public.produto_kits k where k.produto_id=p.id),'null'::jsonb),
 'components',coalesce((select jsonb_agg(to_jsonb(c) order by c.componente_produto_id) from public.produto_kit_componentes c where c.kit_produto_id=p.id),'[]'::jsonb))
 from public.produtos p where p.id=p_product_id;
$$;
create function public.get_product_warranty_fingerprint(p_product_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(extensions.digest(public.get_product_warranty_context(p_product_id)::text,'sha256'),'hex');
$$;

-- One MVCC snapshot: evidence, its fingerprint and source revocations cannot
-- come from independent reads. History is bounded without hiding current data.
create function public.get_product_warranty_snapshot(p_product_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with context as (select public.get_product_warranty_context(p_product_id) as data),
 base as (select data,encode(extensions.digest(data::text,'sha256'),'hex') as fp from context),
 applicable as (select a.* from public.product_warranty_assessments a,base b where a.produto_id=p_product_id and a.fingerprint=b.fp and a.action<>'source' and a.state<>'running'),
 current_evidence as (select * from applicable where state='done' and (action='revoke' or (not result ? 'failure' and (action='review' or jsonb_array_length(result->'candidates')>0))) order by created_at desc,id limit 1),
 latest_attempt as (select * from applicable order by created_at desc,id limit 1)
 select case when b.data is null then null else jsonb_build_object('context',b.data,'fingerprint',b.fp,
 'current',coalesce((select to_jsonb(c) from current_evidence c),(select to_jsonb(a) from latest_attempt a)),
 'latest',(select to_jsonb(a) from latest_attempt a),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id) from
 (select a.id,a.action,case when a.state='running' and a.deadline<clock_timestamp() then 'inconclusive' else a.state end as state,
 a.created_at,a.command->>'reason' as reason,a.actor_id,p.nome as actor_name
 from public.product_warranty_assessments a join public.profiles p on p.id=a.actor_id where a.produto_id=p_product_id order by a.created_at desc,a.id limit 50) h),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.scope,s.host) from
 (select distinct on(scope,host) w.* from public.warranty_sources w where
 w.scope='manufacturer:'||regexp_replace(lower(trim(b.data->'product'->>'marca')),'\s+',' ','g')
 or w.scope in (select 'supplier:'||(o->>'dslite_fornecedor_id') from jsonb_array_elements(b.data->'offers') o)
 order by scope,host,created_at desc,id) s),'[]'::jsonb)) end from base b;
$$;

create function public.begin_product_warranty_command(p_product_id uuid,p_actor_id uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.product_warranty_assessments; command_id uuid:=(p_command->>'commandId')::uuid; fp text;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'warranty_permission_denied'; end if;
 if p_command->>'action' not in ('research','review','revoke','source') or length(coalesce(p_command->>'reason','')) not between 1 and 200 then raise exception 'warranty_invalid_command'; end if;
 perform pg_advisory_xact_lock(hashtextextended('warranty:'||p_product_id::text,0));
 select * into existing from public.product_warranty_assessments where id=command_id;
 if found then
  if existing.produto_id<>p_product_id or existing.actor_id<>p_actor_id or existing.command<>p_command then raise exception 'warranty_idempotency_conflict'; end if;
  return jsonb_build_object('acquired',false,'record',to_jsonb(existing));
 end if;
 if exists(select 1 from public.product_warranty_assessments where produto_id=p_product_id and state='running' and deadline>clock_timestamp()) then raise exception 'warranty_in_progress'; end if;
 fp:=public.get_product_warranty_fingerprint(p_product_id);
 if fp is null or fp<>p_command->>'fingerprint' then raise exception 'warranty_context_changed'; end if;
 insert into public.product_warranty_assessments(id,produto_id,actor_id,action,command,fingerprint,state)
 values(command_id,p_product_id,p_actor_id,p_command->>'action',p_command,fp,'running');
 return jsonb_build_object('acquired',true);
end; $$;

create function public.finish_product_warranty_command(p_id uuid,p_actor_id uuid,p_result jsonb,p_source jsonb default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.product_warranty_assessments;
begin
 select * into r from public.product_warranty_assessments where id=p_id for update;
 if not found or r.actor_id<>p_actor_id or not exists(select 1 from public.profiles where id=p_actor_id and cargo in ('admin','gerente')) then raise exception 'warranty_permission_denied'; end if;
 if r.state<>'running' then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('warranty:'||r.produto_id::text,0));
 if r.deadline<clock_timestamp() or r.fingerprint is distinct from public.get_product_warranty_fingerprint(r.produto_id) then
  update public.product_warranty_assessments set state='inconclusive',result='{"candidates":[],"failure":"warranty_context_changed_or_timeout"}',completed_at=clock_timestamp() where id=p_id;
  return;
 end if;
 if jsonb_typeof(p_result->'candidates') is distinct from 'array' then raise exception 'warranty_invalid_result'; end if;
 if p_source is not null then
  if r.action<>'source' or p_source->>'state' not in ('approved','revoked') or coalesce(p_source->>'scope','')='' or coalesce(p_source->>'host','')='' then raise exception 'warranty_invalid_source'; end if;
  insert into public.warranty_sources(id,scope,host,state,reason,reference,actor_id)
  values(p_id,p_source->>'scope',p_source->>'host',p_source->>'state',r.command->>'reason',r.command->>'url',p_actor_id);
 end if;
 update public.product_warranty_assessments set state='done',result=p_result,completed_at=clock_timestamp() where id=p_id;
end; $$;
revoke all on function public.get_product_warranty_context(uuid),public.get_product_warranty_fingerprint(uuid),public.get_product_warranty_snapshot(uuid),public.begin_product_warranty_command(uuid,uuid,jsonb),public.finish_product_warranty_command(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.get_product_warranty_context(uuid),public.get_product_warranty_fingerprint(uuid),public.get_product_warranty_snapshot(uuid),public.begin_product_warranty_command(uuid,uuid,jsonb),public.finish_product_warranty_command(uuid,uuid,jsonb,jsonb) to service_role;
comment on column public.configuracoes.ml_default_warranty_duration is 'Legado histórico: não governa novas garantias. WARRANTY-01 exige evidência por produto.';
notify pgrst,'reload schema';
