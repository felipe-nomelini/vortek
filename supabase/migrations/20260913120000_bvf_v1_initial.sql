-- Bentevi Video Factory V1
-- Domínio aditivo e isolado. Nenhuma tabela operacional existente é alterada.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.video_personas (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version text not null default 'v1',
  name text not null,
  status text not null default 'draft',
  role text,
  visual_description text,
  personality text,
  voice_description text,
  accent text,
  humor_style text,
  allowed_categories jsonb not null default '[]'::jsonb,
  forbidden_categories jsonb not null default '[]'::jsonb,
  prompt_identity_block text,
  dialogue_rules jsonb not null default '{}'::jsonb,
  forbidden_phrases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_personas_code_version_key unique (code, version),
  constraint video_personas_code_check check (
    code = upper(btrim(code)) and code ~ '^[A-Z0-9_]+$'
  ),
  constraint video_personas_version_check check (nullif(btrim(version), '') is not null),
  constraint video_personas_name_check check (nullif(btrim(name), '') is not null),
  constraint video_personas_status_check check (status in ('active', 'inactive', 'draft')),
  constraint video_personas_allowed_categories_check check (jsonb_typeof(allowed_categories) = 'array'),
  constraint video_personas_forbidden_categories_check check (jsonb_typeof(forbidden_categories) = 'array'),
  constraint video_personas_dialogue_rules_check check (jsonb_typeof(dialogue_rules) = 'object'),
  constraint video_personas_forbidden_phrases_check check (jsonb_typeof(forbidden_phrases) = 'array')
);

create unique index video_personas_one_active_version_per_code_idx
  on public.video_personas (code)
  where status = 'active';

create table public.video_families (
  id uuid primary key default gen_random_uuid(),
  family_key text not null unique,
  name text not null,
  brand text,
  category text,
  description text,
  verified_claims jsonb not null default '[]'::jsonb,
  forbidden_claims jsonb not null default '[]'::jsonb,
  variation_safe jsonb not null default '[]'::jsonb,
  variation_unsafe jsonb not null default '[]'::jsonb,
  default_persona_id uuid references public.video_personas (id) on delete set null,
  default_video_type text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_families_key_check check (nullif(btrim(family_key), '') is not null),
  constraint video_families_name_check check (nullif(btrim(name), '') is not null),
  constraint video_families_verified_claims_check check (jsonb_typeof(verified_claims) = 'array'),
  constraint video_families_forbidden_claims_check check (jsonb_typeof(forbidden_claims) = 'array'),
  constraint video_families_variation_safe_check check (jsonb_typeof(variation_safe) = 'array'),
  constraint video_families_variation_unsafe_check check (jsonb_typeof(variation_unsafe) = 'array'),
  constraint video_families_default_video_type_check check (
    default_video_type is null
    or default_video_type in ('HUMAN_DEMO', 'CINEMATIC_PRODUCT', 'FAMILY_VIDEO')
  )
);

create index video_families_default_persona_id_idx
  on public.video_families (default_persona_id)
  where default_persona_id is not null;

create table public.video_family_products (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.video_families (id) on delete restrict,
  produto_id uuid references public.produtos (id) on delete set null,
  sku text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint video_family_products_sku_check check (nullif(btrim(sku), '') is not null),
  constraint video_family_products_removed_at_check check (
    removed_at is null or removed_at >= created_at
  )
);

create unique index video_family_products_active_product_idx
  on public.video_family_products (family_id, produto_id)
  where removed_at is null and produto_id is not null;

create unique index video_family_products_active_sku_idx
  on public.video_family_products (family_id, sku)
  where removed_at is null;

create index video_family_products_produto_id_idx
  on public.video_family_products (produto_id)
  where produto_id is not null;

create index video_family_products_sku_idx
  on public.video_family_products (sku);

create table public.video_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version text not null,
  video_type text not null,
  scope text not null,
  provider text,
  model text,
  template_text text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_prompt_templates_code_version_key unique (code, version),
  constraint video_prompt_templates_code_check check (
    code = upper(btrim(code)) and code ~ '^[A-Z0-9_]+$'
  ),
  constraint video_prompt_templates_version_check check (nullif(btrim(version), '') is not null),
  constraint video_prompt_templates_video_type_check check (
    video_type in ('HUMAN_DEMO', 'CINEMATIC_PRODUCT', 'FAMILY_VIDEO')
  ),
  constraint video_prompt_templates_scope_check check (scope in ('SKU', 'FAMILY')),
  constraint video_prompt_templates_type_scope_check check (
    (video_type = 'FAMILY_VIDEO' and scope = 'FAMILY')
    or (video_type in ('HUMAN_DEMO', 'CINEMATIC_PRODUCT') and scope = 'SKU')
  ),
  constraint video_prompt_templates_provider_check check (
    provider is null or nullif(btrim(provider), '') is not null
  ),
  constraint video_prompt_templates_model_check check (
    model is null or nullif(btrim(model), '') is not null
  ),
  constraint video_prompt_templates_template_text_check check (
    nullif(btrim(template_text), '') is not null
  )
);

create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid references public.produtos (id) on delete set null,
  sku text,
  family_id uuid references public.video_families (id) on delete set null,
  family_key text,
  ml_item_id text,
  video_type text not null,
  content_scope text not null,
  persona_id uuid references public.video_personas (id) on delete set null,
  persona_code text,
  persona_version text,
  status text not null default 'draft',
  product_snapshot jsonb not null default '{}'::jsonb,
  verified_claims jsonb not null default '[]'::jsonb,
  forbidden_claims jsonb not null default '[]'::jsonb,
  physical_dimensions jsonb not null default '{}'::jsonb,
  scale_anchor text,
  variation_safe jsonb not null default '[]'::jsonb,
  variation_unsafe jsonb not null default '[]'::jsonb,
  creative_brief jsonb not null default '{}'::jsonb,
  prompt_template_code text,
  prompt_template_version text,
  prompt_final text,
  generation_provider text,
  generation_model text,
  estimated_cost numeric(14, 6),
  estimated_cost_currency text,
  validation_result jsonb not null default '{}'::jsonb,
  output_asset_id uuid,
  generation_approved_at timestamptz,
  generation_approved_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  rejected_at timestamptz,
  rejected_by uuid,
  rejection_reason text,
  rejection_code text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_jobs_video_type_check check (
    video_type in ('HUMAN_DEMO', 'CINEMATIC_PRODUCT', 'FAMILY_VIDEO')
  ),
  constraint video_jobs_content_scope_check check (content_scope in ('SKU', 'FAMILY')),
  constraint video_jobs_type_scope_check check (
    (video_type = 'FAMILY_VIDEO' and content_scope = 'FAMILY')
    or (video_type in ('HUMAN_DEMO', 'CINEMATIC_PRODUCT') and content_scope = 'SKU')
  ),
  constraint video_jobs_target_check check (
    (content_scope = 'SKU' and nullif(btrim(sku), '') is not null)
    or (content_scope = 'FAMILY' and nullif(btrim(family_key), '') is not null)
  ),
  constraint video_jobs_status_check check (status in (
    'draft',
    'data_loaded',
    'brief_ready',
    'waiting_brief_approval',
    'approved_for_generation',
    'queued',
    'generating',
    'generated',
    'validating',
    'waiting_content_approval',
    'approved',
    'rejected',
    'generation_error',
    'validation_failed',
    'insufficient_api_balance',
    'cancelled'
  )),
  constraint video_jobs_product_snapshot_check check (jsonb_typeof(product_snapshot) = 'object'),
  constraint video_jobs_verified_claims_check check (jsonb_typeof(verified_claims) = 'array'),
  constraint video_jobs_forbidden_claims_check check (jsonb_typeof(forbidden_claims) = 'array'),
  constraint video_jobs_physical_dimensions_check check (jsonb_typeof(physical_dimensions) = 'object'),
  constraint video_jobs_variation_safe_check check (jsonb_typeof(variation_safe) = 'array'),
  constraint video_jobs_variation_unsafe_check check (jsonb_typeof(variation_unsafe) = 'array'),
  constraint video_jobs_creative_brief_check check (jsonb_typeof(creative_brief) = 'object'),
  constraint video_jobs_validation_result_check check (jsonb_typeof(validation_result) = 'object'),
  constraint video_jobs_persona_snapshot_check check (
    (persona_code is null and persona_version is null)
    or (nullif(btrim(persona_code), '') is not null and nullif(btrim(persona_version), '') is not null)
  ),
  constraint video_jobs_template_snapshot_check check (
    (prompt_template_code is null and prompt_template_version is null)
    or (
      nullif(btrim(prompt_template_code), '') is not null
      and nullif(btrim(prompt_template_version), '') is not null
    )
  ),
  constraint video_jobs_template_fk foreign key (prompt_template_code, prompt_template_version)
    references public.video_prompt_templates (code, version) on delete restrict,
  constraint video_jobs_generation_model_check check (
    generation_model is null or generation_provider is not null
  ),
  constraint video_jobs_estimated_cost_check check (
    estimated_cost is null or estimated_cost >= 0
  ),
  constraint video_jobs_estimated_cost_currency_check check (
    (estimated_cost is null and estimated_cost_currency is null)
    or (
      estimated_cost is not null
      and estimated_cost_currency ~ '^[A-Z]{3}$'
    )
  ),
  constraint video_jobs_generation_approval_check check (
    status not in (
      'approved_for_generation', 'queued', 'generating', 'generated', 'validating',
      'waiting_content_approval', 'approved', 'generation_error', 'validation_failed',
      'insufficient_api_balance'
    )
    or (generation_approved_at is not null and generation_approved_by is not null)
  ),
  constraint video_jobs_content_approval_check check (
    status <> 'approved'
    or (approved_at is not null and approved_by is not null and output_asset_id is not null)
  ),
  constraint video_jobs_rejection_check check (
    status <> 'rejected'
    or (
      rejected_at is not null
      and rejected_by is not null
      and nullif(btrim(rejection_reason), '') is not null
    )
  )
);

create index video_jobs_produto_id_idx
  on public.video_jobs (produto_id)
  where produto_id is not null;

create index video_jobs_sku_idx on public.video_jobs (sku) where sku is not null;
create index video_jobs_family_id_idx on public.video_jobs (family_id) where family_id is not null;
create index video_jobs_family_key_idx on public.video_jobs (family_key) where family_key is not null;
create index video_jobs_ml_item_id_idx on public.video_jobs (ml_item_id) where ml_item_id is not null;
create index video_jobs_persona_id_idx on public.video_jobs (persona_id) where persona_id is not null;
create index video_jobs_status_idx on public.video_jobs (status, created_at desc);
create index video_jobs_template_idx
  on public.video_jobs (prompt_template_code, prompt_template_version)
  where prompt_template_code is not null;

create table public.video_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.video_jobs (id) on delete restrict,
  attempt_number integer not null,
  provider text not null,
  model text not null,
  prompt text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  status text not null,
  estimated_cost numeric(14, 6),
  actual_cost numeric(14, 6),
  cost_currency text,
  external_operation_id text,
  error_code text,
  error_message text,
  duration_seconds numeric(12, 3),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint video_generation_attempts_job_attempt_key unique (job_id, attempt_number),
  constraint video_generation_attempts_job_id_id_key unique (job_id, id),
  constraint video_generation_attempts_number_check check (attempt_number > 0),
  constraint video_generation_attempts_provider_check check (nullif(btrim(provider), '') is not null),
  constraint video_generation_attempts_model_check check (nullif(btrim(model), '') is not null),
  constraint video_generation_attempts_prompt_check check (nullif(btrim(prompt), '') is not null),
  constraint video_generation_attempts_request_payload_check check (jsonb_typeof(request_payload) = 'object'),
  constraint video_generation_attempts_response_payload_check check (jsonb_typeof(response_payload) = 'object'),
  constraint video_generation_attempts_status_check check (status in (
    'queued',
    'generating',
    'succeeded',
    'failed',
    'cancelled',
    'insufficient_api_balance',
    'filtered'
  )),
  constraint video_generation_attempts_estimated_cost_check check (
    estimated_cost is null or estimated_cost >= 0
  ),
  constraint video_generation_attempts_actual_cost_check check (
    actual_cost is null or actual_cost >= 0
  ),
  constraint video_generation_attempts_currency_check check (
    (estimated_cost is null and actual_cost is null and cost_currency is null)
    or (
      (estimated_cost is not null or actual_cost is not null)
      and cost_currency ~ '^[A-Z]{3}$'
    )
  ),
  constraint video_generation_attempts_duration_check check (
    duration_seconds is null or duration_seconds >= 0
  ),
  constraint video_generation_attempts_timing_check check (
    (finished_at is null or (started_at is not null and finished_at >= started_at))
    and (
      status not in ('succeeded', 'failed', 'cancelled', 'insufficient_api_balance', 'filtered')
      or finished_at is not null
    )
  )
);

create unique index video_generation_attempts_external_operation_idx
  on public.video_generation_attempts (provider, external_operation_id)
  where external_operation_id is not null;

create index video_generation_attempts_status_idx
  on public.video_generation_attempts (status, created_at);

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  attempt_id uuid,
  persona_id uuid references public.video_personas (id) on delete set null,
  produto_id uuid references public.produtos (id) on delete set null,
  asset_type text not null,
  storage_path text not null unique,
  mime_type text not null,
  width integer,
  height integer,
  duration_seconds numeric(12, 3),
  fps numeric(10, 3),
  video_codec text,
  audio_codec text,
  checksum_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint video_assets_job_id_id_key unique (job_id, id),
  constraint video_assets_job_fk foreign key (job_id)
    references public.video_jobs (id) on delete restrict,
  constraint video_assets_attempt_fk foreign key (job_id, attempt_id)
    references public.video_generation_attempts (job_id, id) on delete restrict,
  constraint video_assets_asset_type_check check (asset_type in (
    'persona_reference',
    'product_reference',
    'generated_video',
    'approved_master',
    'thumbnail',
    'poster_frame'
  )),
  constraint video_assets_storage_path_check check (
    storage_path = btrim(storage_path) and storage_path <> '' and storage_path !~ '^/'
  ),
  constraint video_assets_mime_type_check check (
    (asset_type in ('generated_video', 'approved_master') and mime_type = 'video/mp4')
    or (
      asset_type in ('persona_reference', 'product_reference', 'thumbnail', 'poster_frame')
      and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    )
  ),
  constraint video_assets_dimensions_check check (
    (width is null or width > 0) and (height is null or height > 0)
  ),
  constraint video_assets_duration_check check (
    duration_seconds is null or duration_seconds >= 0
  ),
  constraint video_assets_fps_check check (fps is null or fps > 0),
  constraint video_assets_checksum_check check (
    checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint video_assets_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint video_assets_attempt_required_check check (
    asset_type not in ('generated_video', 'approved_master') or attempt_id is not null
  )
);

alter table public.video_jobs
  add constraint video_jobs_output_asset_fk
  foreign key (id, output_asset_id)
  references public.video_assets (job_id, id)
  on delete restrict;

create index video_assets_attempt_id_idx
  on public.video_assets (attempt_id)
  where attempt_id is not null;

create index video_assets_persona_id_idx
  on public.video_assets (persona_id)
  where persona_id is not null;

create index video_assets_produto_id_idx
  on public.video_assets (produto_id)
  where produto_id is not null;

create index video_assets_asset_type_idx
  on public.video_assets (asset_type, created_at desc);

create table public.video_asset_links (
  id uuid primary key default gen_random_uuid(),
  video_asset_id uuid not null references public.video_assets (id) on delete restrict,
  ml_item_id text not null,
  produto_id uuid references public.produtos (id) on delete set null,
  sku text,
  family_id uuid references public.video_families (id) on delete set null,
  linked_at timestamptz not null default now(),
  linked_by uuid not null,
  unlinked_at timestamptz,
  unlinked_by uuid,
  unlink_reason text,
  constraint video_asset_links_ml_item_id_check check (nullif(btrim(ml_item_id), '') is not null),
  constraint video_asset_links_unlink_check check (
    (unlinked_at is null and unlinked_by is null and unlink_reason is null)
    or (
      unlinked_at is not null
      and unlinked_by is not null
      and unlinked_at >= linked_at
      and nullif(btrim(unlink_reason), '') is not null
    )
  )
);

create unique index video_asset_links_active_asset_item_idx
  on public.video_asset_links (video_asset_id, ml_item_id)
  where unlinked_at is null;

create index video_asset_links_ml_item_id_idx
  on public.video_asset_links (ml_item_id)
  where unlinked_at is null;

create index video_asset_links_produto_id_idx
  on public.video_asset_links (produto_id)
  where produto_id is not null;

create index video_asset_links_family_id_idx
  on public.video_asset_links (family_id)
  where family_id is not null;

create function public.bvf_protect_persona_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
     and row(
       new.code,
       new.version,
       new.name,
       new.role,
       new.visual_description,
       new.personality,
       new.voice_description,
       new.accent,
       new.humor_style,
       new.allowed_categories,
       new.forbidden_categories,
       new.prompt_identity_block,
       new.dialogue_rules,
       new.forbidden_phrases
     ) is distinct from row(
       old.code,
       old.version,
       old.name,
       old.role,
       old.visual_description,
       old.personality,
       old.voice_description,
       old.accent,
       old.humor_style,
       old.allowed_categories,
       old.forbidden_categories,
       old.prompt_identity_block,
       old.dialogue_rules,
       old.forbidden_phrases
     ) then
    raise exception 'Published persona versions are immutable; create a new version';
  end if;

  return new;
end;
$$;

create function public.bvf_protect_prompt_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
       new.code,
       new.version,
       new.video_type,
       new.scope,
       new.provider,
       new.model,
       new.template_text
     ) is distinct from row(
       old.code,
       old.version,
       old.video_type,
       old.scope,
       old.provider,
       old.model,
       old.template_text
     ) then
    raise exception 'Prompt template versions are immutable; create a new version';
  end if;

  return new;
end;
$$;

create trigger video_personas_protect_version
before update on public.video_personas
for each row execute function public.bvf_protect_persona_version();

create trigger video_personas_set_updated_at
before update on public.video_personas
for each row execute function public.set_updated_at();

create trigger video_families_set_updated_at
before update on public.video_families
for each row execute function public.set_updated_at();

create trigger video_prompt_templates_protect_version
before update on public.video_prompt_templates
for each row execute function public.bvf_protect_prompt_template_version();

create trigger video_prompt_templates_set_updated_at
before update on public.video_prompt_templates
for each row execute function public.set_updated_at();

create trigger video_jobs_set_updated_at
before update on public.video_jobs
for each row execute function public.set_updated_at();

alter table public.video_personas enable row level security;
alter table public.video_families enable row level security;
alter table public.video_family_products enable row level security;
alter table public.video_prompt_templates enable row level security;
alter table public.video_jobs enable row level security;
alter table public.video_generation_attempts enable row level security;
alter table public.video_assets enable row level security;
alter table public.video_asset_links enable row level security;

revoke all on table
  public.video_personas,
  public.video_families,
  public.video_family_products,
  public.video_prompt_templates,
  public.video_jobs,
  public.video_generation_attempts,
  public.video_assets,
  public.video_asset_links
from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.video_personas,
  public.video_families,
  public.video_family_products,
  public.video_prompt_templates,
  public.video_jobs,
  public.video_generation_attempts,
  public.video_assets,
  public.video_asset_links
to service_role;

revoke all on function public.bvf_protect_persona_version()
from public, anon, authenticated;

revoke all on function public.bvf_protect_prompt_template_version()
from public, anon, authenticated;

grant execute on function public.bvf_protect_persona_version() to service_role;
grant execute on function public.bvf_protect_prompt_template_version() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'video-factory',
  'video-factory',
  false,
  null,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']::text[]
);

create policy bvf_private_bucket_guard
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'video-factory')
with check (bucket_id <> 'video-factory');

comment on table public.video_jobs is
  'BVF workflow aggregate. Writes stay isolated from products, listings, pricing, stock, orders and fiscal domains.';

comment on column public.video_jobs.product_snapshot is
  'Immutable-at-use factual input snapshot; consumers must record source and absence explicitly.';

comment on column public.video_jobs.physical_dimensions is
  'Physical product dimensions only. Never infer from seller/package logistics dimensions without an explicit physical source.';

comment on column public.video_jobs.scale_anchor is
  'Human-reviewed physical scale description grounded in verified dimensions or another explicit source.';

comment on column public.video_jobs.variation_unsafe is
  'Family attributes forbidden in automatically generated dialogue, on-screen text, closing and claims.';

comment on table public.video_generation_attempts is
  'Append-only operational ledger of every paid or failed generation attempt and its cost.';

comment on column public.video_generation_attempts.cost_currency is
  'ISO 4217 uppercase currency code applying to both estimated_cost and actual_cost when present.';

comment on column public.video_assets.storage_path is
  'Path relative to the private video-factory bucket; signed access is generated server-side when needed.';

insert into public.video_personas (
  code,
  version,
  name,
  status,
  role,
  visual_description,
  personality,
  voice_description,
  accent,
  humor_style,
  allowed_categories,
  forbidden_categories,
  prompt_identity_block,
  dialogue_rules,
  forbidden_phrases
)
values (
  'RAFA',
  'v1',
  'Rafa',
  'active',
  'Apresentador técnico da Bentevi',
  'Homem brasileiro, aproximadamente 35–40 anos aparentes, cabelo escuro, barba curta e camiseta preta Bentevi.',
  'Especialista acessível, simpático e natural.',
  'Voz masculina brasileira, natural e conversacional.',
  'Sudeste brasileiro leve',
  'Humor sutil',
  '["Ferramentas", "Automotivo", "Áudio", "Eletrônica", "Informática", "Instrumentação", "Acessórios técnicos", "Oficina"]'::jsonb,
  '[]'::jsonb,
  'Use the exact same Brazilian male presenter from the canonical Rafa references. Preserve face, dark hair, short beard, apparent age, black Bentevi shirt and accessible technical-presenter identity.',
  '{"language": "pt-BR"}'::jsonb,
  '[]'::jsonb
);

insert into public.video_prompt_templates (
  code,
  version,
  video_type,
  scope,
  provider,
  model,
  template_text,
  active
)
values
  (
    'BENTEVI_HUMAN_DEMO',
    'v1',
    'HUMAN_DEMO',
    'SKU',
    null,
    null,
    'PROMPT_LANGUAGE=EN; DIALOGUE_LANGUAGE=pt-BR; ONSCREEN_TEXT=pt-BR; OUTPUT=VERTICAL_9_16; DURATION=10s. Blocks: FORMAT, PERSONA, VERIFIED_FACTS, SCALE_ANCHOR, FORBIDDEN_CLAIMS, CREATIVE_BRIEF, TIMELINE, DIALOGUE, ONSCREEN_TEXT, AUDIO, FIDELITY.',
    true
  ),
  (
    'BENTEVI_FAMILY_VIDEO',
    'v1',
    'FAMILY_VIDEO',
    'FAMILY',
    null,
    null,
    'PROMPT_LANGUAGE=EN; DIALOGUE_LANGUAGE=pt-BR; ONSCREEN_TEXT=pt-BR; OUTPUT=VERTICAL_9_16; DURATION=10s. Never use VARIATION_UNSAFE attributes in dialogue, on-screen text, closing or claims. Sell the product family and experience; the exact variation remains in the listing.',
    true
  ),
  (
    'BENTEVI_CINEMATIC_PRODUCT',
    'v1',
    'CINEMATIC_PRODUCT',
    'SKU',
    null,
    null,
    'PROMPT_LANGUAGE=EN; DIALOGUE_LANGUAGE=pt-BR; ONSCREEN_TEXT=pt-BR; OUTPUT=VERTICAL_9_16. Product-first cinematic ecommerce video. Preserve real geometry, branding and SCALE_ANCHOR. No unsupported claims.',
    true
  );

select pg_notify('pgrst', 'reload schema');

commit;
