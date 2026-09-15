-- BENTEVI VIDEO FACTORY — BVF-STORAGE-01
-- Referências canônicas privadas, histórico sem DELETE e acesso somente pelo backend.
-- Nenhuma função desta migration escreve fora do domínio video_*.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from public.video_assets) then
    raise exception using
      errcode = '55000',
      message = 'BVF_STORAGE_EXISTING_ASSETS_REQUIRE_MANUAL_AUDIT';
  end if;
end;
$$;

alter table public.video_assets
  alter column job_id drop not null,
  add column reference_slot text,
  add column active boolean not null default true,
  add column created_by uuid,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid,
  add column deactivation_reason text;

alter table public.video_assets
  add constraint video_assets_created_by_fkey
  foreign key (created_by)
  references public.profiles(id)
  on delete restrict,
  add constraint video_assets_deactivated_by_fkey
  foreign key (deactivated_by)
  references public.profiles(id)
  on delete restrict;

alter table public.video_assets
  drop constraint video_assets_attempt_required_check,
  add constraint video_assets_reference_slot_check check (
    reference_slot is null or reference_slot in ('front', 'profile', 'full_body')
  ),
  add constraint video_assets_lifecycle_check check (
    (active = true
      and deactivated_at is null
      and deactivated_by is null
      and deactivation_reason is null)
    or
    (active = false
      and deactivated_at is not null
      and deactivated_by is not null
      and nullif(btrim(deactivation_reason), '') is not null)
  ),
  add constraint video_assets_deactivation_reason_check check (
    deactivation_reason is null or char_length(deactivation_reason) <= 500
  ),
  add constraint video_assets_association_check check (
    (
      asset_type = 'persona_reference'
      and job_id is null
      and attempt_id is null
      and produto_id is null
      and reference_slot is not null
      and created_by is not null
      and width is not null
      and height is not null
      and checksum_sha256 is not null
    )
    or
    (
      asset_type = 'product_reference'
      and job_id is null
      and attempt_id is null
      and persona_id is null
      and reference_slot is null
      and created_by is not null
      and width is not null
      and height is not null
      and checksum_sha256 is not null
    )
    or
    (
      asset_type in ('generated_video', 'approved_master', 'thumbnail', 'poster_frame')
      and job_id is not null
      and attempt_id is not null
      and persona_id is null
      and produto_id is null
      and reference_slot is null
    )
  ),
  add constraint video_assets_storage_prefix_check check (
    (asset_type = 'persona_reference'
      and storage_path ~ '^personas/[0-9a-f-]{36}/(front|profile|full_body)/[0-9a-f-]{36}\.(jpg|png|webp)$')
    or
    (asset_type = 'product_reference'
      and storage_path ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$')
    or
    (asset_type in ('generated_video', 'thumbnail', 'poster_frame')
      and storage_path ~ '^jobs/[0-9a-f-]{36}/[0-9a-f-]{36}/(generated_video|thumbnail|poster_frame)/[0-9a-f-]{36}\.(mp4|jpg|png|webp)$')
    or
    (asset_type = 'approved_master'
      and storage_path ~ '^approved/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$')
  );

create unique index video_assets_persona_active_slot_idx
  on public.video_assets (persona_id, reference_slot)
  where asset_type = 'persona_reference' and active = true and persona_id is not null;

create index video_assets_persona_history_idx
  on public.video_assets (persona_id, created_at desc)
  where asset_type = 'persona_reference' and persona_id is not null;

create index video_assets_product_history_idx
  on public.video_assets (produto_id, created_at desc)
  where asset_type = 'product_reference' and produto_id is not null;

create function public.bvf_register_reference_asset(
  p_asset_id uuid,
  p_actor_id uuid,
  p_asset_type text,
  p_persona_id uuid,
  p_produto_id uuid,
  p_reference_slot text,
  p_storage_path text,
  p_mime_type text,
  p_width integer,
  p_height integer,
  p_checksum_sha256 text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.video_assets%rowtype;
  v_asset public.video_assets%rowtype;
begin
  if p_asset_id is null or p_actor_id is null
     or p_asset_type not in ('persona_reference', 'product_reference')
     or coalesce(btrim(p_storage_path), '') = ''
     or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_width is null or p_width <= 0
     or p_height is null or p_height <= 0
     or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
     or p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'BVF_STORAGE_REQUIRED_INPUT_MISSING';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_STORAGE_PERMISSION_DENIED';
  end if;

  select asset.* into v_existing
  from public.video_assets asset
  where asset.id = p_asset_id
  for update;

  if found then
    if v_existing.asset_type is distinct from p_asset_type
       or v_existing.persona_id is distinct from p_persona_id
       or v_existing.produto_id is distinct from p_produto_id
       or v_existing.reference_slot is distinct from p_reference_slot
       or v_existing.storage_path is distinct from btrim(p_storage_path)
       or v_existing.mime_type is distinct from p_mime_type
       or v_existing.width is distinct from p_width
       or v_existing.height is distinct from p_height
       or v_existing.checksum_sha256 is distinct from p_checksum_sha256
       or v_existing.metadata is distinct from p_metadata then
      raise exception using errcode = '23000', message = 'BVF_STORAGE_IDEMPOTENCY_CONFLICT';
    end if;

    return jsonb_build_object(
      'assetId', v_existing.id,
      'created', false,
      'active', v_existing.active
    );
  end if;

  if p_asset_type = 'persona_reference' then
    if p_persona_id is null or p_produto_id is not null
       or p_reference_slot not in ('front', 'profile', 'full_body') then
      raise exception using errcode = '22023', message = 'BVF_STORAGE_PERSONA_TARGET_REQUIRED';
    end if;

    perform 1
    from public.video_personas persona
    where persona.id = p_persona_id and persona.status in ('active', 'draft')
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'BVF_STORAGE_PERSONA_NOT_FOUND';
    end if;

    update public.video_assets asset
    set active = false,
        deactivated_at = now(),
        deactivated_by = p_actor_id,
        deactivation_reason = 'substituída por nova referência canônica'
    where asset.asset_type = 'persona_reference'
      and asset.persona_id = p_persona_id
      and asset.reference_slot = p_reference_slot
      and asset.active = true;
  else
    if p_produto_id is null or p_persona_id is not null or p_reference_slot is not null then
      raise exception using errcode = '22023', message = 'BVF_STORAGE_PRODUCT_TARGET_REQUIRED';
    end if;

    perform 1
    from public.produtos product
    where product.id = p_produto_id and product.ativo = true;
    if not found then
      raise exception using errcode = 'P0002', message = 'BVF_STORAGE_ACTIVE_PRODUCT_NOT_FOUND';
    end if;
  end if;

  insert into public.video_assets (
    id,
    asset_type,
    persona_id,
    produto_id,
    reference_slot,
    storage_path,
    mime_type,
    width,
    height,
    checksum_sha256,
    metadata,
    created_by
  ) values (
    p_asset_id,
    p_asset_type,
    p_persona_id,
    p_produto_id,
    p_reference_slot,
    btrim(p_storage_path),
    p_mime_type,
    p_width,
    p_height,
    p_checksum_sha256,
    p_metadata,
    p_actor_id
  ) returning * into v_asset;

  return jsonb_build_object('assetId', v_asset.id, 'created', true, 'active', true);
end;
$$;

create function public.bvf_deactivate_reference_asset(
  p_asset_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.video_assets%rowtype;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'desativação manual');
begin
  if p_asset_id is null or p_actor_id is null then
    raise exception using errcode = '22023', message = 'BVF_STORAGE_REQUIRED_INPUT_MISSING';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_STORAGE_PERMISSION_DENIED';
  end if;

  select asset.* into v_asset
  from public.video_assets asset
  where asset.id = p_asset_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_STORAGE_ASSET_NOT_FOUND';
  end if;
  if v_asset.asset_type not in ('persona_reference', 'product_reference') then
    raise exception using errcode = '22023', message = 'BVF_STORAGE_REFERENCE_ASSET_REQUIRED';
  end if;
  if v_asset.active = false then
    return jsonb_build_object('assetId', v_asset.id, 'changed', false, 'active', false);
  end if;

  update public.video_assets
  set active = false,
      deactivated_at = now(),
      deactivated_by = p_actor_id,
      deactivation_reason = v_reason
  where id = p_asset_id;

  return jsonb_build_object('assetId', p_asset_id, 'changed', true, 'active', false);
end;
$$;

revoke insert, update on table public.video_assets from service_role;

revoke all on function public.bvf_register_reference_asset(
  uuid, uuid, text, uuid, uuid, text, text, text, integer, integer, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.bvf_deactivate_reference_asset(uuid, uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.bvf_register_reference_asset(
  uuid, uuid, text, uuid, uuid, text, text, text, integer, integer, text, jsonb
) to service_role;
grant execute on function public.bvf_deactivate_reference_asset(uuid, uuid, text)
to service_role;

comment on column public.video_assets.reference_slot is
  'Canonical persona view: front, profile or full_body. Null for all other asset types.';
comment on column public.video_assets.active is
  'Operational visibility flag. Deactivation preserves the database row and private Storage object.';
comment on column public.video_assets.created_by is
  'Human actor for reference uploads. Future worker-produced assets may leave this null.';
comment on column public.video_assets.deactivation_reason is
  'Required audit reason when a reference is inactive; replacements are recorded automatically.';

select pg_notify('pgrst', 'reload schema');

commit;
