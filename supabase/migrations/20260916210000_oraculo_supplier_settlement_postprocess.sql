-- ORC-04: efeitos externos duraveis; nao ativa os writers do Oraculo.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.supplier_settlement_resume_effects (
  settlement_id uuid not null references public.supplier_settlements(id) on delete restrict,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','dispatching','accepted','done','skipped','failed','uncertain')),
  child_job_id uuid references public.jobs(id) on delete restrict,
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (settlement_id, pedido_id)
);

create table if not exists public.supplier_settlement_communications (
  id uuid primary key default gen_random_uuid(),
  selection_key text not null unique check (selection_key ~ '^[0-9a-f]{64}$'),
  contact_phone text not null check (contact_phone ~ '^[0-9]{10,15}$'),
  body text not null check (char_length(body) between 1 and 10000),
  status text not null default 'draft'
    check (status in ('draft','approved','sending','sent','failed','uncertain')),
  version integer not null default 1 check (version > 0),
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  reviewed_by text,
  reviewed_at timestamptz,
  message_id text,
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  sent_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.supplier_settlement_communication_members (
  communication_id uuid not null references public.supplier_settlement_communications(id) on delete restrict,
  settlement_id uuid not null unique references public.supplier_settlements(id) on delete restrict,
  primary key (communication_id, settlement_id)
);

create table if not exists public.supplier_oracle_manual_decisions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('resume','communication','job')),
  target_id text not null,
  decision text not null,
  actor text not null,
  note text not null check (char_length(note) between 10 and 500),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists supplier_oracle_resume_status_idx
  on public.supplier_settlement_resume_effects (status, updated_at)
  where status in ('pending','dispatching','accepted','failed','uncertain');
create index if not exists supplier_oracle_communication_status_idx
  on public.supplier_settlement_communications (status, updated_at)
  where status in ('draft','approved','sending','failed','uncertain');
create index if not exists supplier_oracle_manual_decisions_target_idx
  on public.supplier_oracle_manual_decisions (target_type, target_id text_pattern_ops, created_at desc);

alter table public.supplier_settlement_resume_effects enable row level security;
alter table public.supplier_settlement_communications enable row level security;
alter table public.supplier_settlement_communication_members enable row level security;
alter table public.supplier_oracle_manual_decisions enable row level security;
revoke all on public.supplier_settlement_resume_effects,
  public.supplier_settlement_communications,
  public.supplier_settlement_communication_members,
  public.supplier_oracle_manual_decisions from public, anon, authenticated, service_role;
grant select, insert, update on public.supplier_settlement_resume_effects,
  public.supplier_settlement_communications,
  public.supplier_settlement_communication_members to service_role;
grant select on public.supplier_oracle_manual_decisions to service_role;

create or replace function public.supplier_oracle_communication_draft(
  p_ids uuid[], p_selection_key text, p_body text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  row_data record;
  existing public.supplier_settlement_communications%rowtype;
  contact text;
  communication_id uuid;
  row_count integer := 0;
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) < 1 or pg_catalog.cardinality(p_ids) > 20
    or p_selection_key !~ '^[0-9a-f]{64}$' or pg_catalog.length(p_body) not between 1 and 10000
    or pg_catalog.btrim(p_actor) = '' then
    raise exception 'Rascunho inválido' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(distinct x order by x) into ids from pg_catalog.unnest(p_ids) as x;
  if pg_catalog.cardinality(ids) <> pg_catalog.cardinality(p_ids) then
    raise exception 'Liquidações repetidas' using errcode = '22023';
  end if;
  select * into existing from public.supplier_settlement_communications
    where selection_key = p_selection_key;
  if found then
    return pg_catalog.jsonb_build_object('id',existing.id,'status',existing.status,
      'version',existing.version,'replayed',true);
  end if;
  for row_data in select s.id, s.status,
      pg_catalog.regexp_replace(coalesce(s.contact_phone_snapshot,''),'[^0-9]','','g') as phone
      from public.supplier_settlements s where s.id = any(ids) order by s.id for update loop
    row_count := row_count + 1;
    if row_data.status <> 'confirmed' or pg_catalog.length(row_data.phone) not between 10 and 15 then
      raise exception 'Liquidação sem confirmação ou contato válido' using errcode = '23514';
    end if;
    if contact is null then contact := row_data.phone;
    elsif contact <> row_data.phone then
      raise exception 'Contatos diferentes' using errcode = '23514';
    end if;
  end loop;
  if row_count <> pg_catalog.cardinality(ids) then
    raise exception 'Liquidação não encontrada' using errcode = 'P0002';
  end if;
  select * into existing from public.supplier_settlement_communications
    where selection_key = p_selection_key;
  if found then
    return pg_catalog.jsonb_build_object('id',existing.id,'status',existing.status,
      'version',existing.version,'replayed',true);
  end if;
  if exists (select 1 from public.supplier_settlement_communication_members m
    where m.settlement_id = any(ids)) then
    raise exception 'Liquidação já reservada para comunicação' using errcode = '23505';
  end if;
  insert into public.supplier_settlement_communications
    (selection_key,contact_phone,body,created_by)
    values (p_selection_key,contact,p_body,p_actor) returning id into communication_id;
  insert into public.supplier_settlement_communication_members (communication_id,settlement_id)
    select communication_id,x from pg_catalog.unnest(ids) as x;
  return pg_catalog.jsonb_build_object('id',communication_id,'status','draft',
    'version',1,'replayed',false);
end;
$$;

create or replace function public.supplier_oracle_communication_approve(
  p_id uuid, p_expected_version integer, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  communication public.supplier_settlement_communications%rowtype;
begin
  select * into communication from public.supplier_settlement_communications
    where id = p_id for update;
  if not found then raise exception 'Comunicação não encontrada' using errcode = 'P0002'; end if;
  if communication.status <> 'draft' or communication.version <> p_expected_version then
    raise exception 'Rascunho alterado ou já aprovado' using errcode = '23514';
  end if;
  update public.supplier_settlement_communications
    set status = 'approved',version = version + 1,reviewed_by = p_actor,
      reviewed_at = pg_catalog.clock_timestamp(),updated_at = pg_catalog.clock_timestamp()
    where id = p_id;
  insert into public.jobs (tipo,status,total,unidade_progresso,created_by,dedupe_key)
    values ('supplier_settlement_communication','pendente',1,'execucao',
      p_actor::uuid,'supplier_settlement_communication:' || p_id::text);
  return pg_catalog.jsonb_build_object('id',p_id,'status','approved',
    'version',communication.version + 1);
end;
$$;

create or replace function public.supplier_oracle_claim_job(p_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claimed record;
begin
  if p_type not in ('supplier_settlement_postprocess','supplier_settlement_communication') then
    raise exception 'Tipo de job inválido' using errcode = '22023';
  end if;
  with next_job as (
    select id from public.jobs where tipo = p_type and status = 'pendente'
      order by created_at,id limit 1 for update skip locked
  )
  update public.jobs j set status = 'rodando',
    log = coalesce(j.log,'[]'::jsonb) || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('event','supplier_oracle_job_claimed','at',pg_catalog.clock_timestamp()))
    from next_job where j.id = next_job.id
    returning j.id,j.dedupe_key into claimed;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('id',claimed.id,'dedupe_key',claimed.dedupe_key);
end;
$$;

create or replace function public.supplier_oracle_resolve_resume(
  p_settlement_id uuid, p_pedido_id uuid, p_decision text, p_note text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare effect public.supplier_settlement_resume_effects%rowtype;
declare job_id uuid;
declare next_status text;
begin
  if p_decision not in ('already_occurred','not_occurred')
    or pg_catalog.length(pg_catalog.btrim(p_note)) not between 10 and 500 then
    raise exception 'Decisão ou justificativa inválida' using errcode = '22023';
  end if;
  select * into effect from public.supplier_settlement_resume_effects
    where settlement_id = p_settlement_id and pedido_id = p_pedido_id for update;
  if not found then raise exception 'Efeito não encontrado' using errcode = 'P0002'; end if;
  if effect.status not in ('failed','uncertain') then
    raise exception 'Efeito não aguarda decisão' using errcode = '23514';
  end if;
  next_status := case when p_decision = 'already_occurred' then 'done' else 'pending' end;
  update public.supplier_settlement_resume_effects
    set status = next_status,error_code = null,updated_at = pg_catalog.clock_timestamp()
    where settlement_id = p_settlement_id and pedido_id = p_pedido_id;
  insert into public.supplier_oracle_manual_decisions(target_type,target_id,decision,actor,note)
    values ('resume',p_settlement_id::text || ':' || p_pedido_id::text,p_decision,p_actor,p_note);
  select id into job_id from public.jobs where tipo = 'supplier_settlement_postprocess'
    and dedupe_key = 'supplier_settlement_postprocess:' || p_settlement_id::text
    order by created_at desc limit 1 for update;
  if job_id is not null then
    update public.jobs set status = 'pendente',finished_at = null,
      log = coalesce(log,'[]'::jsonb) || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('event','manual_resolution','at',pg_catalog.clock_timestamp(),
          'pedido_id',p_pedido_id,'decision',p_decision,'actor',p_actor))
      where id = job_id;
  end if;
  return pg_catalog.jsonb_build_object('status',next_status,'job_id',job_id);
end;
$$;

create or replace function public.supplier_oracle_resolve_communication(
  p_id uuid, p_decision text, p_note text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare communication public.supplier_settlement_communications%rowtype;
declare job_id uuid;
declare next_status text;
begin
  if p_decision not in ('sent','not_sent')
    or pg_catalog.length(pg_catalog.btrim(p_note)) not between 10 and 500 then
    raise exception 'Decisão ou justificativa inválida' using errcode = '22023';
  end if;
  select * into communication from public.supplier_settlement_communications
    where id = p_id for update;
  if not found then raise exception 'Comunicação não encontrada' using errcode = 'P0002'; end if;
  if communication.status not in ('failed','uncertain') then
    raise exception 'Comunicação não aguarda decisão' using errcode = '23514';
  end if;
  next_status := case when p_decision = 'sent' then 'sent' else 'approved' end;
  update public.supplier_settlement_communications
    set status = next_status, error_code = null,
      sent_at = case when p_decision = 'sent' then pg_catalog.clock_timestamp() else null end,
      updated_at = pg_catalog.clock_timestamp()
    where id = p_id;
  insert into public.supplier_oracle_manual_decisions(target_type,target_id,decision,actor,note)
    values ('communication',p_id::text,p_decision,p_actor,p_note);
  select id into job_id from public.jobs where tipo = 'supplier_settlement_communication'
    and dedupe_key = 'supplier_settlement_communication:' || p_id::text
    order by created_at desc limit 1 for update;
  if job_id is not null then
    update public.jobs set status = case when p_decision = 'sent' then 'completo' else 'pendente' end,
      finished_at = case when p_decision = 'sent' then pg_catalog.clock_timestamp() else null end,
      log = coalesce(log,'[]'::jsonb) || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('event','manual_resolution','at',pg_catalog.clock_timestamp(),
          'decision',p_decision,'actor',p_actor))
      where id = job_id;
  end if;
  return pg_catalog.jsonb_build_object('status',next_status,'job_id',job_id);
end;
$$;

create or replace function public.supplier_oracle_requeue_job(
  p_job_id uuid, p_note text, p_actor text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.jobs%rowtype;
declare target_id uuid;
declare communication_status text;
begin
  if pg_catalog.length(pg_catalog.btrim(p_note)) not between 10 and 500 then
    raise exception 'Justificativa inválida' using errcode = '22023';
  end if;
  select * into job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job não encontrado' using errcode = 'P0002'; end if;
  if job.status <> 'on_hold' or job.tipo not in
    ('supplier_settlement_postprocess','supplier_settlement_communication') then
    raise exception 'Job não aguarda reprocessamento' using errcode = '23514';
  end if;
  target_id := pg_catalog.split_part(job.dedupe_key,':',2)::uuid;
  if job.tipo = 'supplier_settlement_postprocess' and exists (
    select 1 from public.supplier_settlement_resume_effects
      where settlement_id = target_id and status in ('failed','uncertain','dispatching')
  ) then
    raise exception 'Resolva os efeitos externos antes de reprocessar' using errcode = '23514';
  end if;
  if job.tipo = 'supplier_settlement_communication' then
    select status into communication_status from public.supplier_settlement_communications where id = target_id;
    if communication_status <> 'approved' then
      raise exception 'Resolva o envio antes de reprocessar' using errcode = '23514';
    end if;
  end if;
  update public.jobs set status = 'pendente',finished_at = null,
    log = coalesce(log,'[]'::jsonb) || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('event','manual_requeue','at',pg_catalog.clock_timestamp(),
        'actor',p_actor))
    where id = p_job_id;
  insert into public.supplier_oracle_manual_decisions(target_type,target_id,decision,actor,note)
    values ('job',p_job_id::text,'requeue',p_actor,p_note);
  return pg_catalog.jsonb_build_object('id',p_job_id,'status','pendente');
end;
$$;

revoke all on function public.supplier_oracle_communication_draft(uuid[],text,text,text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_communication_approve(uuid,integer,text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_claim_job(text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_resolve_resume(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_resolve_communication(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.supplier_oracle_requeue_job(uuid,text,text) from public, anon, authenticated;
grant execute on function public.supplier_oracle_communication_draft(uuid[],text,text,text) to service_role;
grant execute on function public.supplier_oracle_communication_approve(uuid,integer,text) to service_role;
grant execute on function public.supplier_oracle_claim_job(text) to service_role;
grant execute on function public.supplier_oracle_resolve_resume(uuid,uuid,text,text,text) to service_role;
grant execute on function public.supplier_oracle_resolve_communication(uuid,text,text,text) to service_role;
grant execute on function public.supplier_oracle_requeue_job(uuid,text,text) to service_role;

notify pgrst, 'reload schema';
