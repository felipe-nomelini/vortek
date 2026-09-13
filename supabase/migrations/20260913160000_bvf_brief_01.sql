-- BENTEVI VIDEO FACTORY — BVF-BRIEF-01
-- Versionamento imutavel de briefings factuais por SKU.
-- O dominio BVF apenas le produtos/ofertas/anuncios; esta migration escreve
-- exclusivamente nas tabelas video_*.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.video_brief_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.video_jobs(id) on delete restrict,
  version integer not null check (version > 0),
  engine_version text not null check (btrim(engine_version) <> ''),
  material_fingerprint text not null check (material_fingerprint ~ '^[0-9a-f]{64}$'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  factual_snapshot jsonb not null check (jsonb_typeof(factual_snapshot) = 'object'),
  creative_brief jsonb not null check (jsonb_typeof(creative_brief) = 'object'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (job_id, version),
  unique (job_id, id)
);

create index video_brief_versions_job_version_idx
  on public.video_brief_versions (job_id, version desc);

alter table public.video_jobs
  add column current_brief_version_id uuid;

alter table public.video_jobs
  add constraint video_jobs_current_brief_version_fkey
  foreign key (id, current_brief_version_id)
  references public.video_brief_versions(job_id, id)
  on delete restrict;

create index video_jobs_current_brief_version_id_idx
  on public.video_jobs (current_brief_version_id)
  where current_brief_version_id is not null;

create function public.bvf_brief_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'BVF_BRIEF_VERSION_IMMUTABLE';
end;
$$;

create trigger trg_bvf_brief_version_immutable
before update or delete on public.video_brief_versions
for each row execute function public.bvf_brief_version_immutable();

create function public.bvf_persist_brief_version(
  p_job_id uuid,
  p_actor_id uuid,
  p_engine_version text,
  p_material_fingerprint text,
  p_input_snapshot jsonb,
  p_factual_snapshot jsonb,
  p_creative_brief jsonb,
  p_product_id uuid,
  p_persona_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.video_jobs%rowtype;
  v_product public.produtos%rowtype;
  v_persona public.video_personas%rowtype;
  v_current public.video_brief_versions%rowtype;
  v_version integer;
  v_version_id uuid;
begin
  if p_job_id is null or p_actor_id is null or p_product_id is null then
    raise exception using errcode = '22023', message = 'BVF_BRIEF_REQUIRED_IDENTIFIER_MISSING';
  end if;

  if coalesce(btrim(p_engine_version), '') = '' then
    raise exception using errcode = '22023', message = 'BVF_BRIEF_ENGINE_VERSION_REQUIRED';
  end if;

  if p_material_fingerprint is null
     or p_material_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'BVF_BRIEF_INVALID_FINGERPRINT';
  end if;

  if coalesce(jsonb_typeof(p_input_snapshot), '') <> 'object'
     or coalesce(jsonb_typeof(p_factual_snapshot), '') <> 'object'
     or coalesce(jsonb_typeof(p_creative_brief), '') <> 'object'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'verifiedClaims'), '') <> 'array'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'forbiddenClaims'), '') <> 'array'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'physicalDimensions'), '') <> 'object'
     or coalesce(jsonb_typeof(p_creative_brief -> 'target'), '') <> 'object' then
    raise exception using errcode = '22023', message = 'BVF_BRIEF_INVALID_PAYLOAD';
  end if;

  if not (p_factual_snapshot ? 'scaleAnchor')
     or (jsonb_typeof(p_factual_snapshot -> 'scaleAnchor') not in ('string', 'null')) then
    raise exception using errcode = '22023', message = 'BVF_BRIEF_INVALID_SCALE_ANCHOR';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_BRIEF_PERMISSION_DENIED';
  end if;

  select job.*
  into v_job
  from public.video_jobs job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_JOB_NOT_FOUND';
  end if;

  if v_job.content_scope <> 'SKU'
     or v_job.video_type not in ('HUMAN_DEMO', 'CINEMATIC_PRODUCT') then
    raise exception using errcode = '22023', message = 'BVF_BRIEF_SKU_SCOPE_REQUIRED';
  end if;

  if v_job.status not in (
    'draft',
    'data_loaded',
    'brief_ready',
    'waiting_brief_approval'
  ) then
    raise exception using errcode = '55000', message = 'BVF_BRIEF_JOB_STATE_NOT_EDITABLE';
  end if;

  select product.*
  into v_product
  from public.produtos product
  where product.id = p_product_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_PRODUCT_NOT_FOUND';
  end if;

  if v_job.produto_id is not null and v_job.produto_id <> p_product_id then
    raise exception using errcode = '23514', message = 'BVF_BRIEF_PRODUCT_MISMATCH';
  end if;

  if v_job.sku is null or v_job.sku <> v_product.sku then
    raise exception using errcode = '23514', message = 'BVF_BRIEF_SKU_MISMATCH';
  end if;

  if p_creative_brief #>> '{target,jobId}' is distinct from p_job_id::text
     or p_creative_brief #>> '{target,sku}' is distinct from v_product.sku
     or p_creative_brief #>> '{target,videoType}' is distinct from v_job.video_type then
    raise exception using errcode = '23514', message = 'BVF_BRIEF_TARGET_MISMATCH';
  end if;

  if v_job.video_type = 'HUMAN_DEMO' then
    if p_persona_id is null then
      raise exception using errcode = '22023', message = 'BVF_BRIEF_PERSONA_REQUIRED';
    end if;

    select persona.*
    into v_persona
    from public.video_personas persona
    where persona.id = p_persona_id
      and persona.status = 'active';

    if not found then
      raise exception using errcode = 'P0002', message = 'BVF_BRIEF_ACTIVE_PERSONA_NOT_FOUND';
    end if;
  elsif p_persona_id is not null then
    raise exception using errcode = '22023', message = 'BVF_BRIEF_PERSONA_NOT_ALLOWED';
  end if;

  if v_job.current_brief_version_id is not null then
    select brief.*
    into v_current
    from public.video_brief_versions brief
    where brief.job_id = v_job.id
      and brief.id = v_job.current_brief_version_id;

    if not found then
      raise exception using errcode = '23503', message = 'BVF_BRIEF_CURRENT_VERSION_NOT_FOUND';
    end if;

    if v_current.material_fingerprint = p_material_fingerprint then
      if v_current.engine_version <> p_engine_version
         or v_current.factual_snapshot <> p_factual_snapshot
         or v_current.creative_brief <> p_creative_brief then
        raise exception using errcode = '23000', message = 'BVF_BRIEF_FINGERPRINT_CONFLICT';
      end if;

      return jsonb_build_object(
        'briefVersionId', v_current.id,
        'version', v_current.version,
        'created', false,
        'status', v_job.status
      );
    end if;
  end if;

  select coalesce(max(brief.version), 0) + 1
  into v_version
  from public.video_brief_versions brief
  where brief.job_id = v_job.id;

  insert into public.video_brief_versions (
    job_id,
    version,
    engine_version,
    material_fingerprint,
    input_snapshot,
    factual_snapshot,
    creative_brief,
    created_by
  ) values (
    v_job.id,
    v_version,
    p_engine_version,
    p_material_fingerprint,
    p_input_snapshot,
    p_factual_snapshot,
    p_creative_brief,
    p_actor_id
  )
  returning id into v_version_id;

  update public.video_jobs
  set current_brief_version_id = v_version_id,
      produto_id = v_product.id,
      persona_id = case when v_job.video_type = 'HUMAN_DEMO' then v_persona.id else null end,
      persona_code = case when v_job.video_type = 'HUMAN_DEMO' then v_persona.code else null end,
      persona_version = case when v_job.video_type = 'HUMAN_DEMO' then v_persona.version else null end,
      product_snapshot = p_input_snapshot -> 'product',
      verified_claims = p_factual_snapshot -> 'verifiedClaims',
      forbidden_claims = p_factual_snapshot -> 'forbiddenClaims',
      physical_dimensions = p_factual_snapshot -> 'physicalDimensions',
      scale_anchor = case
        when jsonb_typeof(p_factual_snapshot -> 'scaleAnchor') = 'string'
          then p_factual_snapshot ->> 'scaleAnchor'
        else null
      end,
      creative_brief = p_creative_brief,
      status = 'waiting_brief_approval'
  where id = v_job.id;

  return jsonb_build_object(
    'briefVersionId', v_version_id,
    'version', v_version,
    'created', true,
    'status', 'waiting_brief_approval'
  );
end;
$$;

alter table public.video_brief_versions enable row level security;

revoke all on table public.video_brief_versions from public, anon, authenticated, service_role;
grant select on table public.video_brief_versions to service_role;

revoke all on function public.bvf_brief_version_immutable() from public, anon, authenticated, service_role;
grant execute on function public.bvf_brief_version_immutable() to service_role;

revoke all on function public.bvf_persist_brief_version(uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bvf_persist_brief_version(uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid, uuid)
  to service_role;

comment on table public.video_brief_versions is
  'Versoes imutaveis e auditaveis dos briefings factuais BVF por job.';
comment on column public.video_brief_versions.material_fingerprint is
  'SHA-256 do conteudo material canonico; timestamps de coleta nao participam.';
comment on column public.video_jobs.current_brief_version_id is
  'Ponteiro para a versao imutavel atualmente selecionada no job.';
comment on function public.bvf_persist_brief_version(uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid, uuid) is
  'Persiste atomicamente uma nova versao BVF-BRIEF-01 ou retorna a versao materialmente identica.';
comment on column public.video_jobs.product_snapshot is
  'Projecao do produto usada pela versao corrente; o historico canonico fica em video_brief_versions.';
comment on column public.video_jobs.scale_anchor is
  'Ancora automatica derivada de medidas fisicas verificadas; integra a aprovacao humana do briefing completo.';

select pg_notify('pgrst', 'reload schema');

commit;
