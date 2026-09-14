-- BENTEVI VIDEO FACTORY — BVF-WORKFLOW-01
-- Criação idempotente, autorização única de briefing+custo e cancelamento auditável.
-- Nenhuma função desta migration escreve fora do domínio video_*.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.video_jobs
  add column creation_request_id uuid,
  add column generation_approved_brief_version_id uuid,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid,
  add column cancellation_reason text;

do $$
begin
  if exists (
    select 1 from public.video_jobs
    where generation_approved_at is not null and current_brief_version_id is null
  ) then
    raise exception using errcode = '55000', message = 'BVF_WORKFLOW_EXISTING_APPROVAL_WITHOUT_BRIEF';
  end if;
  if exists (
    select 1 from public.video_jobs where status = 'cancelled'
  ) then
    raise exception using errcode = '55000', message = 'BVF_WORKFLOW_EXISTING_CANCELLATION_REQUIRES_AUDIT';
  end if;

  update public.video_jobs
  set generation_approved_brief_version_id = current_brief_version_id
  where generation_approved_at is not null;
end;
$$;

alter table public.video_jobs
  add constraint video_jobs_generation_approved_brief_fkey
  foreign key (id, generation_approved_brief_version_id)
  references public.video_brief_versions(job_id, id)
  on delete restrict,
  add constraint video_jobs_cancelled_by_fkey
  foreign key (cancelled_by)
  references public.profiles(id)
  on delete restrict,
  add constraint video_jobs_generation_approved_brief_check check (
    (generation_approved_at is null
      and generation_approved_by is null
      and generation_approved_brief_version_id is null)
    or
    (generation_approved_at is not null
      and generation_approved_by is not null
      and generation_approved_brief_version_id is not null)
  ),
  add constraint video_jobs_cancellation_check check (
    status <> 'cancelled'
    or (cancelled_at is not null and cancelled_by is not null)
  ),
  add constraint video_jobs_cancellation_reason_check check (
    cancellation_reason is null or nullif(btrim(cancellation_reason), '') is not null
  );

create unique index video_jobs_creation_request_idx
  on public.video_jobs (created_by, creation_request_id)
  where creation_request_id is not null;

create index video_jobs_generation_approved_brief_idx
  on public.video_jobs (generation_approved_brief_version_id)
  where generation_approved_brief_version_id is not null;

create index video_jobs_cancelled_by_idx
  on public.video_jobs (cancelled_by)
  where cancelled_by is not null;

create function public.bvf_create_video_job(
  p_actor_id uuid,
  p_request_id uuid,
  p_product_id uuid default null,
  p_family_id uuid default null,
  p_video_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.video_jobs%rowtype;
  v_product public.produtos%rowtype;
  v_family public.video_families%rowtype;
  v_job_id uuid;
  v_scope text;
begin
  if p_actor_id is null or p_request_id is null
     or coalesce(btrim(p_video_type), '') = '' then
    raise exception using errcode = '22023', message = 'BVF_WORKFLOW_REQUIRED_INPUT_MISSING';
  end if;
  if (p_product_id is null) = (p_family_id is null) then
    raise exception using errcode = '22023', message = 'BVF_WORKFLOW_SINGLE_TARGET_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_WORKFLOW_PERMISSION_DENIED';
  end if;

  select job.* into v_existing
  from public.video_jobs job
  where job.created_by = p_actor_id and job.creation_request_id = p_request_id
  for update;
  if found then
    if v_existing.produto_id is distinct from p_product_id
       or v_existing.family_id is distinct from p_family_id
       or v_existing.video_type is distinct from p_video_type then
      raise exception using errcode = '23000', message = 'BVF_WORKFLOW_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'jobId', v_existing.id,
      'created', false,
      'status', v_existing.status
    );
  end if;

  if p_product_id is not null then
    if p_video_type not in ('HUMAN_DEMO', 'CINEMATIC_PRODUCT') then
      raise exception using errcode = '22023', message = 'BVF_WORKFLOW_SKU_VIDEO_TYPE_REQUIRED';
    end if;
    select product.* into v_product
    from public.produtos product
    where product.id = p_product_id and product.ativo = true;
    if not found then
      raise exception using errcode = 'P0002', message = 'BVF_WORKFLOW_ACTIVE_PRODUCT_NOT_FOUND';
    end if;
    v_scope := 'SKU';
    insert into public.video_jobs (
      produto_id, sku, ml_item_id, video_type, content_scope, status,
      created_by, creation_request_id
    ) values (
      v_product.id, v_product.sku, v_product.ml_item_id, p_video_type, v_scope, 'draft',
      p_actor_id, p_request_id
    ) returning id into v_job_id;
  else
    if p_video_type <> 'FAMILY_VIDEO' then
      raise exception using errcode = '22023', message = 'BVF_WORKFLOW_FAMILY_VIDEO_TYPE_REQUIRED';
    end if;
    select family.* into v_family
    from public.video_families family
    where family.id = p_family_id and family.active = true;
    if not found then
      raise exception using errcode = 'P0002', message = 'BVF_WORKFLOW_ACTIVE_FAMILY_NOT_FOUND';
    end if;
    v_scope := 'FAMILY';
    insert into public.video_jobs (
      family_id, family_key, video_type, content_scope, persona_id, status,
      created_by, creation_request_id
    ) values (
      v_family.id, v_family.family_key, p_video_type, v_scope,
      v_family.default_persona_id, 'draft', p_actor_id, p_request_id
    ) returning id into v_job_id;
  end if;

  return jsonb_build_object('jobId', v_job_id, 'created', true, 'status', 'draft');
end;
$$;

create function public.bvf_authorize_video_generation(
  p_job_id uuid,
  p_actor_id uuid,
  p_brief_version_id uuid,
  p_provider text,
  p_model text,
  p_estimated_cost numeric,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.video_jobs%rowtype;
  v_brief public.video_brief_versions%rowtype;
  v_current_family_analysis_id uuid;
begin
  if p_job_id is null or p_actor_id is null or p_brief_version_id is null
     or coalesce(btrim(p_provider), '') = ''
     or coalesce(btrim(p_model), '') = ''
     or p_estimated_cost is null or p_estimated_cost < 0
     or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'BVF_WORKFLOW_GENERATION_QUOTE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_WORKFLOW_PERMISSION_DENIED';
  end if;

  select job.* into v_job
  from public.video_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_JOB_NOT_FOUND';
  end if;

  if v_job.status = 'approved_for_generation'
     and v_job.generation_approved_brief_version_id = p_brief_version_id
     and v_job.generation_provider = btrim(p_provider)
     and v_job.generation_model = btrim(p_model)
     and v_job.estimated_cost = p_estimated_cost
     and v_job.estimated_cost_currency = p_currency then
    return jsonb_build_object(
      'jobId', v_job.id,
      'authorized', true,
      'changed', false,
      'status', v_job.status
    );
  end if;
  if v_job.status <> 'waiting_brief_approval' then
    raise exception using errcode = '55000', message = 'BVF_WORKFLOW_JOB_NOT_WAITING_AUTHORIZATION';
  end if;
  if v_job.current_brief_version_id is distinct from p_brief_version_id then
    raise exception using errcode = '55000', message = 'BVF_WORKFLOW_BRIEF_CHANGED';
  end if;
  if coalesce(btrim(v_job.prompt_final), '') = ''
     or v_job.generation_provider is distinct from btrim(p_provider)
     or v_job.generation_model is distinct from btrim(p_model)
     or v_job.estimated_cost is distinct from p_estimated_cost
     or v_job.estimated_cost_currency is distinct from p_currency then
    raise exception using errcode = '55000', message = 'BVF_WORKFLOW_GENERATION_QUOTE_CHANGED';
  end if;

  select brief.* into v_brief
  from public.video_brief_versions brief
  where brief.job_id = v_job.id and brief.id = p_brief_version_id;
  if not found then
    raise exception using errcode = '23503', message = 'BVF_WORKFLOW_BRIEF_NOT_FOUND';
  end if;

  if v_job.content_scope = 'FAMILY' then
    select family.current_analysis_version_id into v_current_family_analysis_id
    from public.video_families family
    where family.id = v_job.family_id and family.active = true;
    if not found
       or v_current_family_analysis_id is null
       or v_brief.family_analysis_version_id is distinct from v_current_family_analysis_id then
      raise exception using errcode = '55000', message = 'BVF_WORKFLOW_FAMILY_REANALYSIS_REQUIRED';
    end if;
  end if;

  update public.video_jobs
  set status = 'approved_for_generation',
      generation_approved_at = now(),
      generation_approved_by = p_actor_id,
      generation_approved_brief_version_id = p_brief_version_id
  where id = v_job.id;

  return jsonb_build_object(
    'jobId', v_job.id,
    'authorized', true,
    'changed', true,
    'status', 'approved_for_generation'
  );
end;
$$;

create function public.bvf_cancel_video_job(
  p_job_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.video_jobs%rowtype;
  v_reason text;
begin
  if p_job_id is null or p_actor_id is null then
    raise exception using errcode = '22023', message = 'BVF_WORKFLOW_REQUIRED_INPUT_MISSING';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_WORKFLOW_PERMISSION_DENIED';
  end if;
  v_reason := nullif(btrim(p_reason), '');

  select job.* into v_job
  from public.video_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_JOB_NOT_FOUND';
  end if;
  if v_job.status = 'cancelled' then
    return jsonb_build_object('jobId', v_job.id, 'changed', false, 'status', 'cancelled');
  end if;
  if v_job.status not in (
    'draft', 'data_loaded', 'brief_ready', 'waiting_brief_approval',
    'approved_for_generation', 'generation_error', 'validation_failed',
    'insufficient_api_balance'
  ) then
    raise exception using errcode = '55000', message = 'BVF_WORKFLOW_JOB_NOT_CANCELLABLE';
  end if;

  update public.video_jobs
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_actor_id,
      cancellation_reason = v_reason
  where id = v_job.id;

  return jsonb_build_object('jobId', v_job.id, 'changed', true, 'status', 'cancelled');
end;
$$;

revoke insert, update on table public.video_jobs from service_role;

revoke all on function public.bvf_create_video_job(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.bvf_authorize_video_generation(uuid, uuid, uuid, text, text, numeric, text)
  from public, anon, authenticated, service_role;
revoke all on function public.bvf_cancel_video_job(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.bvf_create_video_job(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.bvf_authorize_video_generation(uuid, uuid, uuid, text, text, numeric, text)
  to service_role;
grant execute on function public.bvf_cancel_video_job(uuid, uuid, text)
  to service_role;

comment on column public.video_jobs.creation_request_id is
  'Chave idempotente da criação, única por operador; retries não criam outro job.';
comment on column public.video_jobs.generation_approved_brief_version_id is
  'Versão imutável do briefing conferida no gate único de briefing e gasto.';
comment on column public.video_jobs.cancelled_by is
  'Operador que cancelou o job; cancelamento substitui DELETE operacional.';
comment on function public.bvf_authorize_video_generation(uuid, uuid, uuid, text, text, numeric, text) is
  'Autoriza briefing e gasto em um único gate após conferir prompt e cotação exatos.';

select pg_notify('pgrst', 'reload schema');

commit;
