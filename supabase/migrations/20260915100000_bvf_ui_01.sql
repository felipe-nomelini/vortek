-- BENTEVI VIDEO FACTORY — BVF-UI-01
-- Revisão humana versionada. Nenhuma função escreve fora do domínio video_*.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.bvf_persist_reviewed_brief_version(
  p_job_id uuid,
  p_actor_id uuid,
  p_expected_brief_version_id uuid,
  p_engine_version text,
  p_material_fingerprint text,
  p_creative_brief jsonb,
  p_reference_asset_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.video_jobs%rowtype;
  v_current public.video_brief_versions%rowtype;
  v_version integer;
  v_version_id uuid;
  v_reference_ids uuid[] := coalesce(p_reference_asset_ids, '{}'::uuid[]);
  v_reference_count integer;
  v_claim_count integer;
  v_claim_decision_count integer;
  v_approval_invalidated boolean := false;
begin
  if p_job_id is null or p_actor_id is null or p_expected_brief_version_id is null
     or p_engine_version <> 'BVF-UI-01-v1'
     or p_material_fingerprint is null
     or p_material_fingerprint !~ '^[0-9a-f]{64}$'
     or coalesce(jsonb_typeof(p_creative_brief), '') <> 'object'
     or p_creative_brief ->> 'schemaVersion' <> 'BVF-UI-CREATIVE-BRIEF-v1'
     or coalesce(jsonb_typeof(p_creative_brief -> 'target'), '') <> 'object'
     or coalesce(jsonb_typeof(p_creative_brief -> 'sections'), '') <> 'object'
     or coalesce(jsonb_typeof(p_creative_brief -> 'references'), '') <> 'array'
     or coalesce(jsonb_typeof(p_creative_brief -> 'review'), '') <> 'object'
     or coalesce(jsonb_typeof(p_creative_brief #> '{review,claimDecisions}'), '') <> 'array'
     or coalesce(jsonb_typeof(p_creative_brief #> '{review,additionalForbiddenClaims}'), '') <> 'array'
     or coalesce(jsonb_typeof(p_creative_brief #> '{review,variationUnsafeAcknowledgements}'), '') <> 'array'
     or coalesce(btrim(p_creative_brief ->> 'direction'), '') = '' then
    raise exception using errcode = '22023', message = 'BVF_UI_INVALID_REVIEW_PAYLOAD';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_UI_PERMISSION_DENIED';
  end if;

  select job.* into v_job
  from public.video_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_JOB_NOT_FOUND';
  end if;
  if v_job.current_brief_version_id is null then
    raise exception using errcode = '55000', message = 'BVF_UI_BRIEF_REQUIRED';
  end if;

  select brief.* into v_current
  from public.video_brief_versions brief
  where brief.job_id = v_job.id and brief.id = v_job.current_brief_version_id;
  if not found then
    raise exception using errcode = '23503', message = 'BVF_UI_CURRENT_BRIEF_NOT_FOUND';
  end if;

  if v_current.engine_version = p_engine_version
     and v_current.material_fingerprint = p_material_fingerprint then
    return jsonb_build_object(
      'briefVersionId', v_current.id,
      'version', v_current.version,
      'created', false,
      'status', v_job.status,
      'approvalInvalidated', false
    );
  end if;

  if v_job.current_brief_version_id is distinct from p_expected_brief_version_id then
    raise exception using errcode = '40001', message = 'BVF_UI_BRIEF_CHANGED';
  end if;
  if v_job.status not in ('waiting_brief_approval', 'approved_for_generation') then
    raise exception using errcode = '55000', message = 'BVF_UI_BRIEF_NOT_EDITABLE';
  end if;

  if cardinality(v_reference_ids) <> (
      select count(distinct item.reference_id)
      from unnest(v_reference_ids) as item(reference_id)
    )
     or cardinality(v_reference_ids) <> jsonb_array_length(p_creative_brief -> 'references')
     or cardinality(v_reference_ids) <> (
       select count(distinct (reference ->> 'assetId')::uuid)
       from jsonb_array_elements(p_creative_brief -> 'references') reference
       where coalesce(reference ->> 'assetId', '') ~ '^[0-9a-f-]{36}$'
     )
     or exists (
       select 1
       from jsonb_array_elements(p_creative_brief -> 'references') reference
       where coalesce(reference ->> 'assetId', '') !~ '^[0-9a-f-]{36}$'
          or not ((reference ->> 'assetId')::uuid = any(v_reference_ids))
     ) then
    raise exception using errcode = '22023', message = 'BVF_UI_REFERENCE_SET_MISMATCH';
  end if;

  perform 1
  from public.video_assets asset
  where asset.id = any(v_reference_ids)
  for share;

  select count(*) into v_reference_count
  from public.video_assets asset
  where asset.id = any(v_reference_ids) and asset.active = true;
  if v_reference_count <> cardinality(v_reference_ids) then
    raise exception using errcode = '55000', message = 'BVF_UI_REFERENCE_INACTIVE_OR_MISSING';
  end if;

  if v_job.content_scope = 'SKU' then
    if exists (
      select 1 from public.video_assets asset
      where asset.id = any(v_reference_ids)
        and (
          (asset.asset_type = 'product_reference' and asset.produto_id is distinct from v_job.produto_id)
          or (asset.asset_type = 'persona_reference' and asset.persona_id is distinct from v_job.persona_id)
          or asset.asset_type not in ('product_reference', 'persona_reference')
        )
    ) then
      raise exception using errcode = '23514', message = 'BVF_UI_REFERENCE_TARGET_MISMATCH';
    end if;
  else
    if exists (
      select 1 from public.video_assets asset
      where asset.id = any(v_reference_ids)
        and (
          (asset.asset_type = 'product_reference' and not exists (
            select 1 from public.video_family_products member
            where member.family_id = v_job.family_id
              and member.produto_id = asset.produto_id
              and member.removed_at is null
          ))
          or (asset.asset_type = 'persona_reference' and asset.persona_id is distinct from v_job.persona_id)
          or asset.asset_type not in ('product_reference', 'persona_reference')
        )
    ) then
      raise exception using errcode = '23514', message = 'BVF_UI_REFERENCE_TARGET_MISMATCH';
    end if;
  end if;

  select coalesce(jsonb_array_length(v_current.factual_snapshot -> 'verifiedClaims'), 0)
  into v_claim_count;
  select count(distinct (decision ->> 'index')::integer)
  into v_claim_decision_count
  from jsonb_array_elements(p_creative_brief #> '{review,claimDecisions}') decision
  where decision ->> 'index' ~ '^\d+$'
    and (decision ->> 'index')::integer between 0 and greatest(v_claim_count - 1, 0)
    and decision ->> 'decision' in ('verified', 'forbidden');
  if v_claim_decision_count <> v_claim_count then
    raise exception using errcode = '55000', message = 'BVF_UI_CLAIM_REVIEW_INCOMPLETE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_current.factual_snapshot -> 'variationUnsafe') unsafe
    where not (p_creative_brief #> '{review,variationUnsafeAcknowledgements}')
      @> jsonb_build_array(unsafe ->> 'key')
  ) then
    raise exception using errcode = '55000', message = 'BVF_UI_VARIATION_REVIEW_INCOMPLETE';
  end if;

  if p_creative_brief #>> '{review,scale,status}' not in ('defined', 'unavailable')
     or (
       p_creative_brief #>> '{review,scale,status}' = 'defined'
       and (
         v_current.factual_snapshot #> '{physicalDimensions,widthCm}' is null
         or v_current.factual_snapshot #> '{physicalDimensions,heightCm}' is null
         or v_current.factual_snapshot #> '{physicalDimensions,depthCm}' is null
       )
     )
     or (
       p_creative_brief #>> '{review,scale,status}' = 'unavailable'
       and coalesce(btrim(p_creative_brief #>> '{review,scale,reason}'), '') = ''
     ) then
    raise exception using errcode = '55000', message = 'BVF_UI_SCALE_REVIEW_INCOMPLETE';
  end if;

  select coalesce(max(brief.version), 0) + 1 into v_version
  from public.video_brief_versions brief
  where brief.job_id = v_job.id;

  insert into public.video_brief_versions (
    job_id, version, engine_version, material_fingerprint,
    input_snapshot, factual_snapshot, creative_brief,
    family_analysis_version_id, created_by
  ) values (
    v_job.id, v_version, p_engine_version, p_material_fingerprint,
    v_current.input_snapshot, v_current.factual_snapshot, p_creative_brief,
    v_current.family_analysis_version_id, p_actor_id
  ) returning id into v_version_id;

  v_approval_invalidated := v_job.status = 'approved_for_generation';
  update public.video_jobs
  set current_brief_version_id = v_version_id,
      creative_brief = p_creative_brief,
      status = 'waiting_brief_approval',
      prompt_template_code = null,
      prompt_template_version = null,
      prompt_final = null,
      generation_provider = null,
      generation_model = null,
      estimated_cost = null,
      estimated_cost_currency = null,
      generation_approved_at = null,
      generation_approved_by = null,
      generation_approved_brief_version_id = null
  where id = v_job.id;

  return jsonb_build_object(
    'briefVersionId', v_version_id,
    'version', v_version,
    'created', true,
    'status', 'waiting_brief_approval',
    'approvalInvalidated', v_approval_invalidated
  );
end;
$$;

create or replace function public.bvf_authorize_video_generation(
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
  v_reference_ids uuid[];
  v_product_reference_count integer;
  v_family_member_count integer;
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

  if v_job.status not in ('waiting_brief_approval', 'approved_for_generation') then
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
  if v_brief.engine_version <> 'BVF-UI-01-v1'
     or v_brief.creative_brief ->> 'schemaVersion' <> 'BVF-UI-CREATIVE-BRIEF-v1' then
    raise exception using errcode = '55000', message = 'BVF_UI_REVIEW_REQUIRED';
  end if;

  select coalesce(array_agg((reference ->> 'assetId')::uuid), '{}'::uuid[])
  into v_reference_ids
  from jsonb_array_elements(v_brief.creative_brief -> 'references') reference;
  perform 1
  from public.video_assets asset
  where asset.id = any(v_reference_ids)
  for share;
  if cardinality(v_reference_ids) = 0
     or (select count(*) from public.video_assets asset where asset.id = any(v_reference_ids) and asset.active = true)
        <> cardinality(v_reference_ids) then
    raise exception using errcode = '55000', message = 'BVF_UI_REFERENCE_INACTIVE_OR_MISSING';
  end if;

  if v_job.content_scope = 'SKU' then
    if exists (
      select 1 from public.video_assets asset
      where asset.id = any(v_reference_ids)
        and (
          (asset.asset_type = 'product_reference' and asset.produto_id is distinct from v_job.produto_id)
          or (asset.asset_type = 'persona_reference' and asset.persona_id is distinct from v_job.persona_id)
          or asset.asset_type not in ('product_reference', 'persona_reference')
        )
    ) then
      raise exception using errcode = '23514', message = 'BVF_UI_REFERENCE_TARGET_MISMATCH';
    end if;
  else
    if exists (
      select 1 from public.video_assets asset
      where asset.id = any(v_reference_ids)
        and (
          (asset.asset_type = 'product_reference' and not exists (
            select 1 from public.video_family_products member
            where member.family_id = v_job.family_id
              and member.produto_id = asset.produto_id
              and member.removed_at is null
          ))
          or (asset.asset_type = 'persona_reference' and asset.persona_id is distinct from v_job.persona_id)
          or asset.asset_type not in ('product_reference', 'persona_reference')
        )
    ) then
      raise exception using errcode = '23514', message = 'BVF_UI_REFERENCE_TARGET_MISMATCH';
    end if;
  end if;

  select count(*) into v_product_reference_count
  from public.video_assets asset
  where asset.id = any(v_reference_ids) and asset.asset_type = 'product_reference';
  if v_job.content_scope = 'SKU' and v_product_reference_count < 1 then
    raise exception using errcode = '55000', message = 'BVF_UI_PRODUCT_REFERENCE_REQUIRED';
  end if;
  if v_job.content_scope = 'FAMILY' then
    select count(*) into v_family_member_count
    from public.video_family_products member
    where member.family_id = v_job.family_id and member.removed_at is null;
    if v_family_member_count = 0
       or v_product_reference_count < v_family_member_count
       or exists (
         select 1 from public.video_family_products member
         where member.family_id = v_job.family_id and member.removed_at is null
           and not exists (
             select 1 from public.video_assets asset
             where asset.id = any(v_reference_ids)
               and asset.asset_type = 'product_reference'
               and asset.produto_id = member.produto_id
           )
       ) then
      raise exception using errcode = '55000', message = 'BVF_UI_FAMILY_REFERENCE_REQUIRED';
    end if;
  end if;

  if v_job.persona_id is not null and (
    select count(distinct asset.reference_slot)
    from public.video_assets asset
    where asset.id = any(v_reference_ids)
      and asset.asset_type = 'persona_reference'
      and asset.persona_id = v_job.persona_id
      and asset.reference_slot in ('front', 'profile', 'full_body')
  ) <> 3 then
    raise exception using errcode = '55000', message = 'BVF_UI_PERSONA_REFERENCES_REQUIRED';
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

  if v_job.status = 'approved_for_generation' then
    if v_job.generation_approved_brief_version_id is distinct from p_brief_version_id then
      raise exception using errcode = '55000', message = 'BVF_WORKFLOW_BRIEF_CHANGED';
    end if;
    return jsonb_build_object(
      'jobId', v_job.id,
      'authorized', true,
      'changed', false,
      'status', v_job.status
    );
  end if;

  update public.video_jobs
  set status = 'approved_for_generation',
      generation_approved_at = now(),
      generation_approved_by = p_actor_id,
      generation_approved_brief_version_id = p_brief_version_id
  where id = v_job.id;

  return jsonb_build_object('jobId', v_job.id, 'authorized', true, 'changed', true, 'status', 'approved_for_generation');
end;
$$;

revoke all on function public.bvf_persist_reviewed_brief_version(uuid, uuid, uuid, text, text, jsonb, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.bvf_persist_reviewed_brief_version(uuid, uuid, uuid, text, text, jsonb, uuid[])
  to service_role;

comment on function public.bvf_persist_reviewed_brief_version(uuid, uuid, uuid, text, text, jsonb, uuid[]) is
  'Cria revisão humana imutável do briefing, valida referências e invalida aprovação/cotação materialmente antigas.';
comment on function public.bvf_authorize_video_generation(uuid, uuid, uuid, text, text, numeric, text) is
  'Autoriza briefing revisado e gasto real em um único gate; não aceita versão sem revisão UI nem referência inativa.';

select pg_notify('pgrst', 'reload schema');

commit;
