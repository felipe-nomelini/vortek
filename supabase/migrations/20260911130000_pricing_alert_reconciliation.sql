set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Uma observação inativa de um grupo recém-confirmado também precisa encerrar
-- alertas antigos por item. A versão anterior saía antes dessa reconciliação
-- quando ainda não existia um alerta canônico para o grupo.
create or replace function public.sync_pricing_alerts(p_evaluation_id uuid,p_observations jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e public.pricing_evaluations%rowtype; c jsonb; r jsonb; a public.pricing_alerts%rowtype;
 subject text; gid uuid; st text; kind text; merged public.pricing_alerts%rowtype;
begin
 select * into e from public.pricing_evaluations where id=p_evaluation_id;
 c:=e.result->'decisionContext'; gid:=(c->>'groupId')::uuid;
 if c is null or c->>'sellerId' is null or (c->>'itemId' is null and c->>'operationKind' is distinct from 'listing_create') or jsonb_typeof(p_observations)<>'array' then raise exception 'decision_evaluation_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ml-pricing-groups:'||(c->>'sellerId'),0));
 if gid is not null and not exists(select 1 from public.ml_pricing_groups where id=gid and produto_id=e.produto_id and seller_id::text=c->>'sellerId') then raise exception 'decision_group_mismatch'; end if;
 subject:=case when c->>'operationKind'='listing_create' then 'product:'||e.produto_id::text when gid is not null then 'group:'||gid::text else 'item:'||(c->>'itemId') end;
 for r in select value from jsonb_array_elements(p_observations) loop
   if r->>'rule' not in ('pricing_group','pricing_evidence','buy_box_economy','manual_proposal','pricing_operation')
      or r->>'severity' not in ('P0','P1','P2','INFO') or jsonb_typeof(r->'active')<>'boolean' then raise exception 'decision_observation_invalid'; end if;
   a:=null;
   select * into a from public.pricing_alerts where seller_id=c->>'sellerId' and subject_key=subject and rule_id=r->>'rule' for update;
   if a.id is not null and a.observed_at>e.created_at then continue; end if;

   if a.id is null and not (r->>'active')::boolean then
     -- Não crie um alerta resolvido vazio. Encerre diretamente cada alerta
     -- histórico do item que agora pertence ao grupo verificado.
     if gid is not null then
       for merged in select old.* from public.pricing_alerts old
         where old.seller_id=c->>'sellerId' and old.rule_id=r->>'rule'
           and old.merged_into is null and old.group_id is null and old.state='open'
           and old.observed_at<=e.created_at
           and exists(select 1 from public.ml_pricing_group_members m join public.ml_pricing_groups g on g.id=m.group_id
             where g.id=gid and g.state='verified' and m.version=g.current_version and m.ml_item_id=old.item_id)
         for update loop
         update public.pricing_alerts set state='resolved',evaluation_id=e.id,fingerprint=c->>'fingerprint',
           observed_at=e.created_at,last_seen_at=clock_timestamp(),updated_at=clock_timestamp(),resolved_at=clock_timestamp()
           where id=merged.id;
         insert into public.pricing_events(produto_id,item_id,group_id,evaluation_id,alert_id,kind,pricing_source,reason,evidence)
         values(e.produto_id,merged.item_id,gid,e.id,merged.id,'alert_resolved','pricing_engine',r->>'reason',
           jsonb_build_object('severity',r->>'severity','state','resolved','rule',r->>'rule','resolvedByVerifiedGroup',true));
       end loop;
     end if;
     continue;
   end if;

   st:=case when (r->>'active')::boolean then 'open' else 'resolved' end;
   kind:=case when a.id is null then 'alert_opened' when a.state<>st then case when st='open' then 'alert_reopened' else 'alert_resolved' end
     when a.fingerprint is distinct from c->>'fingerprint' or a.severity<>r->>'severity' or a.reason<>r->>'reason' then 'alert_updated' else null end;
   if a.id is null then
     insert into public.pricing_alerts(produto_id,seller_id,subject_key,item_id,group_id,rule_id,severity,state,title,reason,evaluation_id,fingerprint,observed_at,last_seen_at)
     values(e.produto_id,c->>'sellerId',subject,c->>'itemId',gid,r->>'rule',r->>'severity',st,left(r->>'title',200),left(r->>'reason',500),e.id,c->>'fingerprint',e.created_at,clock_timestamp()) returning * into a;
   else
     update public.pricing_alerts set state=st,severity=r->>'severity',title=left(r->>'title',200),reason=left(r->>'reason',500),
       evaluation_id=e.id,fingerprint=c->>'fingerprint',observed_at=e.created_at,last_seen_at=clock_timestamp(),
       updated_at=case when kind is null then updated_at else clock_timestamp() end,resolved_at=case when st='resolved' then coalesce(resolved_at,clock_timestamp()) else null end where id=a.id;
   end if;
   if kind is not null then
     insert into public.pricing_events(produto_id,item_id,group_id,evaluation_id,alert_id,kind,pricing_source,reason,evidence)
     values(e.produto_id,c->>'itemId',gid,e.id,a.id,kind,'pricing_engine',r->>'reason',jsonb_build_object('severity',r->>'severity','state',st,'rule',r->>'rule'));
   end if;
   -- Preserve old item histories when a verified group consolidates a synchronized pair.
   if gid is not null then
     for merged in select old.* from public.pricing_alerts old where old.id<>a.id and old.seller_id=c->>'sellerId' and old.rule_id=r->>'rule'
       and old.merged_into is null and old.group_id is null and exists(select 1 from public.ml_pricing_group_members m join public.ml_pricing_groups g on g.id=m.group_id
       where g.id=gid and g.state='verified' and m.version=g.current_version and m.ml_item_id=old.item_id) for update loop
       update public.pricing_alerts set merged_into=a.id,state='resolved',resolved_at=clock_timestamp() where id=merged.id;
       insert into public.pricing_events(produto_id,alert_id,kind,pricing_source,reason,evidence)
       values(e.produto_id,merged.id,'alert_merged','pricing_engine','Grupo sincronizado confirmado',jsonb_build_object('canonicalAlertId',a.id));
     end loop;
   end if;
 end loop;
end $$;

revoke all on function public.sync_pricing_alerts(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sync_pricing_alerts(uuid,jsonb) to service_role;

comment on function public.sync_pricing_alerts(uuid,jsonb) is
  'Reconcilia o estado atual de alertas e encerra observações históricas por item após confirmação do grupo.';

notify pgrst, 'reload schema';
