-- M2M-PRC-02 / CFL / RAD: memória canônica, sem reescrever histórico.
begin;
set local lock_timeout='5s';
alter table public.configuracoes add column if not exists pricing_policy jsonb;
alter table public.configuracoes add column if not exists pricing_tax_config jsonb not null default '{}';
alter table public.anuncios_ml add column if not exists pricing_group_id text;
alter table public.anuncios_ml add column if not exists catalog_synchronized_pair boolean not null default false;
alter table public.anuncios_ml add column if not exists pricing_group_evidence jsonb;
create index if not exists anuncios_ml_pricing_group_idx on public.anuncios_ml(pricing_group_id);

create table if not exists public.pricing_evaluations (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete restrict,
  ml_item_id text,
  pricing_group_id text,
  scenario text not null check (scenario in ('current','target','floor','break_even','competitive','manual')),
  fingerprint text not null unique,
  policy_version text not null,
  product_version timestamptz not null,
  offer_id uuid references public.produto_fornecedor_ofertas(id) on delete restrict,
  offer_version timestamptz,
  memory jsonb not null,
  price numeric,
  result numeric,
  margin numeric,
  status text not null check (status in ('available','estimated','inconclusive')),
  evaluated_at timestamptz not null,
  valid_until timestamptz not null,
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  check (price is null or price > 0)
);
create index if not exists pricing_evaluations_product_latest_idx on public.pricing_evaluations(produto_id, scenario, evaluated_at desc);
create index if not exists pricing_evaluations_item_latest_idx on public.pricing_evaluations(ml_item_id, scenario, evaluated_at desc);
create index if not exists pricing_evaluations_offer_idx on public.pricing_evaluations(offer_id);
create index if not exists pricing_evaluations_job_idx on public.pricing_evaluations(job_id);

create table if not exists public.pricing_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  produto_id uuid references public.produtos(id) on delete restrict,
  ml_item_id text,
  pricing_group_id text,
  evaluation_id uuid references public.pricing_evaluations(id) on delete restrict,
  pricing_source text not null,
  actor text not null,
  reason text not null,
  previous_price numeric,
  new_price numeric,
  rule_id text not null,
  job_id uuid references public.jobs(id) on delete set null,
  dedupe_key text unique,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists pricing_events_group_time_idx on public.pricing_events(pricing_group_id,created_at desc);
create index if not exists pricing_events_product_time_idx on public.pricing_events(produto_id,created_at desc);
create index if not exists pricing_events_evaluation_idx on public.pricing_events(evaluation_id);
create index if not exists pricing_events_job_idx on public.pricing_events(job_id);

create table if not exists public.radar_oportunidades (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete restrict,
  candidate_key text not null unique,
  sku text not null,
  catalog_product_id text,
  pricing_group_id text,
  stage text not null,
  queue text not null,
  conflict_state text not null check (conflict_state in ('SEM_CONFLITO','CONFLITO_CONFIRMADO','PENDENCIA_VALIDACAO','INCONCLUSIVO')),
  assessment jsonb not null,
  evidence jsonb not null,
  priority jsonb not null,
  recommendation text not null,
  evaluation_id uuid references public.pricing_evaluations(id) on delete restrict,
  target_evaluation_id uuid references public.pricing_evaluations(id) on delete restrict,
  floor_evaluation_id uuid references public.pricing_evaluations(id) on delete restrict,
  break_even_evaluation_id uuid references public.pricing_evaluations(id) on delete restrict,
  input_fingerprint text not null,
  stock integer not null default 0,
  demand_rank integer not null default 3,
  contribution numeric,
  job_id uuid references public.jobs(id) on delete set null,
  processed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_queue_priority_idx on public.radar_oportunidades(queue,demand_rank,contribution desc nulls last,stock desc,sku);
create index if not exists radar_product_idx on public.radar_oportunidades(produto_id);
create index if not exists radar_job_idx on public.radar_oportunidades(job_id);

alter table public.pricing_evaluations enable row level security;
alter table public.pricing_events enable row level security;
alter table public.radar_oportunidades enable row level security;
revoke all on public.pricing_evaluations, public.pricing_events, public.radar_oportunidades from public, anon, authenticated, service_role;
grant select, insert on public.pricing_evaluations, public.pricing_events to service_role;
grant select, insert, update on public.radar_oportunidades to service_role;

-- Esta projeção não calcula economia: apenas seleciona a memória ainda compatível.
create or replace view public.current_pricing_evaluations with (security_invoker = true) as
select distinct on (e.produto_id, coalesce(e.ml_item_id,''), e.scenario) e.*
from public.pricing_evaluations e
join public.produtos p on p.id=e.produto_id
left join public.produto_fornecedor_ofertas o on o.id=e.offer_id
where e.valid_until>now()
  and (e.offer_id is null or (o.ativo and o.custo=(e.memory->>'cost')::numeric and p.oferta_preferencial_id=e.offer_id and exists (select 1 from public.fornecedores f where f.dslite_id=o.dslite_fornecedor_id and f.ativo)))
  and (e.scenario<>'current' or exists (select 1 from public.anuncios_ml a where a.ml_item_id=e.ml_item_id and a.produto_id=e.produto_id and a.preco_ml=e.price))
  and e.memory#>>'{tax,referenceMonth}'=to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM')
  and e.policy_version=coalesce((select c.pricing_policy->>'version' from public.configuracoes c limit 1),'M2M-PRC-01-v1')
order by e.produto_id,coalesce(e.ml_item_id,''),e.scenario,e.evaluated_at desc,e.id;
revoke all on public.current_pricing_evaluations from anon,authenticated;
grant select on public.current_pricing_evaluations to service_role;

-- A posse do lock é conferida na mesma transação que grava o lote/checkpoint.
create or replace function public.save_radar_batch(p_job_id uuid,p_owner_token text,p_rows jsonb,p_checkpoint jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_row jsonb;
begin
  perform 1 from public.sync_domain_locks where domain='radar:ml' and owner_token=p_owner_token and expires_at>now() for update;
  if not found then raise exception 'RADAR_LOCK_LOST'; end if;
  perform 1 from public.jobs where id=p_job_id and tipo='sync_ml_radar' and not cancelado for update;
  if not found then raise exception 'RADAR_JOB_INVALID'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
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

create or replace function public.pricing_monthly_revenue(p_start date,p_reference date)
returns table(month text,revenue numeric) language sql stable security definer set search_path=public as $$
  select to_char(m,'YYYY-MM'),coalesce(sum(p.operational_total),0)
  from generate_series(date_trunc('month',p_start),date_trunc('month',p_reference),interval '1 month') m
  left join public.pedidos_operacionais p on p.data_venda >= m and p.data_venda < m+interval '1 month' and p.situacao <> 'cancelado'
  group by m order by m
$$;
revoke all on function public.pricing_monthly_revenue(date,date) from public,anon,authenticated;
grant execute on function public.pricing_monthly_revenue(date,date) to service_role;

create or replace function public.update_canonical_pricing_config(p_policy jsonb,p_tax jsonb,p_expected_version text,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.configuracoes%rowtype;
begin
  select * into c from public.configuracoes limit 1 for update;
  if not found then raise exception 'CONFIGURACAO_INEXISTENTE'; end if;
  if p_policy is null or p_tax is null or p_expected_version is null or nullif(trim(p_actor),'') is null or nullif(trim(p_reason),'') is null then raise exception 'CONFIGURACAO_INVALIDA'; end if;
  if coalesce(c.pricing_policy->>'version','M2M-PRC-01-v1') <> p_expected_version then raise exception 'CONFIGURACAO_ALTERADA_CONCORRENTEMENTE'; end if;
  if p_policy->>'autonomy' is distinct from 'REQUIRES_CONFIRMATION' or p_policy#>>'{radar,mode}' is distinct from 'AUTO_OBSERVE' then raise exception 'AUTONOMIA_NAO_HOMOLOGADA'; end if;
  insert into public.pricing_events(event_type,pricing_source,actor,reason,rule_id,payload)
  values ('CONFIG_CHANGED','settings',p_actor,p_reason,p_policy->>'version',jsonb_build_object('previous_policy',c.pricing_policy,'policy',p_policy,'previous_tax',c.pricing_tax_config,'tax',p_tax));
  update public.configuracoes set pricing_policy=p_policy,pricing_tax_config=p_tax,updated_at=now() where id=c.id;
  return jsonb_build_object('pricing_policy',p_policy,'pricing_tax_config',p_tax,'impact','SIMULACAO_REQUERIDA');
end $$;
revoke all on function public.update_canonical_pricing_config(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.update_canonical_pricing_config(jsonb,jsonb,text,text,text) to service_role;
-- Início já auditado em oportunidades-ml/base.json e analise.cjs; somente estimativa.
update public.configuracoes set pricing_tax_config=jsonb_build_object('activityStartDate','2026-03-23','source','auditoria-pricing-adaptativo-2026-09-04 / oportunidades-ml-2026-09-05','variableCosts','{}'::jsonb) where pricing_tax_config='{}'::jsonb;
notify pgrst, 'reload schema';
commit;
