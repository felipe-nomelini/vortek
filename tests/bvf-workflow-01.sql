\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor_id uuid;
  v_forbidden_actor_id uuid;
  v_product_id uuid;
  v_request_id uuid := gen_random_uuid();
  v_cancel_request_id uuid := gen_random_uuid();
  v_created jsonb;
  v_replayed jsonb;
  v_cancel_job jsonb;
  v_cancelled jsonb;
  v_job_id uuid;
  v_brief_id uuid := gen_random_uuid();
  v_authorized jsonb;
  v_reauthorized jsonb;
begin
  select profile.id into v_actor_id
  from public.profiles profile
  where profile.cargo::text in ('admin', 'gerente')
  order by profile.created_at limit 1;

  select profile.id into v_forbidden_actor_id
  from public.profiles profile
  where profile.cargo::text not in ('admin', 'gerente')
  order by profile.created_at limit 1;

  select product.id into v_product_id
  from public.produtos product
  where product.ativo = true and nullif(btrim(product.sku), '') is not null
  order by product.created_at limit 1;

  if v_actor_id is null or v_product_id is null then
    raise exception 'BVF_WORKFLOW_TEST_PREREQUISITES_MISSING';
  end if;

  v_created := public.bvf_create_video_job(
    v_actor_id, v_request_id, v_product_id, null, 'CINEMATIC_PRODUCT'
  );
  v_job_id := (v_created ->> 'jobId')::uuid;
  if v_created ->> 'created' <> 'true' or v_created ->> 'status' <> 'draft' then
    raise exception 'BVF_WORKFLOW_TEST_CREATE_FAILED: %', v_created;
  end if;

  v_replayed := public.bvf_create_video_job(
    v_actor_id, v_request_id, v_product_id, null, 'CINEMATIC_PRODUCT'
  );
  if v_replayed ->> 'created' <> 'false'
     or v_replayed ->> 'jobId' is distinct from v_created ->> 'jobId' then
    raise exception 'BVF_WORKFLOW_TEST_IDEMPOTENCY_FAILED: %', v_replayed;
  end if;

  begin
    perform public.bvf_create_video_job(
      v_actor_id, v_request_id, v_product_id, null, 'HUMAN_DEMO'
    );
    raise exception 'BVF_WORKFLOW_TEST_IDEMPOTENCY_CONFLICT_NOT_BLOCKED';
  exception when sqlstate '23000' then null;
  end;

  insert into public.video_brief_versions (
    id, job_id, version, engine_version, material_fingerprint,
    input_snapshot, factual_snapshot, creative_brief, created_by
  ) values (
    v_brief_id, v_job_id, 1, 'BVF-WORKFLOW-01-test', repeat('7', 64),
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, v_actor_id
  );
  update public.video_jobs
  set current_brief_version_id = v_brief_id,
      prompt_final = 'test prompt',
      generation_provider = 'test-provider',
      generation_model = 'test-model',
      estimated_cost = 1.25,
      estimated_cost_currency = 'USD',
      status = 'waiting_brief_approval'
  where id = v_job_id;

  v_authorized := public.bvf_authorize_video_generation(
    v_job_id, v_actor_id, v_brief_id, 'test-provider', 'test-model', 1.25, 'USD'
  );
  if v_authorized ->> 'changed' <> 'true'
     or v_authorized ->> 'status' <> 'approved_for_generation' then
    raise exception 'BVF_WORKFLOW_TEST_AUTHORIZATION_FAILED: %', v_authorized;
  end if;
  v_reauthorized := public.bvf_authorize_video_generation(
    v_job_id, v_actor_id, v_brief_id, 'test-provider', 'test-model', 1.25, 'USD'
  );
  if v_reauthorized ->> 'changed' <> 'false' then
    raise exception 'BVF_WORKFLOW_TEST_AUTHORIZATION_REPLAY_FAILED: %', v_reauthorized;
  end if;

  v_cancel_job := public.bvf_create_video_job(
    v_actor_id, v_cancel_request_id, v_product_id, null, 'HUMAN_DEMO'
  );
  v_cancelled := public.bvf_cancel_video_job(
    (v_cancel_job ->> 'jobId')::uuid, v_actor_id, null
  );
  if v_cancelled ->> 'changed' <> 'true'
     or not exists (
       select 1 from public.video_jobs job
       where job.id = (v_cancel_job ->> 'jobId')::uuid
         and job.status = 'cancelled'
         and job.cancelled_by = v_actor_id
         and job.cancelled_at is not null
         and job.cancellation_reason is null
     ) then
    raise exception 'BVF_WORKFLOW_TEST_CANCELLATION_FAILED: %', v_cancelled;
  end if;

  if v_forbidden_actor_id is not null then
    begin
      perform public.bvf_create_video_job(
        v_forbidden_actor_id, gen_random_uuid(), v_product_id, null, 'HUMAN_DEMO'
      );
      raise exception 'BVF_WORKFLOW_TEST_PERMISSION_NOT_BLOCKED';
    exception when sqlstate '42501' then null;
    end;
  end if;

  if has_table_privilege('service_role', 'public.video_jobs', 'INSERT')
     or has_table_privilege('service_role', 'public.video_jobs', 'UPDATE')
     or has_table_privilege('service_role', 'public.video_jobs', 'DELETE') then
    raise exception 'BVF_WORKFLOW_TEST_DIRECT_WRITE_GRANT_PRESENT';
  end if;
end;
$$;

rollback;
