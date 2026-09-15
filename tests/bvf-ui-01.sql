\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor_id uuid;
  v_product_id uuid;
  v_job_id uuid;
  v_asset_id uuid := gen_random_uuid();
  v_base_brief_id uuid;
  v_review_brief_id uuid;
  v_created jsonb;
  v_reviewed jsonb;
  v_authorized jsonb;
  v_changed jsonb;
  v_base_creative jsonb;
  v_review_creative jsonb;
begin
  select profile.id into v_actor_id
  from public.profiles profile
  where profile.cargo::text in ('admin', 'gerente')
  order by profile.created_at limit 1;

  select product.id into v_product_id
  from public.produtos product
  where product.ativo = true and nullif(btrim(product.sku), '') is not null
  order by product.created_at limit 1;

  if v_actor_id is null or v_product_id is null then
    raise exception 'BVF_UI_TEST_PREREQUISITES_MISSING';
  end if;

  v_created := public.bvf_create_video_job(
    v_actor_id, gen_random_uuid(), v_product_id, null, 'CINEMATIC_PRODUCT'
  );
  v_job_id := (v_created ->> 'jobId')::uuid;

  select jsonb_build_object(
    'target', jsonb_build_object(
      'jobId', v_job_id,
      'sku', product.sku,
      'videoType', 'CINEMATIC_PRODUCT'
    ),
    'languages', jsonb_build_object('prompt', 'EN', 'onscreenText', 'pt-BR'),
    'factualRules', jsonb_build_object('creativityCanVary', true, 'factsCannotVary', true)
  ) into v_base_creative
  from public.produtos product where product.id = v_product_id;

  v_reviewed := public.bvf_persist_brief_version(
    v_job_id,
    v_actor_id,
    'BVF-UI-01-base-test',
    repeat('1', 64),
    '{}'::jsonb,
    jsonb_build_object(
      'schemaVersion', 'BVF-FACTUAL-SNAPSHOT-v1',
      'verifiedClaims', jsonb_build_array(jsonb_build_object(
        'text', 'Claim literal de teste.',
        'source', jsonb_build_object('kind', 'bentevi_product', 'reference', 'descricao')
      )),
      'forbiddenClaims', '[]'::jsonb,
      'physicalDimensions', jsonb_build_object(
        'widthCm', jsonb_build_object('value', 5.2),
        'heightCm', jsonb_build_object('value', 5.9),
        'depthCm', jsonb_build_object('value', 9.8)
      ),
      'scaleAnchor', 'Escala física estruturada.',
      'variationUnsafe', '[]'::jsonb
    ),
    v_base_creative,
    v_product_id,
    null
  );
  v_base_brief_id := (v_reviewed ->> 'briefVersionId')::uuid;

  perform public.bvf_register_reference_asset(
    v_asset_id,
    v_actor_id,
    'product_reference',
    null,
    v_product_id,
    null,
    format('products/%s/%s.jpg', v_product_id, v_asset_id),
    'image/jpeg',
    100,
    100,
    repeat('a', 64),
    '{"source_kind":"test_transaction"}'::jsonb
  );

  v_review_creative := v_base_creative || jsonb_build_object(
    'schemaVersion', 'BVF-UI-CREATIVE-BRIEF-v1',
    'direction', 'Apresentar somente os fatos revisados.',
    'sections', jsonb_build_object(
      'hook', 'Gancho factual.', 'problem', '', 'solution', '',
      'demonstration', '', 'humor', '', 'dialogue', '',
      'onscreenText', '', 'closing', ''
    ),
    'references', jsonb_build_array(jsonb_build_object(
      'assetId', v_asset_id,
      'assetType', 'product_reference',
      'referenceSlot', null,
      'checksumSha256', repeat('a', 64),
      'width', 100,
      'height', 100
    )),
    'review', jsonb_build_object(
      'claimDecisions', jsonb_build_array(jsonb_build_object(
        'index', 0, 'decision', 'verified', 'text', 'Claim literal de teste.'
      )),
      'additionalForbiddenClaims', '[]'::jsonb,
      'scale', jsonb_build_object('status', 'defined'),
      'variationUnsafeAcknowledgements', '[]'::jsonb
    )
  );

  v_reviewed := public.bvf_persist_reviewed_brief_version(
    v_job_id, v_actor_id, v_base_brief_id, 'BVF-UI-01-v1',
    repeat('2', 64),
    jsonb_set(v_review_creative, '{references}', '[]'::jsonb),
    '{}'::uuid[]
  );
  v_base_brief_id := (v_reviewed ->> 'briefVersionId')::uuid;
  if v_reviewed ->> 'created' <> 'true' then
    raise exception 'BVF_UI_TEST_REVIEW_WITHOUT_REFERENCE_FAILED: %', v_reviewed;
  end if;

  v_reviewed := public.bvf_persist_reviewed_brief_version(
    v_job_id, v_actor_id, v_base_brief_id, 'BVF-UI-01-v1',
    repeat('3', 64), v_review_creative, array[v_asset_id]
  );
  v_review_brief_id := (v_reviewed ->> 'briefVersionId')::uuid;
  if v_reviewed ->> 'created' <> 'true'
     or v_reviewed ->> 'status' <> 'waiting_brief_approval' then
    raise exception 'BVF_UI_TEST_REVIEW_FAILED: %', v_reviewed;
  end if;

  update public.video_jobs
  set prompt_final = 'real provider prompt test',
      generation_provider = 'test-provider',
      generation_model = 'test-model',
      estimated_cost = 1.25,
      estimated_cost_currency = 'USD'
  where id = v_job_id;

  v_authorized := public.bvf_authorize_video_generation(
    v_job_id, v_actor_id, v_review_brief_id,
    'test-provider', 'test-model', 1.25, 'USD'
  );
  if v_authorized ->> 'changed' <> 'true'
     or v_authorized ->> 'status' <> 'approved_for_generation' then
    raise exception 'BVF_UI_TEST_AUTHORIZATION_FAILED: %', v_authorized;
  end if;

  v_changed := public.bvf_persist_reviewed_brief_version(
    v_job_id, v_actor_id, v_review_brief_id, 'BVF-UI-01-v1',
    repeat('4', 64),
    jsonb_set(v_review_creative, '{direction}', '"Direção material alterada."'::jsonb),
    array[v_asset_id]
  );
  if v_changed ->> 'approvalInvalidated' <> 'true'
     or not exists (
       select 1 from public.video_jobs job
       where job.id = v_job_id
         and job.status = 'waiting_brief_approval'
         and job.generation_approved_at is null
         and job.generation_approved_brief_version_id is null
         and job.generation_provider is null
         and job.estimated_cost is null
     ) then
    raise exception 'BVF_UI_TEST_APPROVAL_INVALIDATION_FAILED: %', v_changed;
  end if;

  if has_function_privilege(
       'authenticated',
       'public.bvf_persist_reviewed_brief_version(uuid,uuid,uuid,text,text,jsonb,uuid[])',
       'EXECUTE'
     ) then
    raise exception 'BVF_UI_TEST_AUTHENTICATED_RPC_GRANT_PRESENT';
  end if;
end;
$$;

rollback;
