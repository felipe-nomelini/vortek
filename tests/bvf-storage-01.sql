\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor_id uuid;
  v_forbidden_actor_id uuid;
  v_product_id uuid;
  v_persona_id uuid;
  v_first_id uuid := gen_random_uuid();
  v_second_id uuid := gen_random_uuid();
  v_product_asset_id uuid := gen_random_uuid();
  v_created jsonb;
  v_replayed jsonb;
  v_deactivated jsonb;
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
  where product.ativo = true
  order by product.created_at limit 1;

  select persona.id into v_persona_id
  from public.video_personas persona
  where persona.code = 'RAFA' and persona.version = 'v1';

  if v_actor_id is null or v_product_id is null or v_persona_id is null then
    raise exception 'BVF_STORAGE_TEST_PREREQUISITES_MISSING';
  end if;

  v_created := public.bvf_register_reference_asset(
    v_first_id, v_actor_id, 'persona_reference', v_persona_id, null, 'front',
    format('personas/%s/front/%s.jpg', v_persona_id, v_first_id),
    'image/jpeg', 100, 80, repeat('a', 64),
    '{"source_kind":"manual_upload","uploaded_bytes":100}'::jsonb
  );
  if v_created ->> 'created' <> 'true' then
    raise exception 'BVF_STORAGE_TEST_CREATE_FAILED: %', v_created;
  end if;

  v_replayed := public.bvf_register_reference_asset(
    v_first_id, v_actor_id, 'persona_reference', v_persona_id, null, 'front',
    format('personas/%s/front/%s.jpg', v_persona_id, v_first_id),
    'image/jpeg', 100, 80, repeat('a', 64),
    '{"source_kind":"manual_upload","uploaded_bytes":100}'::jsonb
  );
  if v_replayed ->> 'created' <> 'false' then
    raise exception 'BVF_STORAGE_TEST_REPLAY_FAILED: %', v_replayed;
  end if;

  begin
    perform public.bvf_register_reference_asset(
      v_first_id, v_actor_id, 'persona_reference', v_persona_id, null, 'front',
      format('personas/%s/front/%s.jpg', v_persona_id, v_first_id),
      'image/jpeg', 101, 80, repeat('a', 64),
      '{"source_kind":"manual_upload","uploaded_bytes":100}'::jsonb
    );
    raise exception 'BVF_STORAGE_TEST_IDEMPOTENCY_CONFLICT_NOT_BLOCKED';
  exception when sqlstate '23000' then null;
  end;

  perform public.bvf_register_reference_asset(
    v_second_id, v_actor_id, 'persona_reference', v_persona_id, null, 'front',
    format('personas/%s/front/%s.png', v_persona_id, v_second_id),
    'image/png', 120, 90, repeat('b', 64),
    '{"source_kind":"manual_upload","uploaded_bytes":120}'::jsonb
  );
  if not exists (
    select 1 from public.video_assets asset
    where asset.id = v_first_id and asset.active = false
      and asset.deactivated_by = v_actor_id and asset.deactivated_at is not null
      and asset.deactivation_reason = 'substituída por nova referência canônica'
  ) or not exists (
    select 1 from public.video_assets asset
    where asset.id = v_second_id and asset.active = true
  ) then
    raise exception 'BVF_STORAGE_TEST_REPLACEMENT_FAILED';
  end if;

  perform public.bvf_register_reference_asset(
    v_product_asset_id, v_actor_id, 'product_reference', null, v_product_id, null,
    format('products/%s/%s.webp', v_product_id, v_product_asset_id),
    'image/webp', 200, 160, repeat('c', 64),
    '{"source_kind":"product_catalog","uploaded_bytes":200}'::jsonb
  );
  v_deactivated := public.bvf_deactivate_reference_asset(
    v_product_asset_id, v_actor_id, null
  );
  if v_deactivated ->> 'changed' <> 'true' or not exists (
    select 1 from public.video_assets asset
    where asset.id = v_product_asset_id and asset.active = false
      and asset.deactivation_reason = 'desativação manual'
  ) then
    raise exception 'BVF_STORAGE_TEST_DEACTIVATION_FAILED: %', v_deactivated;
  end if;
  if public.bvf_deactivate_reference_asset(v_product_asset_id, v_actor_id, null) ->> 'changed' <> 'false' then
    raise exception 'BVF_STORAGE_TEST_DEACTIVATION_REPLAY_FAILED';
  end if;

  if v_forbidden_actor_id is not null then
    begin
      perform public.bvf_register_reference_asset(
        gen_random_uuid(), v_forbidden_actor_id, 'product_reference', null, v_product_id, null,
        format('products/%s/%s.jpg', v_product_id, gen_random_uuid()),
        'image/jpeg', 10, 10, repeat('d', 64), '{}'::jsonb
      );
      raise exception 'BVF_STORAGE_TEST_PERMISSION_NOT_BLOCKED';
    exception when sqlstate '42501' then null;
    end;
  end if;

  if has_table_privilege('service_role', 'public.video_assets', 'INSERT')
     or has_table_privilege('service_role', 'public.video_assets', 'UPDATE')
     or has_table_privilege('service_role', 'public.video_assets', 'DELETE') then
    raise exception 'BVF_STORAGE_TEST_DIRECT_WRITE_GRANT_PRESENT';
  end if;
  if not has_table_privilege('service_role', 'public.video_assets', 'SELECT') then
    raise exception 'BVF_STORAGE_TEST_SELECT_GRANT_MISSING';
  end if;
end;
$$;

rollback;
