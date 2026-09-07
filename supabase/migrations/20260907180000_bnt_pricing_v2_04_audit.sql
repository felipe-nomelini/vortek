-- V2-04: trilha prospectiva. Nenhum transporte ML ou liberação comercial.
alter table public.anuncios_ml add column pricing_observed_at timestamptz;
alter table public.catalogo_ml_snapshot add column pricing_observed_at timestamptz;
create table public.pricing_evaluations (
 id uuid primary key default gen_random_uuid(), produto_id uuid not null references public.produtos(id),
 created_at timestamptz not null default clock_timestamp(), actor_id uuid,
 fingerprint text not null, result jsonb not null check(jsonb_typeof(result)='object')
);
create index pricing_evaluations_product on public.pricing_evaluations(produto_id,created_at desc,id);
create table public.pricing_operations (
 id uuid primary key, evaluation_id uuid not null references public.pricing_evaluations(id),
 produto_id uuid not null references public.produtos(id), group_id uuid not null, group_version integer not null,
 foreign key(group_id,group_version) references public.ml_pricing_group_revisions(group_id,version),
 source text not null check(source in ('manual','pricing_engine','scheduled_job','catalog_sync','mercado_livre','supplier_sync','migration','unknown')),
 actor_id uuid, reason text not null check(length(reason) between 1 and 200), rule_id text, job_id uuid,
 item_id text not null, previous_price_cents bigint, new_price_cents bigint not null check(new_price_cents>0),
 state text not null default 'prepared' check(state in ('prepared','requested','confirmed','failed','inconclusive')),
 created_at timestamptz not null default clock_timestamp(), requested_at timestamptz,
 check(source<>'manual' or actor_id is not null)
);
create unique index pricing_operations_active_group on public.pricing_operations(group_id) where state in ('prepared','requested','inconclusive');
create index pricing_operations_evaluation on public.pricing_operations(evaluation_id);
create index pricing_operations_product on public.pricing_operations(produto_id,created_at desc);
create table public.pricing_events (
 id bigint generated always as identity primary key, created_at timestamptz not null default clock_timestamp(),
 produto_id uuid, item_id text, group_id uuid, group_version integer,
 operation_id uuid references public.pricing_operations(id), evaluation_id uuid references public.pricing_evaluations(id),
 kind text not null check(kind in ('baseline','observed','projection_changed','requested','confirmed','failed','inconclusive')),
 pricing_source text not null check(pricing_source in ('manual','pricing_engine','scheduled_job','catalog_sync','mercado_livre','supplier_sync','migration','unknown')),
 actor_id uuid, reason text not null, rule_id text, job_id uuid,
 previous_price_cents bigint, new_price_cents bigint, observed_at timestamptz,
 projection text, evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object')
);
create index pricing_events_product on public.pricing_events(produto_id,id desc);
create index pricing_events_item on public.pricing_events(item_id,id desc);
create index pricing_events_group on public.pricing_events(group_id,id desc);
create index pricing_events_operation on public.pricing_events(operation_id);
create index pricing_events_evaluation on public.pricing_events(evaluation_id);
create function public.pricing_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'pricing_history_immutable'; end $$;
create trigger pricing_events_immutable before update or delete on public.pricing_events for each row execute function public.pricing_immutable();
create trigger pricing_evaluations_immutable before update or delete on public.pricing_evaluations for each row execute function public.pricing_immutable();

-- Captura toda projeção, inclusive runtime antigo/SQL sem contexto. Isso não prova efeito remoto.
create function public.capture_pricing_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare
 n jsonb:=to_jsonb(new); o jsonb; col text:=tg_argv[0]; ctx jsonb;
 prev bigint; next_price bigint; item text; product uuid; last_event public.pricing_events%rowtype;
 kind text; origin text; observed timestamptz; gid uuid; gv integer; already_exists boolean; watermark timestamptz;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 prev:=round((o->>col)::numeric*100); next_price:=round((n->>col)::numeric*100);
 ctx:=nullif(current_setting('vortek.pricing_observation',true),'')::jsonb;
 item:=n->>'ml_item_id'; product:=case when tg_table_name='produtos' then (n->>'id')::uuid else (n->>'produto_id')::uuid end;
 if tg_op='INSERT' then
   execute format('select exists(select 1 from public.%I where %I::text=$1)',tg_table_name,case when tg_table_name='produtos' then 'id' else 'ml_item_id' end)
   into already_exists using case when tg_table_name='produtos' then n->>'id' else item end;
   if already_exists then return new; end if;
 end if;
 if ctx->>'item_id'=item and ctx->>'has_price'='false' then return new; end if;
 origin:=case when ctx->>'item_id'=item then 'mercado_livre' else 'unknown' end;
 kind:=case when origin='unknown' then 'projection_changed' else 'observed' end;
 if origin='mercado_livre' then
   observed:=(ctx->>'observed_at')::timestamptz;
   select * into last_event from public.pricing_events e where e.item_id=item and e.kind in ('baseline','observed') and e.pricing_source='mercado_livre' order by e.id desc limit 1;
   select max(stamp) into watermark from (select pricing_observed_at stamp from public.anuncios_ml where ml_item_id=item union all select pricing_observed_at from public.catalogo_ml_snapshot where ml_item_id=item) s;
   watermark:=greatest(watermark,last_event.observed_at);
   if last_event.id is not null and observed < watermark then
     new:=jsonb_populate_record(new,jsonb_build_object(col,case when tg_op='UPDATE' then o->col else to_jsonb(last_event.new_price_cents::numeric/100) end,'pricing_observed_at',watermark));
     return new;
   end if;
   if last_event.id is not null and observed=watermark and next_price is distinct from last_event.new_price_cents then
     if not exists(select 1 from public.pricing_events e where e.item_id=item and e.kind='inconclusive' and e.observed_at=observed and e.new_price_cents is not distinct from next_price) then
       insert into public.pricing_events(produto_id,item_id,kind,pricing_source,reason,previous_price_cents,new_price_cents,observed_at)
       values(product,item,'inconclusive',origin,'conflicting_observation_timestamp',last_event.new_price_cents,next_price,observed);
     end if;
     new:=jsonb_populate_record(new,jsonb_build_object(col,case when tg_op='UPDATE' then o->col else to_jsonb(last_event.new_price_cents::numeric/100) end,'pricing_observed_at',watermark));
     return new;
   end if;
   new:=jsonb_populate_record(new,jsonb_build_object('pricing_observed_at',observed));
   if last_event.id is not null and next_price is not distinct from last_event.new_price_cents then return new; end if;
   prev:=last_event.new_price_cents;
   if last_event.id is null then kind:='baseline'; end if;
 else
   if tg_op='UPDATE' and prev is not distinct from next_price then return new; end if;
   if tg_op='INSERT' and next_price is null then return new; end if;
 end if;
 select min(g.id::text)::uuid,min(g.current_version) into gid,gv from public.ml_pricing_groups g
 join public.ml_pricing_group_members m on m.group_id=g.id and m.version=g.current_version and m.is_current
 where m.ml_item_id=item and g.produto_id=product and g.state='verified' having count(*)=1;
 insert into public.pricing_events(produto_id,item_id,group_id,group_version,kind,pricing_source,reason,previous_price_cents,new_price_cents,observed_at,projection,evidence)
 values(product,item,gid,gv,kind,origin,case when origin='unknown' then 'unattributed_local_projection' else 'ml_price_observed' end,
 prev,next_price,observed,tg_table_name,jsonb_build_object('reference',case when origin='mercado_livre' then ctx->>'reference' else tg_table_name||'.'||col end));
 return new;
end $$;
create trigger pricing_capture_product before insert or update of custom_price on public.produtos for each row execute function public.capture_pricing_projection('custom_price');
create trigger pricing_capture_listing before insert or update of preco_ml on public.anuncios_ml for each row execute function public.capture_pricing_projection('preco_ml');
create trigger pricing_capture_catalog before insert or update of price on public.catalogo_ml_snapshot for each row execute function public.capture_pricing_projection('price');

-- Única escrita observacional: lotes limitados, locks ordenados antes das linhas e contexto só transacional.
create function public.persist_ml_pricing_observations(p_table text,p_rows jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row jsonb; cols text; vals text; updates text; output jsonb; results jsonb:='[]'; previous_context text; present boolean;
begin
 if p_table not in ('anuncios_ml','catalogo_ml_snapshot') or p_table is null or jsonb_typeof(p_rows) is distinct from 'array'
 or jsonb_array_length(p_rows)>200 or p_observed_at is null or p_observed_at>clock_timestamp()+interval '1 minute' then raise exception 'invalid_pricing_observation'; end if;
 previous_context:=current_setting('vortek.pricing_observation',true);
 for row in select value from jsonb_array_elements(p_rows) order by value->>'ml_item_id' loop
   if nullif(row->>'ml_item_id','') is null then raise exception 'missing_pricing_item'; end if;
   if row ? 'pricing_observed_at' then raise exception 'pricing_watermark_is_server_owned'; end if;
   if row ? (case when p_table='anuncios_ml' then 'preco_ml' else 'price' end) then
     if (row->>case when p_table='anuncios_ml' then 'preco_ml' else 'price' end)::numeric is null or (row->>case when p_table='anuncios_ml' then 'preco_ml' else 'price' end)::numeric<=0 then raise exception 'invalid_observed_price'; end if;
   end if;
   perform pg_advisory_xact_lock(hashtextextended('pricing-item:'||(row->>'ml_item_id'),0));
 end loop;
 for row in select value from jsonb_array_elements(p_rows) loop
   if exists(select 1 from jsonb_object_keys(row) k where not exists(select 1 from pg_attribute a where a.attrelid=('public.'||p_table)::regclass and a.attname=k and a.attnum>0 and not a.attisdropped)) then raise exception 'invalid_projection_column'; end if;
   perform set_config('vortek.pricing_observation',jsonb_build_object('item_id',row->>'ml_item_id','has_price',row ? case when p_table='anuncios_ml' then 'preco_ml' else 'price' end,'observed_at',coalesce(nullif(row->>'last_updated_ml','')::timestamptz,p_observed_at),'reference','items/'||(row->>'ml_item_id'))::text,true);
   select string_agg(format('%I',k),',' order by k),string_agg(format('x.%I',k),',' order by k),string_agg(format('%I=excluded.%I',k,k),',' order by k) filter(where k not in ('id','ml_item_id')) into cols,vals,updates from jsonb_object_keys(row) k;
   execute format('select exists(select 1 from public.%I where ml_item_id=$1)',p_table) into present using row->>'ml_item_id';
   if present then
     execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) excluded where t.ml_item_id=excluded.ml_item_id returning to_jsonb(t.*)',p_table,coalesce(updates,'ml_item_id=excluded.ml_item_id'),p_table) into output using row;
   else
     execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) x on conflict(ml_item_id) do update set %s returning to_jsonb(%I.*)',p_table,cols,vals,p_table,coalesce(updates,'ml_item_id=excluded.ml_item_id'),p_table) into output using row;
   end if;
   results:=results||jsonb_build_array(output);
 end loop;
 perform set_config('vortek.pricing_observation',coalesce(previous_context,''),true);
 return results;
end $$;

create function public.prepare_pricing_operation(p_id uuid,p_evaluation_id uuid,p_group_id uuid,p_group_version integer,p_item_id text,p_price_cents bigint,p_source text,p_actor_id uuid,p_reason text,p_rule_id text default null,p_job_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare evaluation public.pricing_evaluations%rowtype; existing public.pricing_operations%rowtype; baseline bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('pricing-operation:'||p_id::text,0));
 select * into existing from public.pricing_operations where id=p_id;
 if existing.id is not null then
   if row(existing.evaluation_id,existing.group_id,existing.group_version,existing.item_id,existing.new_price_cents,existing.source,existing.actor_id,existing.reason,existing.rule_id,existing.job_id)
   is distinct from row(p_evaluation_id,p_group_id,p_group_version,p_item_id,p_price_cents,p_source,p_actor_id,p_reason,p_rule_id,p_job_id) then raise exception 'pricing_idempotency_conflict'; end if;
   return existing.id;
 end if;
 select * into evaluation from public.pricing_evaluations where id=p_evaluation_id;
 if evaluation.id is null or not exists(select 1 from public.ml_pricing_groups g join public.ml_pricing_group_members m on m.group_id=g.id and m.version=g.current_version and m.is_current where g.id=p_group_id and g.current_version=p_group_version and g.state='verified' and g.produto_id=evaluation.produto_id and m.ml_item_id=p_item_id) then raise exception 'pricing_group_not_valid'; end if;
 select new_price_cents into baseline from public.pricing_events where item_id=p_item_id and kind in ('observed','baseline') and pricing_source='mercado_livre' order by id desc limit 1;
 if baseline is null then raise exception 'pricing_baseline_missing'; end if;
 insert into public.pricing_operations(id,evaluation_id,produto_id,group_id,group_version,source,actor_id,reason,rule_id,job_id,item_id,previous_price_cents,new_price_cents)
 values(p_id,p_evaluation_id,evaluation.produto_id,p_group_id,p_group_version,p_source,p_actor_id,p_reason,p_rule_id,p_job_id,p_item_id,baseline,p_price_cents);
 return p_id;
end $$;

create function public.transition_pricing_operation(p_id uuid,p_state text,p_evidence jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.pricing_operations%rowtype; observed timestamptz;
begin
 select * into op from public.pricing_operations where id=p_id for update;
 if op.id is null then raise exception 'pricing_operation_missing'; end if;
 if op.state=p_state then return jsonb_build_object('applied',false,'state',op.state); end if;
 if not ((op.state='prepared' and p_state in ('requested','failed')) or (op.state='requested' and p_state in ('confirmed','failed','inconclusive')) or (op.state='inconclusive' and p_state in ('confirmed','failed'))) then raise exception 'invalid_pricing_transition'; end if;
 if p_state in ('requested','confirmed') and not exists(select 1 from public.ml_pricing_groups where id=op.group_id and current_version=op.group_version and state='verified') then raise exception 'pricing_group_changed'; end if;
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
 jsonb_strip_nulls(jsonb_build_object('reference',left(p_evidence->>'reference',200),'outcome',case when p_state='confirmed' then 'readback_verified' else null end)));
 if p_state='confirmed' then
   insert into public.pricing_events(produto_id,item_id,group_id,group_version,operation_id,evaluation_id,kind,pricing_source,actor_id,reason,previous_price_cents,new_price_cents,observed_at)
   select op.produto_id,m.ml_item_id,op.group_id,op.group_version,op.id,op.evaluation_id,'confirmed','catalog_sync',null,'verified_catalog_propagation',null,op.new_price_cents,observed
   from public.ml_pricing_group_members m join public.ml_pricing_group_revisions r on r.group_id=m.group_id and r.version=m.version
   where m.group_id=op.group_id and m.version=op.group_version and m.ml_item_id<>op.item_id and r.catalog_synchronized_pair;
 end if;
 return jsonb_build_object('applied',true,'state',p_state);
end $$;

alter table public.pricing_evaluations enable row level security;
alter table public.pricing_operations enable row level security;
alter table public.pricing_events enable row level security;
revoke all on public.pricing_evaluations,public.pricing_operations,public.pricing_events from anon,authenticated,service_role;
grant select,insert on public.pricing_evaluations to service_role;
grant select on public.pricing_operations,public.pricing_events to service_role;
revoke all on function public.pricing_immutable(), public.capture_pricing_projection(), public.persist_ml_pricing_observations(text,jsonb,timestamptz), public.prepare_pricing_operation(uuid,uuid,uuid,integer,text,bigint,text,uuid,text,text,uuid), public.transition_pricing_operation(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.persist_ml_pricing_observations(text,jsonb,timestamptz), public.prepare_pricing_operation(uuid,uuid,uuid,integer,text,bigint,text,uuid,text,text,uuid), public.transition_pricing_operation(uuid,text,jsonb) to service_role;
