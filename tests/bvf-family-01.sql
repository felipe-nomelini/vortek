\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor_id uuid;
  v_brand text;
  v_category text;
  v_product_ids uuid[];
  v_skus text[];
  v_family_key text := 'BVF_FAMILY_01_TEST_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_suggestion jsonb;
  v_same_suggestion jsonb;
  v_review jsonb;
  v_same_review jsonb;
  v_rejected_suggestion jsonb;
  v_rejected_review jsonb;
  v_family_id uuid;
  v_membership jsonb;
  v_analysis jsonb;
  v_first_analysis jsonb;
  v_same_analysis jsonb;
  v_second_analysis jsonb;
  v_analysis_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_input jsonb;
  v_brief jsonb;
  v_first_brief jsonb;
  v_same_brief jsonb;
  v_membership_change jsonb;
begin
  select profile.id
  into v_actor_id
  from public.profiles profile
  where profile.cargo::text in ('admin', 'gerente')
  order by profile.created_at
  limit 1;

  select product.marca, product.categoria
  into v_brand, v_category
  from public.produtos product
  where product.ativo = true
    and nullif(btrim(product.marca), '') is not null
    and nullif(btrim(product.categoria), '') is not null
  group by product.marca, product.categoria
  having count(*) >= 3
  order by count(*) desc, product.marca, product.categoria
  limit 1;

  select array_agg(candidate.id order by candidate.sku),
         array_agg(candidate.sku order by candidate.sku)
  into v_product_ids, v_skus
  from (
    select product.id, product.sku
    from public.produtos product
    where product.ativo = true
      and product.marca = v_brand
      and product.categoria = v_category
    order by product.sku
    limit 3
  ) candidate;

  if v_actor_id is null or cardinality(v_product_ids) <> 3 then
    raise exception 'BVF_FAMILY_TEST_PREREQUISITE_MISSING';
  end if;

  v_suggestion := public.bvf_record_family_suggestion(
    v_actor_id,
    v_product_ids[1],
    'BVF-FAMILY-SUGGEST-01-test',
    repeat('1', 64),
    jsonb_build_object(
      'schemaVersion', 'BVF-FAMILY-SUGGESTION-v1',
      'seed', jsonb_build_object('id', v_product_ids[1], 'sku', v_skus[1]),
      'candidates', jsonb_build_array(
        jsonb_build_object('id', v_product_ids[2], 'sku', v_skus[2]),
        jsonb_build_object('id', v_product_ids[3], 'sku', v_skus[3])
      )
    )
  );
  if v_suggestion ->> 'created' <> 'true' or v_suggestion ->> 'status' <> 'pending' then
    raise exception 'BVF_FAMILY_TEST_SUGGESTION_FAILED: %', v_suggestion;
  end if;

  v_same_suggestion := public.bvf_record_family_suggestion(
    v_actor_id,
    v_product_ids[1],
    'BVF-FAMILY-SUGGEST-01-test',
    repeat('1', 64),
    jsonb_build_object(
      'schemaVersion', 'BVF-FAMILY-SUGGESTION-v1',
      'seed', jsonb_build_object('id', v_product_ids[1], 'sku', v_skus[1]),
      'candidates', jsonb_build_array(
        jsonb_build_object('id', v_product_ids[2], 'sku', v_skus[2]),
        jsonb_build_object('id', v_product_ids[3], 'sku', v_skus[3])
      )
    )
  );
  if v_same_suggestion ->> 'created' <> 'false'
     or v_same_suggestion ->> 'suggestionId' is distinct from v_suggestion ->> 'suggestionId' then
    raise exception 'BVF_FAMILY_TEST_SUGGESTION_IDEMPOTENCY_FAILED: %', v_same_suggestion;
  end if;

  v_review := public.bvf_review_family_suggestion(
    (v_suggestion ->> 'suggestionId')::uuid,
    v_actor_id,
    'accept',
    'Confirmação transacional FAMILY-01',
    v_family_key,
    'Família de teste transacional',
    'Criada somente dentro de transação com rollback.',
    v_product_ids
  );
  v_family_id := (v_review ->> 'familyId')::uuid;
  if v_review ->> 'status' <> 'accepted' or v_family_id is null then
    raise exception 'BVF_FAMILY_TEST_ACCEPTANCE_FAILED: %', v_review;
  end if;
  if (
    select count(*)
    from public.video_family_products link
    where link.family_id = v_family_id
      and link.removed_at is null
      and link.created_by = v_actor_id
  ) <> 3 then
    raise exception 'BVF_FAMILY_TEST_INITIAL_MEMBERSHIP_AUDIT_FAILED';
  end if;

  v_same_review := public.bvf_review_family_suggestion(
    (v_suggestion ->> 'suggestionId')::uuid,
    v_actor_id,
    'accept',
    'Confirmação transacional FAMILY-01',
    v_family_key,
    'Família de teste transacional',
    'Criada somente dentro de transação com rollback.',
    v_product_ids
  );
  if v_same_review ->> 'familyId' is distinct from v_family_id::text then
    raise exception 'BVF_FAMILY_TEST_REVIEW_IDEMPOTENCY_FAILED: %', v_same_review;
  end if;

  v_rejected_suggestion := public.bvf_record_family_suggestion(
    v_actor_id,
    v_product_ids[1],
    'BVF-FAMILY-SUGGEST-01-test',
    repeat('2', 64),
    jsonb_build_object(
      'schemaVersion', 'BVF-FAMILY-SUGGESTION-v1',
      'seed', jsonb_build_object('id', v_product_ids[1], 'sku', v_skus[1]),
      'candidates', jsonb_build_array(
        jsonb_build_object('id', v_product_ids[2], 'sku', v_skus[2])
      )
    )
  );
  v_rejected_review := public.bvf_review_family_suggestion(
    (v_rejected_suggestion ->> 'suggestionId')::uuid,
    v_actor_id,
    'reject',
    'Rejeição transacional de teste',
    null,
    null,
    null,
    '{}'::uuid[]
  );
  if v_rejected_review ->> 'status' <> 'rejected'
     or v_rejected_review ->> 'familyId' is not null then
    raise exception 'BVF_FAMILY_TEST_REJECTION_FAILED: %', v_rejected_review;
  end if;

  select jsonb_build_object(
    'schemaVersion', 'BVF-FAMILY-MEMBERSHIP-v1',
    'familyId', v_family_id,
    'members', jsonb_agg(
      jsonb_build_object('productId', link.produto_id, 'sku', link.sku)
      order by link.sku
    )
  )
  into v_membership
  from public.video_family_products link
  where link.family_id = v_family_id and link.removed_at is null;

  v_analysis := jsonb_build_object(
    'schemaVersion', 'BVF-FAMILY-ANALYSIS-v1',
    'family', jsonb_build_object('id', v_family_id, 'familyKey', v_family_key),
    'members', v_membership -> 'members',
    'verifiedClaims', '[]'::jsonb,
    'forbiddenClaims', '[]'::jsonb,
    'physicalDimensions', '{}'::jsonb,
    'scaleAnchor', null,
    'variationSafe', '[]'::jsonb,
    'variationUnsafe', jsonb_build_array(
      jsonb_build_object(
        'key', 'voltage',
        'reason', 'missing_evidence',
        'blockedIn', jsonb_build_array('dialogue', 'onscreen_text', 'closing', 'claims')
      )
    )
  );
  v_first_analysis := public.bvf_persist_family_analysis(
    v_family_id,
    v_actor_id,
    'BVF-FAMILY-01-test',
    repeat('3', 64),
    v_membership,
    v_analysis
  );
  v_analysis_id := (v_first_analysis ->> 'analysisVersionId')::uuid;
  if v_first_analysis ->> 'created' <> 'true'
     or (v_first_analysis ->> 'version')::integer <> 1 then
    raise exception 'BVF_FAMILY_TEST_FIRST_ANALYSIS_FAILED: %', v_first_analysis;
  end if;

  v_same_analysis := public.bvf_persist_family_analysis(
    v_family_id,
    v_actor_id,
    'BVF-FAMILY-01-test',
    repeat('3', 64),
    v_membership,
    v_analysis
  );
  if v_same_analysis ->> 'created' <> 'false'
     or v_same_analysis ->> 'analysisVersionId' is distinct from v_analysis_id::text then
    raise exception 'BVF_FAMILY_TEST_ANALYSIS_IDEMPOTENCY_FAILED: %', v_same_analysis;
  end if;

  begin
    update public.video_family_analysis_versions
    set engine_version = 'forbidden'
    where id = v_analysis_id;
    raise exception 'BVF_FAMILY_TEST_ANALYSIS_UPDATE_WAS_NOT_BLOCKED';
  exception
    when sqlstate '55000' then null;
  end;
  begin
    delete from public.video_family_analysis_versions where id = v_analysis_id;
    raise exception 'BVF_FAMILY_TEST_ANALYSIS_DELETE_WAS_NOT_BLOCKED';
  exception
    when sqlstate '55000' then null;
  end;

  insert into public.video_jobs(
    id, family_id, family_key, video_type, content_scope, created_by
  ) values (
    v_job_id, v_family_id, v_family_key, 'FAMILY_VIDEO', 'FAMILY', v_actor_id
  );
  v_input := jsonb_build_object(
    'job', jsonb_build_object(
      'id', v_job_id,
      'familyId', v_family_id,
      'familyKey', v_family_key,
      'videoType', 'FAMILY_VIDEO'
    ),
    'analysisVersion', jsonb_build_object(
      'id', v_analysis_id,
      'version', 1,
      'materialFingerprint', repeat('3', 64)
    )
  );
  v_brief := jsonb_build_object(
    'target', jsonb_build_object(
      'jobId', v_job_id,
      'familyId', v_family_id,
      'familyKey', v_family_key,
      'videoType', 'FAMILY_VIDEO'
    ),
    'contentGuard', jsonb_build_object(
      'allowedFactKeys', '[]'::jsonb,
      'allowedClaims', '[]'::jsonb,
      'blockedAttributeKeys', jsonb_build_array('voltage'),
      'blockedIn', jsonb_build_array('dialogue', 'onscreen_text', 'closing', 'claims')
    )
  );
  v_first_brief := public.bvf_persist_family_brief_version(
    v_job_id,
    v_actor_id,
    'BVF-FAMILY-01-test',
    repeat('4', 64),
    v_input,
    v_analysis,
    v_brief,
    v_family_id,
    v_analysis_id,
    null
  );
  if v_first_brief ->> 'created' <> 'true'
     or v_first_brief ->> 'status' <> 'waiting_brief_approval'
     or (v_first_brief ->> 'version')::integer <> 1 then
    raise exception 'BVF_FAMILY_TEST_FIRST_BRIEF_FAILED: %', v_first_brief;
  end if;
  v_same_brief := public.bvf_persist_family_brief_version(
    v_job_id,
    v_actor_id,
    'BVF-FAMILY-01-test',
    repeat('4', 64),
    v_input,
    v_analysis,
    v_brief,
    v_family_id,
    v_analysis_id,
    null
  );
  if v_same_brief ->> 'created' <> 'false'
     or v_same_brief ->> 'briefVersionId' is distinct from v_first_brief ->> 'briefVersionId' then
    raise exception 'BVF_FAMILY_TEST_BRIEF_IDEMPOTENCY_FAILED: %', v_same_brief;
  end if;

  v_membership_change := public.bvf_set_family_members(
    v_family_id,
    v_actor_id,
    array[v_product_ids[1], v_product_ids[2]]
  );
  if v_membership_change ->> 'changed' <> 'true'
     or (v_membership_change ->> 'memberCount')::integer <> 2
     or exists (
       select 1 from public.video_families family
       where family.id = v_family_id and family.current_analysis_version_id is not null
     )
     or not exists (
       select 1 from public.video_family_products link
       where link.family_id = v_family_id
         and link.produto_id = v_product_ids[3]
         and link.removed_at is not null
         and link.removed_by = v_actor_id
     ) then
    raise exception 'BVF_FAMILY_TEST_TEMPORAL_MEMBERSHIP_FAILED: %', v_membership_change;
  end if;

  begin
    perform public.bvf_persist_family_analysis(
      v_family_id,
      v_actor_id,
      'BVF-FAMILY-01-test',
      repeat('5', 64),
      v_membership,
      v_analysis
    );
    raise exception 'BVF_FAMILY_TEST_STALE_ANALYSIS_WAS_NOT_BLOCKED';
  exception
    when sqlstate '55000' then null;
  end;

  select jsonb_build_object(
    'schemaVersion', 'BVF-FAMILY-MEMBERSHIP-v1',
    'familyId', v_family_id,
    'members', jsonb_agg(
      jsonb_build_object('productId', link.produto_id, 'sku', link.sku)
      order by link.sku
    )
  )
  into v_membership
  from public.video_family_products link
  where link.family_id = v_family_id and link.removed_at is null;
  v_analysis := jsonb_set(v_analysis, '{members}', v_membership -> 'members');
  v_second_analysis := public.bvf_persist_family_analysis(
    v_family_id,
    v_actor_id,
    'BVF-FAMILY-01-test',
    repeat('6', 64),
    v_membership,
    v_analysis
  );
  if v_second_analysis ->> 'created' <> 'true'
     or (v_second_analysis ->> 'version')::integer <> 2 then
    raise exception 'BVF_FAMILY_TEST_SECOND_ANALYSIS_FAILED: %', v_second_analysis;
  end if;

  if has_table_privilege('authenticated', 'public.video_family_suggestions', 'select')
     or has_table_privilege('authenticated', 'public.video_family_analysis_versions', 'select')
     or has_table_privilege('service_role', 'public.video_family_suggestions', 'insert')
     or has_table_privilege('service_role', 'public.video_family_analysis_versions', 'insert')
     or has_table_privilege('service_role', 'public.video_families', 'insert')
     or has_table_privilege('service_role', 'public.video_family_products', 'update')
     or not has_table_privilege('service_role', 'public.video_family_suggestions', 'select')
     or has_function_privilege(
       'authenticated',
       'public.bvf_persist_family_analysis(uuid,uuid,text,text,jsonb,jsonb)',
       'execute'
     ) then
    raise exception 'BVF_FAMILY_TEST_PRIVILEGES_FAILED';
  end if;
end;
$$;

rollback;
