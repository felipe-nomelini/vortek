\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor_id uuid;
  v_product_id uuid;
  v_sku text;
  v_persona_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_first jsonb;
  v_same jsonb;
  v_second jsonb;
  v_input jsonb;
  v_factual jsonb;
  v_brief jsonb;
  v_version_id uuid;
begin
  select profile.id
  into v_actor_id
  from public.profiles profile
  where profile.cargo::text in ('admin', 'gerente')
  order by profile.created_at
  limit 1;

  select product.id, product.sku
  into v_product_id, v_sku
  from public.produtos product
  where nullif(btrim(product.sku), '') is not null
  order by product.created_at
  limit 1;

  select persona.id
  into v_persona_id
  from public.video_personas persona
  where persona.code = 'RAFA'
    and persona.version = 'v1'
    and persona.status = 'active';

  if v_actor_id is null or v_product_id is null or v_persona_id is null then
    raise exception 'BVF_BRIEF_TEST_PREREQUISITE_MISSING';
  end if;

  insert into public.video_jobs (
    id,
    produto_id,
    sku,
    video_type,
    content_scope,
    created_by
  ) values (
    v_job_id,
    v_product_id,
    v_sku,
    'HUMAN_DEMO',
    'SKU',
    v_actor_id
  );

  v_input := jsonb_build_object(
    'product', jsonb_build_object('id', v_product_id, 'sku', v_sku)
  );
  v_factual := jsonb_build_object(
    'verifiedClaims', '[]'::jsonb,
    'forbiddenClaims', '[]'::jsonb,
    'physicalDimensions', '{}'::jsonb,
    'scaleAnchor', null
  );
  v_brief := jsonb_build_object(
    'target', jsonb_build_object(
      'jobId', v_job_id,
      'sku', v_sku,
      'videoType', 'HUMAN_DEMO'
    )
  );

  v_first := public.bvf_persist_brief_version(
    v_job_id,
    v_actor_id,
    'BVF-BRIEF-01-test',
    repeat('a', 64),
    v_input,
    v_factual,
    v_brief,
    v_product_id,
    v_persona_id
  );

  if v_first ->> 'created' <> 'true' or (v_first ->> 'version')::integer <> 1 then
    raise exception 'BVF_BRIEF_TEST_FIRST_VERSION_FAILED: %', v_first;
  end if;

  v_same := public.bvf_persist_brief_version(
    v_job_id,
    v_actor_id,
    'BVF-BRIEF-01-test',
    repeat('a', 64),
    v_input,
    v_factual,
    v_brief,
    v_product_id,
    v_persona_id
  );

  if v_same ->> 'created' <> 'false'
     or (select count(*) from public.video_brief_versions where job_id = v_job_id) <> 1 then
    raise exception 'BVF_BRIEF_TEST_IDEMPOTENCY_FAILED: %', v_same;
  end if;

  v_factual := jsonb_set(
    v_factual,
    '{verifiedClaims}',
    '[{"text":"claim materialmente novo"}]'::jsonb
  );
  v_second := public.bvf_persist_brief_version(
    v_job_id,
    v_actor_id,
    'BVF-BRIEF-01-test',
    repeat('b', 64),
    v_input,
    v_factual,
    v_brief,
    v_product_id,
    v_persona_id
  );

  if v_second ->> 'created' <> 'true'
     or (v_second ->> 'version')::integer <> 2
     or (select count(*) from public.video_brief_versions where job_id = v_job_id) <> 2 then
    raise exception 'BVF_BRIEF_TEST_SECOND_VERSION_FAILED: %', v_second;
  end if;

  select job.current_brief_version_id
  into v_version_id
  from public.video_jobs job
  where job.id = v_job_id
    and job.status = 'waiting_brief_approval'
    and job.persona_id = v_persona_id
    and job.persona_code = 'RAFA'
    and job.persona_version = 'v1';

  if v_version_id is distinct from (v_second ->> 'briefVersionId')::uuid then
    raise exception 'BVF_BRIEF_TEST_JOB_PROJECTION_FAILED';
  end if;

  begin
    update public.video_brief_versions
    set engine_version = 'forbidden'
    where id = v_version_id;
    raise exception 'BVF_BRIEF_TEST_UPDATE_WAS_NOT_BLOCKED';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    delete from public.video_brief_versions where id = v_version_id;
    raise exception 'BVF_BRIEF_TEST_DELETE_WAS_NOT_BLOCKED';
  exception
    when sqlstate '55000' then null;
  end;

  if has_table_privilege('authenticated', 'public.video_brief_versions', 'select')
     or has_table_privilege('service_role', 'public.video_brief_versions', 'insert')
     or not has_table_privilege('service_role', 'public.video_brief_versions', 'select')
     or has_function_privilege(
       'authenticated',
       'public.bvf_persist_brief_version(uuid,uuid,text,text,jsonb,jsonb,jsonb,uuid,uuid)',
       'execute'
     ) then
    raise exception 'BVF_BRIEF_TEST_PRIVILEGES_FAILED';
  end if;
end;
$$;

rollback;
