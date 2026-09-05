begin;
set local lock_timeout='5s';
create or replace function public.save_radar_batch(p_job_id uuid,p_owner_token text,p_rows jsonb,p_checkpoint jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_row jsonb;
begin
  perform 1 from public.sync_domain_locks where domain='radar:ml' and owner_token=p_owner_token and expires_at>now() for update;
  if not found then raise exception 'RADAR_LOCK_LOST'; end if;
  perform 1 from public.jobs where id=p_job_id and tipo='sync_ml_radar' and not cancelado for update;
  if not found then raise exception 'RADAR_JOB_INVALID'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    insert into public.pricing_events(event_type,produto_id,pricing_group_id,pricing_source,actor,reason,rule_id,job_id,dedupe_key,payload)
    select 'RADAR_CLASSIFIED',(v_row->>'produto_id')::uuid,v_row->>'pricing_group_id','radar','job:'||p_job_id,v_row->>'recommendation',coalesce((select pricing_policy->>'version' from public.configuracoes limit 1),'M2M-PRC-01-v1'),p_job_id,'radar:'||(v_row->>'candidate_key')||':'||(v_row->>'input_fingerprint'),jsonb_build_object('assessment',v_row->'assessment','stage',v_row->>'stage','queue',v_row->>'queue')
    where not exists(select 1 from public.radar_oportunidades r where r.candidate_key=v_row->>'candidate_key' and (r.input_fingerprint=v_row->>'input_fingerprint' or r.processed_at>(p_checkpoint->>'startedAt')::timestamptz))
    on conflict(dedupe_key) do nothing;
    insert into public.radar_oportunidades (produto_id,candidate_key,sku,catalog_product_id,pricing_group_id,stage,queue,conflict_state,assessment,evidence,priority,recommendation,evaluation_id,target_evaluation_id,floor_evaluation_id,break_even_evaluation_id,input_fingerprint,stock,demand_rank,contribution,job_id)
    values ((v_row->>'produto_id')::uuid,v_row->>'candidate_key',v_row->>'sku',v_row->>'catalog_product_id',v_row->>'pricing_group_id',v_row->>'stage',v_row->>'queue',v_row->>'conflict_state',v_row->'assessment',v_row->'evidence',v_row->'priority',v_row->>'recommendation',(v_row->>'evaluation_id')::uuid,(v_row->>'target_evaluation_id')::uuid,(v_row->>'floor_evaluation_id')::uuid,(v_row->>'break_even_evaluation_id')::uuid,v_row->>'input_fingerprint',(v_row->>'stock')::integer,(v_row->>'demand_rank')::integer,(v_row->>'contribution')::numeric,p_job_id)
    on conflict(candidate_key) do update set
      stage=excluded.stage,queue=excluded.queue,conflict_state=excluded.conflict_state,assessment=excluded.assessment,evidence=excluded.evidence,priority=excluded.priority,recommendation=excluded.recommendation,evaluation_id=excluded.evaluation_id,target_evaluation_id=excluded.target_evaluation_id,floor_evaluation_id=excluded.floor_evaluation_id,break_even_evaluation_id=excluded.break_even_evaluation_id,input_fingerprint=excluded.input_fingerprint,stock=excluded.stock,demand_rank=excluded.demand_rank,contribution=excluded.contribution,job_id=excluded.job_id,pricing_group_id=excluded.pricing_group_id,processed_at=now(),updated_at=now()
    where radar_oportunidades.processed_at <= (p_checkpoint->>'startedAt')::timestamptz;
  end loop;
  update public.jobs set log=coalesce(log,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('event','radar_checkpoint','timestamp',now(),'payload',p_checkpoint)),processados=(p_checkpoint->>'processed')::integer,total=(p_checkpoint->>'processed')::integer+case when (p_checkpoint->>'complete')::boolean then 0 else 1 end,progresso=case when (p_checkpoint->>'complete')::boolean then 100 else 0 end,status=case when (p_checkpoint->>'complete')::boolean then 'completo' else 'on_hold' end,finished_at=case when (p_checkpoint->>'complete')::boolean then now() else null end where id=p_job_id;
end $$;
revoke all on function public.save_radar_batch(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_radar_batch(uuid,text,jsonb,jsonb) to service_role;


create or replace function public.review_radar_candidate(p_id uuid,p_expected_stage text,p_stage text,p_actor text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.radar_oportunidades%rowtype;
begin
 if p_stage not in ('REVISAR','REJEITADO','VALIDADO','AGUARDANDO_APROVACAO') or nullif(trim(p_actor),'') is null or nullif(trim(p_reason),'') is null then raise exception 'REVISAO_INVALIDA'; end if;
 select * into r from public.radar_oportunidades where id=p_id for update;
 if not found or r.stage is distinct from p_expected_stage then raise exception 'RADAR_ALTERADO_CONCORRENTEMENTE'; end if;
 if p_stage='VALIDADO' and (r.stage not in ('PUBLICADO_EXPERIMENTO','REVISAR') or not exists(select 1 from public.anuncios_ml a where a.produto_id=r.produto_id)) then raise exception 'VALIDACAO_EXIGE_EXPERIMENTO'; end if;
 if p_stage='AGUARDANDO_APROVACAO' and r.conflict_state<>'SEM_CONFLITO' then raise exception 'RESOLVER_CONFLITOS_ANTES_DE_APROVAR'; end if;
 insert into public.pricing_events(event_type,produto_id,pricing_group_id,pricing_source,actor,reason,rule_id,payload)
 values('RADAR_REVIEW',r.produto_id,r.pricing_group_id,'manual_review',p_actor,p_reason,'M2M-CFL-01',jsonb_build_object('candidateId',r.id,'previous_stage',r.stage,'stage',p_stage));
 update public.radar_oportunidades set stage=p_stage,queue=case when p_stage in ('REVISAR','REJEITADO') then 'REVISAR' else queue end,processed_at=now(),updated_at=now() where id=r.id;
end $$;
revoke all on function public.review_radar_candidate(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.review_radar_candidate(uuid,text,text,text,text) to service_role;
insert into public.pricing_events(event_type,produto_id,pricing_group_id,pricing_source,actor,reason,rule_id,job_id,dedupe_key,payload)
select 'RADAR_CLASSIFIED',r.produto_id,r.pricing_group_id,'radar_import','migration:M2M-RAD-04',r.recommendation,'M2M-PRC-01-v1',r.job_id,'radar:'||r.candidate_key||':'||r.input_fingerprint,jsonb_build_object('assessment',r.assessment,'stage',r.stage,'queue',r.queue,'imported_at',r.processed_at)
from public.radar_oportunidades r on conflict(dedupe_key) do nothing;
notify pgrst, 'reload schema';
commit;
