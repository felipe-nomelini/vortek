-- Executar dentro de BEGIN/ROLLBACK depois das migrations M2M.
do $$
declare j uuid:=gen_random_uuid(); token text:=gen_random_uuid()::text; p record; payload jsonb; checkpoint jsonb; n integer; r_id uuid;
begin
 select id,sku into p from public.produtos order by id limit 1;
 insert into public.jobs(id,tipo,status,log) values(j,'sync_ml_radar','pendente','[]');
 if not public.acquire_sync_domain_lock('radar:ml','validation',token,j,300,'{}') then raise exception 'LOCK_UNAVAILABLE'; end if;
 if public.acquire_sync_domain_lock('radar:ml','validation','second-owner',j,300,'{}') then raise exception 'DUPLICATE_OWNER_ALLOWED'; end if;
 payload:=jsonb_build_array(jsonb_build_object('produto_id',p.id,'sku',p.sku,'candidate_key','validation:'||p.id,'stage','INCONCLUSIVO','queue','INCONCLUSIVOS','conflict_state','INCONCLUSIVO','assessment','{}'::jsonb,'evidence','{}'::jsonb,'priority','{}'::jsonb,'recommendation','validation','input_fingerprint','validation','stock',0,'demand_rank',3));
 checkpoint:=jsonb_build_object('startedAt',now(),'processed',1,'complete',false,'lastId',p.id);
 perform public.save_radar_batch(j,token,payload,checkpoint);
 perform public.save_radar_batch(j,token,payload,checkpoint);
 select count(*) into n from public.radar_oportunidades where candidate_key='validation:'||p.id;
 if n<>1 then raise exception 'DEDUPE_FAILED'; end if;
 if not exists(select 1 from public.jobs where id=j and status='on_hold' and processados=1 and jsonb_array_length(log)=2) then raise exception 'CHECKPOINT_FAILED'; end if;
 update public.sync_domain_locks set expires_at=now()-interval '1 second' where domain='radar:ml';
 begin
  perform public.save_radar_batch(j,token,payload,checkpoint);
  raise exception 'EXPIRED_LOCK_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'RADAR_LOCK_LOST' then raise; end if; end;
 select id into r_id from public.radar_oportunidades where candidate_key='validation:'||p.id;
 perform public.review_radar_candidate(r_id,'INCONCLUSIVO','REVISAR','validation','Revisão explícita de teste');
 begin
  perform public.review_radar_candidate(r_id,'INCONCLUSIVO','REJEITADO','validation','Etapa antiga');
  raise exception 'STALE_REVIEW_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'RADAR_ALTERADO_CONCORRENTEMENTE' then raise; end if; end;
 if not exists(select 1 from public.pricing_events where event_type='RADAR_REVIEW' and payload->>'candidateId'=r_id::text) then raise exception 'REVIEW_NOT_AUDITED'; end if;
 if has_table_privilege('service_role','public.pricing_events','UPDATE') or has_table_privilege('service_role','public.pricing_evaluations','DELETE') then raise exception 'AUDIT_MUTABLE'; end if;
 if has_table_privilege('authenticated','public.pricing_events','SELECT') then raise exception 'AUDIT_EXPOSED'; end if;
end $$;
select 'M2M_SQL_PASS' as evidence;
