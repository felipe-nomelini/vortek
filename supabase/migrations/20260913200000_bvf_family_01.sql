-- BENTEVI VIDEO FACTORY — BVF-FAMILY-01
-- Sugestões com confirmação humana, associação temporal e análise familiar
-- imutável. Nenhum domínio operacional existente recebe escrita ou trigger.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.video_family_suggestions (
  id uuid primary key default gen_random_uuid(),
  seed_product_id uuid references public.produtos(id) on delete set null,
  seed_sku text not null check (btrim(seed_sku) <> ''),
  algorithm_version text not null check (btrim(algorithm_version) <> ''),
  material_fingerprint text not null unique
    check (material_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_snapshot jsonb not null
    check (jsonb_typeof(candidate_snapshot) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  review_note text,
  review_snapshot jsonb check (
    review_snapshot is null or jsonb_typeof(review_snapshot) = 'object'
  ),
  reviewed_at timestamptz,
  confirmed_family_id uuid references public.video_families(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint video_family_suggestions_review_state_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and review_snapshot is null and confirmed_family_id is null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and review_snapshot is not null and confirmed_family_id is null)
    or (status = 'accepted' and reviewed_by is not null and reviewed_at is not null and review_snapshot is not null and confirmed_family_id is not null)
  )
);

create index video_family_suggestions_seed_product_id_idx
  on public.video_family_suggestions(seed_product_id)
  where seed_product_id is not null;
create index video_family_suggestions_status_created_at_idx
  on public.video_family_suggestions(status, created_at desc);
create index video_family_suggestions_created_by_idx
  on public.video_family_suggestions(created_by);
create index video_family_suggestions_reviewed_by_idx
  on public.video_family_suggestions(reviewed_by)
  where reviewed_by is not null;
create index video_family_suggestions_confirmed_family_id_idx
  on public.video_family_suggestions(confirmed_family_id)
  where confirmed_family_id is not null;

alter table public.video_family_products
  add column created_by uuid references public.profiles(id) on delete restrict,
  add column removed_by uuid references public.profiles(id) on delete restrict;

create index video_family_products_created_by_idx
  on public.video_family_products(created_by)
  where created_by is not null;
create index video_family_products_removed_by_idx
  on public.video_family_products(removed_by)
  where removed_by is not null;

create table public.video_family_analysis_versions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.video_families(id) on delete restrict,
  version integer not null check (version > 0),
  engine_version text not null check (btrim(engine_version) <> ''),
  material_fingerprint text not null check (material_fingerprint ~ '^[0-9a-f]{64}$'),
  membership_snapshot jsonb not null check (jsonb_typeof(membership_snapshot) = 'object'),
  analysis_snapshot jsonb not null check (jsonb_typeof(analysis_snapshot) = 'object'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (family_id, version),
  unique (family_id, material_fingerprint),
  unique (family_id, id)
);

create index video_family_analysis_versions_family_version_idx
  on public.video_family_analysis_versions(family_id, version desc);
create index video_family_analysis_versions_created_by_idx
  on public.video_family_analysis_versions(created_by);

alter table public.video_families
  add column current_analysis_version_id uuid;

alter table public.video_families
  add constraint video_families_current_analysis_version_fkey
  foreign key (id, current_analysis_version_id)
  references public.video_family_analysis_versions(family_id, id)
  on delete restrict;

create index video_families_current_analysis_version_id_idx
  on public.video_families(current_analysis_version_id)
  where current_analysis_version_id is not null;

alter table public.video_brief_versions
  add column family_analysis_version_id uuid
  references public.video_family_analysis_versions(id) on delete restrict;

create index video_brief_versions_family_analysis_version_id_idx
  on public.video_brief_versions(family_analysis_version_id)
  where family_analysis_version_id is not null;

create function public.bvf_family_analysis_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'BVF_FAMILY_ANALYSIS_VERSION_IMMUTABLE';
end;
$$;

create trigger trg_bvf_family_analysis_version_immutable
before update or delete on public.video_family_analysis_versions
for each row execute function public.bvf_family_analysis_version_immutable();

create function public.bvf_record_family_suggestion(
  p_actor_id uuid,
  p_seed_product_id uuid,
  p_algorithm_version text,
  p_material_fingerprint text,
  p_candidate_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed public.produtos%rowtype;
  v_existing public.video_family_suggestions%rowtype;
  v_id uuid;
begin
  if p_actor_id is null or p_seed_product_id is null then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_REQUIRED_IDENTIFIER_MISSING';
  end if;
  if coalesce(btrim(p_algorithm_version), '') = ''
     or p_material_fingerprint is null
     or p_material_fingerprint !~ '^[0-9a-f]{64}$'
     or coalesce(jsonb_typeof(p_candidate_snapshot), '') <> 'object'
     or p_candidate_snapshot ->> 'schemaVersion' <> 'BVF-FAMILY-SUGGESTION-v1'
     or p_candidate_snapshot #>> '{seed,id}' is distinct from p_seed_product_id::text
     or coalesce(jsonb_typeof(p_candidate_snapshot -> 'candidates'), '') <> 'array'
     or jsonb_array_length(p_candidate_snapshot -> 'candidates') not between 1 and 19 then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_INVALID_SUGGESTION';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_FAMILY_PERMISSION_DENIED';
  end if;
  select product.* into v_seed
  from public.produtos product
  where product.id = p_seed_product_id and product.ativo = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_FAMILY_ACTIVE_SEED_NOT_FOUND';
  end if;
  if p_candidate_snapshot #>> '{seed,sku}' is distinct from v_seed.sku then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_SEED_SNAPSHOT_MISMATCH';
  end if;
  if (
    select count(distinct candidate ->> 'id')
    from jsonb_array_elements(p_candidate_snapshot -> 'candidates') candidate
  ) <> jsonb_array_length(p_candidate_snapshot -> 'candidates')
     or exists (
       select 1
       from jsonb_array_elements(p_candidate_snapshot -> 'candidates') candidate
       left join public.produtos product on product.id = (candidate ->> 'id')::uuid
       where product.id is null
          or product.id = v_seed.id
          or product.ativo is not true
          or product.sku is distinct from candidate ->> 'sku'
          or product.marca is distinct from v_seed.marca
          or product.categoria is distinct from v_seed.categoria
     ) then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_CANDIDATE_SNAPSHOT_MISMATCH';
  end if;

  select suggestion.* into v_existing
  from public.video_family_suggestions suggestion
  where suggestion.material_fingerprint = p_material_fingerprint;
  if found then
    if v_existing.algorithm_version <> p_algorithm_version
       or v_existing.candidate_snapshot <> p_candidate_snapshot then
      raise exception using errcode = '23000', message = 'BVF_FAMILY_SUGGESTION_FINGERPRINT_CONFLICT';
    end if;
    return jsonb_build_object(
      'suggestionId', v_existing.id,
      'created', false,
      'status', v_existing.status
    );
  end if;

  insert into public.video_family_suggestions(
    seed_product_id, seed_sku, algorithm_version, material_fingerprint,
    candidate_snapshot, created_by
  ) values (
    v_seed.id, v_seed.sku, p_algorithm_version, p_material_fingerprint,
    p_candidate_snapshot, p_actor_id
  ) returning id into v_id;
  return jsonb_build_object('suggestionId', v_id, 'created', true, 'status', 'pending');
end;
$$;

create function public.bvf_review_family_suggestion(
  p_suggestion_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_review_note text,
  p_family_key text,
  p_family_name text,
  p_family_description text,
  p_member_product_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suggestion public.video_family_suggestions%rowtype;
  v_seed public.produtos%rowtype;
  v_family_id uuid;
  v_count integer;
  v_review_snapshot jsonb;
begin
  if p_suggestion_id is null or p_actor_id is null
     or p_decision not in ('accept', 'reject') then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_INVALID_REVIEW';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_FAMILY_PERMISSION_DENIED';
  end if;

  select suggestion.* into v_suggestion
  from public.video_family_suggestions suggestion
  where suggestion.id = p_suggestion_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_FAMILY_SUGGESTION_NOT_FOUND';
  end if;
  if p_decision = 'reject' then
    v_review_snapshot := jsonb_build_object(
      'decision', 'reject',
      'note', nullif(btrim(p_review_note), '')
    );
  else
    v_review_snapshot := jsonb_build_object(
      'decision', 'accept',
      'familyKey', nullif(btrim(p_family_key), ''),
      'name', nullif(btrim(p_family_name), ''),
      'description', nullif(btrim(p_family_description), ''),
      'memberProductIds', (
        select coalesce(jsonb_agg(product_id order by product_id), '[]'::jsonb)
        from unnest(coalesce(p_member_product_ids, '{}'::uuid[])) product_id
      )
    );
  end if;
  if v_suggestion.status <> 'pending' then
    if (p_decision = 'accept' and v_suggestion.status = 'accepted')
       or (p_decision = 'reject' and v_suggestion.status = 'rejected') then
      if v_suggestion.review_snapshot is distinct from v_review_snapshot then
        raise exception using errcode = '23000', message = 'BVF_FAMILY_REVIEW_IDEMPOTENCY_CONFLICT';
      end if;
      return jsonb_build_object(
        'suggestionId', v_suggestion.id,
        'status', v_suggestion.status,
        'familyId', v_suggestion.confirmed_family_id
      );
    end if;
    raise exception using errcode = '55000', message = 'BVF_FAMILY_SUGGESTION_ALREADY_REVIEWED';
  end if;

  if p_decision = 'reject' then
    update public.video_family_suggestions
    set status = 'rejected', reviewed_by = p_actor_id,
        reviewed_at = now(), review_note = nullif(btrim(p_review_note), ''),
        review_snapshot = v_review_snapshot
    where id = v_suggestion.id;
    return jsonb_build_object(
      'suggestionId', v_suggestion.id, 'status', 'rejected', 'familyId', null
    );
  end if;

  if coalesce(btrim(p_family_key), '') = ''
     or p_family_key <> upper(btrim(p_family_key))
     or p_family_key !~ '^[A-Z0-9_]+$'
     or coalesce(btrim(p_family_name), '') = '' then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_INVALID_IDENTITY';
  end if;
  v_count := coalesce(cardinality(p_member_product_ids), 0);
  if v_count not between 2 and 20
     or (select count(distinct product_id) from unnest(p_member_product_ids) product_id) <> v_count then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_MEMBER_COUNT_INVALID';
  end if;
  if not (v_suggestion.seed_product_id = any(p_member_product_ids)) then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_SEED_REQUIRED';
  end if;
  if exists (
    select 1 from unnest(p_member_product_ids) selected(product_id)
    where selected.product_id <> v_suggestion.seed_product_id
      and not exists (
        select 1
        from jsonb_array_elements(v_suggestion.candidate_snapshot -> 'candidates') candidate
        where candidate ->> 'id' = selected.product_id::text
      )
  ) then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_MEMBER_OUTSIDE_SUGGESTION';
  end if;

  select product.* into v_seed
  from public.produtos product
  where product.id = v_suggestion.seed_product_id and product.ativo = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_FAMILY_ACTIVE_SEED_NOT_FOUND';
  end if;
  if (
    select count(*) from public.produtos product
    where product.id = any(p_member_product_ids)
      and product.ativo = true
      and product.marca is not distinct from v_seed.marca
      and product.categoria is not distinct from v_seed.categoria
  ) <> v_count then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_MEMBER_IDENTITY_MISMATCH';
  end if;

  insert into public.video_families(
    family_key, name, brand, category, description, default_video_type, active
  ) values (
    btrim(p_family_key), btrim(p_family_name), nullif(btrim(v_seed.marca), ''),
    nullif(btrim(v_seed.categoria), ''), nullif(btrim(p_family_description), ''),
    'FAMILY_VIDEO', true
  ) returning id into v_family_id;

  insert into public.video_family_products(family_id, produto_id, sku, created_by)
  select v_family_id, product.id, product.sku, p_actor_id
  from public.produtos product
  where product.id = any(p_member_product_ids)
  order by product.id;

  update public.video_family_suggestions
  set status = 'accepted', reviewed_by = p_actor_id, reviewed_at = now(),
      review_note = nullif(btrim(p_review_note), ''), review_snapshot = v_review_snapshot,
      confirmed_family_id = v_family_id
  where id = v_suggestion.id;

  return jsonb_build_object(
    'suggestionId', v_suggestion.id, 'status', 'accepted', 'familyId', v_family_id
  );
end;
$$;

create function public.bvf_set_family_members(
  p_family_id uuid,
  p_actor_id uuid,
  p_member_product_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family public.video_families%rowtype;
  v_seed public.produtos%rowtype;
  v_count integer;
  v_current uuid[];
  v_requested uuid[];
begin
  if p_family_id is null or p_actor_id is null then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_REQUIRED_IDENTIFIER_MISSING';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_FAMILY_PERMISSION_DENIED';
  end if;
  v_count := coalesce(cardinality(p_member_product_ids), 0);
  if v_count not between 2 and 20
     or (select count(distinct product_id) from unnest(p_member_product_ids) product_id) <> v_count then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_MEMBER_COUNT_INVALID';
  end if;

  select family.* into v_family
  from public.video_families family
  where family.id = p_family_id and family.active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_FAMILY_NOT_FOUND';
  end if;

  select product.* into v_seed
  from public.produtos product
  where product.id = p_member_product_ids[1] and product.ativo = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_FAMILY_ACTIVE_MEMBER_NOT_FOUND';
  end if;
  if (
    select count(*) from public.produtos product
    where product.id = any(p_member_product_ids)
      and product.ativo = true
      and product.marca is not distinct from v_seed.marca
      and product.categoria is not distinct from v_seed.categoria
  ) <> v_count then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_MEMBER_IDENTITY_MISMATCH';
  end if;
  if nullif(btrim(v_family.brand), '') is distinct from nullif(btrim(v_seed.marca), '')
     or nullif(btrim(v_family.category), '') is distinct from nullif(btrim(v_seed.categoria), '') then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_IDENTITY_MISMATCH';
  end if;

  perform 1
  from public.video_family_products link
  where link.family_id = v_family.id and link.removed_at is null
  order by link.id
  for update;
  select coalesce(array_agg(link.produto_id order by link.produto_id), '{}'::uuid[])
  into v_current
  from public.video_family_products link
  where link.family_id = v_family.id and link.removed_at is null;
  select array_agg(product_id order by product_id) into v_requested
  from unnest(p_member_product_ids) product_id;
  if v_current = v_requested then
    return jsonb_build_object('familyId', v_family.id, 'memberCount', v_count, 'changed', false);
  end if;

  update public.video_family_products link
  set removed_at = now(), removed_by = p_actor_id
  where link.family_id = v_family.id
    and link.removed_at is null
    and not (link.produto_id = any(p_member_product_ids));

  insert into public.video_family_products(family_id, produto_id, sku, created_by)
  select v_family.id, product.id, product.sku, p_actor_id
  from public.produtos product
  where product.id = any(p_member_product_ids)
    and not exists (
      select 1 from public.video_family_products link
      where link.family_id = v_family.id
        and link.produto_id = product.id
        and link.removed_at is null
    )
  order by product.id;

  update public.video_families
  set current_analysis_version_id = null,
      verified_claims = '[]'::jsonb,
      forbidden_claims = '[]'::jsonb,
      variation_safe = '[]'::jsonb,
      variation_unsafe = '[]'::jsonb
  where id = v_family.id;

  return jsonb_build_object('familyId', v_family.id, 'memberCount', v_count, 'changed', true);
end;
$$;

create function public.bvf_persist_family_analysis(
  p_family_id uuid,
  p_actor_id uuid,
  p_engine_version text,
  p_material_fingerprint text,
  p_membership_snapshot jsonb,
  p_analysis_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family public.video_families%rowtype;
  v_current public.video_family_analysis_versions%rowtype;
  v_members jsonb;
  v_version integer;
  v_id uuid;
begin
  if p_family_id is null or p_actor_id is null
     or coalesce(btrim(p_engine_version), '') = ''
     or p_material_fingerprint is null
     or p_material_fingerprint !~ '^[0-9a-f]{64}$'
     or coalesce(jsonb_typeof(p_membership_snapshot), '') <> 'object'
     or coalesce(jsonb_typeof(p_membership_snapshot -> 'members'), '') <> 'array'
     or coalesce(jsonb_typeof(p_analysis_snapshot), '') <> 'object'
     or coalesce(jsonb_typeof(p_analysis_snapshot -> 'members'), '') <> 'array'
     or coalesce(jsonb_typeof(p_analysis_snapshot -> 'verifiedClaims'), '') <> 'array'
     or coalesce(jsonb_typeof(p_analysis_snapshot -> 'forbiddenClaims'), '') <> 'array'
     or coalesce(jsonb_typeof(p_analysis_snapshot -> 'physicalDimensions'), '') <> 'object'
     or coalesce(jsonb_typeof(p_analysis_snapshot -> 'variationSafe'), '') <> 'array'
     or coalesce(jsonb_typeof(p_analysis_snapshot -> 'variationUnsafe'), '') <> 'array'
     or p_membership_snapshot ->> 'schemaVersion' <> 'BVF-FAMILY-MEMBERSHIP-v1'
     or p_analysis_snapshot ->> 'schemaVersion' <> 'BVF-FAMILY-ANALYSIS-v1' then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_INVALID_ANALYSIS';
  end if;
  if jsonb_array_length(p_membership_snapshot -> 'members') not between 2 and 20
     or jsonb_array_length(p_analysis_snapshot -> 'members')
        <> jsonb_array_length(p_membership_snapshot -> 'members') then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_MEMBER_COUNT_INVALID';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_FAMILY_PERMISSION_DENIED';
  end if;

  select family.* into v_family
  from public.video_families family
  where family.id = p_family_id and family.active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_FAMILY_NOT_FOUND';
  end if;
  if p_membership_snapshot ->> 'familyId' is distinct from v_family.id::text
     or p_analysis_snapshot #>> '{family,id}' is distinct from v_family.id::text
     or p_analysis_snapshot #>> '{family,familyKey}' is distinct from v_family.family_key then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_ANALYSIS_TARGET_MISMATCH';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('productId', link.produto_id, 'sku', link.sku)
      order by link.sku
    ),
    '[]'::jsonb
  ) into v_members
  from public.video_family_products link
  where link.family_id = v_family.id and link.removed_at is null;
  if v_members <> p_membership_snapshot -> 'members' then
    raise exception using errcode = '55000', message = 'BVF_FAMILY_STALE_INPUT';
  end if;
  if v_members <> (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productId', member ->> 'productId',
          'sku', member ->> 'sku'
        ) order by member ->> 'sku'
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(p_analysis_snapshot -> 'members') member
  ) then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_ANALYSIS_MEMBER_MISMATCH';
  end if;

  if v_family.current_analysis_version_id is not null then
    select analysis.* into v_current
    from public.video_family_analysis_versions analysis
    where analysis.family_id = v_family.id
      and analysis.id = v_family.current_analysis_version_id;
    if not found then
      raise exception using errcode = '23503', message = 'BVF_FAMILY_CURRENT_ANALYSIS_NOT_FOUND';
    end if;
    if v_current.material_fingerprint = p_material_fingerprint then
      if v_current.engine_version <> p_engine_version
         or v_current.membership_snapshot <> p_membership_snapshot
         or v_current.analysis_snapshot <> p_analysis_snapshot then
        raise exception using errcode = '23000', message = 'BVF_FAMILY_ANALYSIS_FINGERPRINT_CONFLICT';
      end if;
      return jsonb_build_object(
        'analysisVersionId', v_current.id, 'version', v_current.version, 'created', false
      );
    end if;
  end if;

  select coalesce(max(analysis.version), 0) + 1 into v_version
  from public.video_family_analysis_versions analysis
  where analysis.family_id = v_family.id;
  insert into public.video_family_analysis_versions(
    family_id, version, engine_version, material_fingerprint,
    membership_snapshot, analysis_snapshot, created_by
  ) values (
    v_family.id, v_version, p_engine_version, p_material_fingerprint,
    p_membership_snapshot, p_analysis_snapshot, p_actor_id
  ) returning id into v_id;

  update public.video_families
  set current_analysis_version_id = v_id,
      verified_claims = p_analysis_snapshot -> 'verifiedClaims',
      forbidden_claims = p_analysis_snapshot -> 'forbiddenClaims',
      variation_safe = p_analysis_snapshot -> 'variationSafe',
      variation_unsafe = p_analysis_snapshot -> 'variationUnsafe'
  where id = v_family.id;
  return jsonb_build_object('analysisVersionId', v_id, 'version', v_version, 'created', true);
end;
$$;

create function public.bvf_persist_family_brief_version(
  p_job_id uuid,
  p_actor_id uuid,
  p_engine_version text,
  p_material_fingerprint text,
  p_input_snapshot jsonb,
  p_factual_snapshot jsonb,
  p_creative_brief jsonb,
  p_family_id uuid,
  p_family_analysis_version_id uuid,
  p_persona_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.video_jobs%rowtype;
  v_family public.video_families%rowtype;
  v_analysis public.video_family_analysis_versions%rowtype;
  v_persona public.video_personas%rowtype;
  v_current public.video_brief_versions%rowtype;
  v_version integer;
  v_id uuid;
begin
  if p_job_id is null or p_actor_id is null or p_family_id is null
     or p_family_analysis_version_id is null
     or coalesce(btrim(p_engine_version), '') = ''
     or p_material_fingerprint is null
     or p_material_fingerprint !~ '^[0-9a-f]{64}$'
     or coalesce(jsonb_typeof(p_input_snapshot), '') <> 'object'
     or coalesce(jsonb_typeof(p_factual_snapshot), '') <> 'object'
     or coalesce(jsonb_typeof(p_creative_brief), '') <> 'object'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'verifiedClaims'), '') <> 'array'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'forbiddenClaims'), '') <> 'array'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'physicalDimensions'), '') <> 'object'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'variationSafe'), '') <> 'array'
     or coalesce(jsonb_typeof(p_factual_snapshot -> 'variationUnsafe'), '') <> 'array'
     or coalesce(jsonb_typeof(p_creative_brief -> 'contentGuard'), '') <> 'object' then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_BRIEF_INVALID_PAYLOAD';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo::text in ('admin', 'gerente')
  ) then
    raise exception using errcode = '42501', message = 'BVF_FAMILY_PERMISSION_DENIED';
  end if;

  select job.* into v_job
  from public.video_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_JOB_NOT_FOUND';
  end if;
  if v_job.content_scope <> 'FAMILY' or v_job.video_type <> 'FAMILY_VIDEO' then
    raise exception using errcode = '22023', message = 'BVF_FAMILY_BRIEF_SCOPE_REQUIRED';
  end if;
  if v_job.status not in ('draft', 'data_loaded', 'brief_ready', 'waiting_brief_approval') then
    raise exception using errcode = '55000', message = 'BVF_FAMILY_BRIEF_JOB_STATE_NOT_EDITABLE';
  end if;

  select family.* into v_family
  from public.video_families family
  where family.id = p_family_id and family.active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'BVF_FAMILY_NOT_FOUND';
  end if;
  if v_job.family_id is distinct from v_family.id
     or v_job.family_key is distinct from v_family.family_key
     or p_input_snapshot #>> '{job,familyId}' is distinct from v_family.id::text
     or p_input_snapshot #>> '{job,familyKey}' is distinct from v_family.family_key
     or p_creative_brief #>> '{target,jobId}' is distinct from v_job.id::text
     or p_creative_brief #>> '{target,familyId}' is distinct from v_family.id::text then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_BRIEF_TARGET_MISMATCH';
  end if;

  select analysis.* into v_analysis
  from public.video_family_analysis_versions analysis
  where analysis.id = p_family_analysis_version_id
    and analysis.family_id = v_family.id;
  if not found or v_family.current_analysis_version_id is distinct from v_analysis.id then
    raise exception using errcode = '55000', message = 'BVF_FAMILY_REANALYSIS_REQUIRED';
  end if;
  if p_factual_snapshot <> v_analysis.analysis_snapshot
     or p_input_snapshot #>> '{analysisVersion,id}' is distinct from v_analysis.id::text
     or p_input_snapshot #>> '{analysisVersion,materialFingerprint}'
        is distinct from v_analysis.material_fingerprint then
    raise exception using errcode = '23514', message = 'BVF_FAMILY_BRIEF_ANALYSIS_MISMATCH';
  end if;

  if p_persona_id is not null then
    select persona.* into v_persona
    from public.video_personas persona
    where persona.id = p_persona_id and persona.status = 'active';
    if not found then
      raise exception using errcode = 'P0002', message = 'BVF_FAMILY_ACTIVE_PERSONA_NOT_FOUND';
    end if;
  end if;

  if v_job.current_brief_version_id is not null then
    select brief.* into v_current
    from public.video_brief_versions brief
    where brief.job_id = v_job.id and brief.id = v_job.current_brief_version_id;
    if not found then
      raise exception using errcode = '23503', message = 'BVF_BRIEF_CURRENT_VERSION_NOT_FOUND';
    end if;
    if v_current.material_fingerprint = p_material_fingerprint then
      if v_current.engine_version <> p_engine_version
         or v_current.family_analysis_version_id is distinct from v_analysis.id
         or v_current.input_snapshot <> p_input_snapshot
         or v_current.factual_snapshot <> p_factual_snapshot
         or v_current.creative_brief <> p_creative_brief then
        raise exception using errcode = '23000', message = 'BVF_FAMILY_BRIEF_FINGERPRINT_CONFLICT';
      end if;
      return jsonb_build_object(
        'briefVersionId', v_current.id, 'version', v_current.version,
        'created', false, 'status', v_job.status
      );
    end if;
  end if;

  select coalesce(max(brief.version), 0) + 1 into v_version
  from public.video_brief_versions brief where brief.job_id = v_job.id;
  insert into public.video_brief_versions(
    job_id, version, engine_version, material_fingerprint, input_snapshot,
    factual_snapshot, creative_brief, family_analysis_version_id, created_by
  ) values (
    v_job.id, v_version, p_engine_version, p_material_fingerprint, p_input_snapshot,
    p_factual_snapshot, p_creative_brief, v_analysis.id, p_actor_id
  ) returning id into v_id;

  update public.video_jobs
  set current_brief_version_id = v_id,
      persona_id = v_persona.id,
      persona_code = v_persona.code,
      persona_version = v_persona.version,
      product_snapshot = p_input_snapshot,
      verified_claims = p_factual_snapshot -> 'verifiedClaims',
      forbidden_claims = p_factual_snapshot -> 'forbiddenClaims',
      physical_dimensions = p_factual_snapshot -> 'physicalDimensions',
      scale_anchor = case
        when jsonb_typeof(p_factual_snapshot -> 'scaleAnchor') = 'string'
          then p_factual_snapshot ->> 'scaleAnchor'
        else null
      end,
      variation_safe = p_factual_snapshot -> 'variationSafe',
      variation_unsafe = p_factual_snapshot -> 'variationUnsafe',
      creative_brief = p_creative_brief,
      status = 'waiting_brief_approval'
  where id = v_job.id;

  return jsonb_build_object(
    'briefVersionId', v_id, 'version', v_version,
    'created', true, 'status', 'waiting_brief_approval'
  );
end;
$$;

alter table public.video_family_suggestions enable row level security;
alter table public.video_family_analysis_versions enable row level security;

revoke all on table public.video_family_suggestions,
  public.video_family_analysis_versions
from public, anon, authenticated, service_role;
grant select on table public.video_family_suggestions,
  public.video_family_analysis_versions
to service_role;

revoke insert, update on table public.video_families,
  public.video_family_products
from service_role;

revoke all on function public.bvf_family_analysis_version_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.bvf_record_family_suggestion(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.bvf_review_family_suggestion(uuid, uuid, text, text, text, text, text, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.bvf_set_family_members(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.bvf_persist_family_analysis(uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.bvf_persist_family_brief_version(uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.bvf_family_analysis_version_immutable() to service_role;
grant execute on function public.bvf_record_family_suggestion(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.bvf_review_family_suggestion(uuid, uuid, text, text, text, text, text, uuid[]) to service_role;
grant execute on function public.bvf_set_family_members(uuid, uuid, uuid[]) to service_role;
grant execute on function public.bvf_persist_family_analysis(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.bvf_persist_family_brief_version(uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid, uuid, uuid) to service_role;

comment on table public.video_family_suggestions is
  'Sugestões auditáveis iniciadas por SKU; somente confirmação humana cria uma família.';
comment on table public.video_family_analysis_versions is
  'Histórico imutável da classificação variation_safe/variation_unsafe de uma família.';
comment on column public.video_families.current_analysis_version_id is
  'Versão corrente da análise familiar; fica nula após alteração de membros até nova análise.';
comment on column public.video_family_products.created_by is
  'Operador que incluiu o vínculo temporal; nulo somente para eventual histórico anterior à FAMILY-01.';
comment on column public.video_family_products.removed_by is
  'Operador que encerrou o vínculo temporal, sem DELETE; nulo enquanto o vínculo estiver ativo.';
comment on column public.video_brief_versions.family_analysis_version_id is
  'Análise familiar imutável usada por um briefing FAMILY_VIDEO; nula para briefings por SKU.';
comment on function public.bvf_set_family_members(uuid, uuid, uuid[]) is
  'Atualiza vínculos temporais sem DELETE e invalida projeções familiares potencialmente obsoletas.';
comment on function public.bvf_persist_family_analysis(uuid, uuid, text, text, jsonb, jsonb) is
  'Persiste análise familiar idempotente após revalidar atomicamente a composição corrente.';

select pg_notify('pgrst', 'reload schema');

commit;
