begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.ui_read_model_state (
  scope text primary key,
  active_generation integer not null default 0 check (active_generation >= 0),
  target_generation integer not null default 1 check (target_generation > 0),
  status text not null default 'requested' check (status in ('requested', 'building', 'ready')),
  reason text not null default 'initial_backfill',
  context_fingerprint text,
  context jsonb,
  requested_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.ui_read_model_state(scope)
values ('catalog_ui')
on conflict (scope) do nothing;

create table public.ui_product_projection (
  generation integer not null,
  product_id uuid not null references public.produtos(id) on delete cascade,
  sku text not null,
  product_name text not null,
  active boolean not null,
  supplier_ids text[] not null default '{}',
  supplier_name text,
  has_internal_stock boolean not null default false,
  ml_status text not null,
  safe_stock integer not null default 0,
  cost numeric,
  ml_fee numeric,
  ml_shipping numeric,
  suggested_price numeric,
  profit numeric,
  margin_percent numeric,
  pricing_inconclusive boolean not null default false,
  search_document text not null,
  payload jsonb not null,
  queue_version bigint not null default 0,
  source_updated_at timestamptz,
  computed_at timestamptz not null default clock_timestamp(),
  primary key (generation, product_id)
);

create table public.ui_listing_projection (
  generation integer not null,
  item_id text not null,
  product_id uuid references public.produtos(id) on delete set null,
  product_sku text,
  product_name text not null,
  listing_title text not null,
  observed_status text not null,
  listing_type text not null check (listing_type in ('standard', 'catalog')),
  catalog_status text not null,
  price numeric not null default 0,
  profit numeric,
  margin_percent numeric,
  sold integer not null default 0,
  visits integer not null default 0,
  quality_score numeric,
  quality_available boolean not null default false,
  price_review boolean not null default false,
  search_document text not null,
  payload jsonb not null,
  queue_version bigint not null default 0,
  source_updated_at timestamptz,
  computed_at timestamptz not null default clock_timestamp(),
  primary key (generation, item_id)
);

create table public.ui_read_model_queue (
  scope text not null default 'catalog_ui',
  generation integer not null,
  entity_kind text not null check (entity_kind in ('product', 'listing')),
  entity_key text not null,
  version bigint not null default 1,
  reasons text[] not null default '{}',
  attempts integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  queued_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  claim_token uuid,
  last_error text,
  primary key (scope, generation, entity_kind, entity_key),
  foreign key (scope) references public.ui_read_model_state(scope) on delete cascade
);

create index ui_product_projection_active_sku_idx
  on public.ui_product_projection (generation, active, sku, product_id);
create index ui_product_projection_ml_status_idx
  on public.ui_product_projection (generation, active, ml_status, sku, product_id);
create index ui_product_projection_stock_idx
  on public.ui_product_projection (generation, active, safe_stock, sku, product_id);
create index ui_product_projection_cost_idx
  on public.ui_product_projection (generation, active, cost, product_id);
create index ui_product_projection_suggested_idx
  on public.ui_product_projection (generation, active, suggested_price, product_id);
create index ui_product_projection_profit_idx
  on public.ui_product_projection (generation, active, profit, product_id);
create index ui_product_projection_suppliers_idx
  on public.ui_product_projection using gin (supplier_ids);
create index ui_product_projection_supplier_name_idx
  on public.ui_product_projection (generation, active, supplier_name, product_id);
create index ui_product_projection_search_idx
  on public.ui_product_projection using gin (search_document public.gin_trgm_ops);

create index ui_listing_projection_product_idx
  on public.ui_listing_projection (generation, product_name, item_id);
create index ui_listing_projection_status_idx
  on public.ui_listing_projection (generation, observed_status, product_name, item_id);
create index ui_listing_projection_catalog_idx
  on public.ui_listing_projection (generation, catalog_status, product_name, item_id);
create index ui_listing_projection_quality_idx
  on public.ui_listing_projection (generation, quality_available, quality_score, item_id);
create index ui_listing_projection_price_idx
  on public.ui_listing_projection (generation, price, item_id);
create index ui_listing_projection_profit_idx
  on public.ui_listing_projection (generation, profit, item_id);
create index ui_listing_projection_visits_idx
  on public.ui_listing_projection (generation, visits desc, item_id);
create index ui_listing_projection_sold_idx
  on public.ui_listing_projection (generation, sold desc, item_id);
create index ui_listing_projection_search_idx
  on public.ui_listing_projection using gin (search_document public.gin_trgm_ops);

create index ui_read_model_queue_due_idx
  on public.ui_read_model_queue (scope, generation, available_at, queued_at)
  where claim_token is null;
create index ui_read_model_queue_claimed_idx
  on public.ui_read_model_queue (claimed_at)
  where claim_token is not null;

alter table public.ui_read_model_state enable row level security;
alter table public.ui_product_projection enable row level security;
alter table public.ui_listing_projection enable row level security;
alter table public.ui_read_model_queue enable row level security;

revoke all on public.ui_read_model_state, public.ui_product_projection,
  public.ui_listing_projection, public.ui_read_model_queue
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.ui_read_model_state,
  public.ui_product_projection, public.ui_listing_projection,
  public.ui_read_model_queue to service_role;

create or replace function public.enqueue_ui_read_model(
  p_entity_kind text,
  p_entity_key text,
  p_reason text default 'source_changed'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  model_state public.ui_read_model_state%rowtype;
begin
  if p_entity_kind not in ('product', 'listing') or nullif(trim(p_entity_key), '') is null then
    return;
  end if;

  select * into model_state
  from public.ui_read_model_state
  where scope = 'catalog_ui';

  if model_state.active_generation > 0 then
    insert into public.ui_read_model_queue(scope, generation, entity_kind, entity_key, reasons)
    values ('catalog_ui', model_state.active_generation, p_entity_kind, p_entity_key, array[p_reason])
    on conflict (scope, generation, entity_kind, entity_key) do update set
      version = public.ui_read_model_queue.version + 1,
      reasons = array_append(public.ui_read_model_queue.reasons, p_reason),
      available_at = clock_timestamp(),
      queued_at = least(public.ui_read_model_queue.queued_at, clock_timestamp()),
      claim_token = null,
      claimed_at = null,
      last_error = null;
  end if;

  if model_state.status in ('requested', 'building')
     and model_state.target_generation <> model_state.active_generation then
    insert into public.ui_read_model_queue(scope, generation, entity_kind, entity_key, reasons)
    values ('catalog_ui', model_state.target_generation, p_entity_kind, p_entity_key, array[p_reason])
    on conflict (scope, generation, entity_kind, entity_key) do update set
      version = public.ui_read_model_queue.version + 1,
      reasons = array_append(public.ui_read_model_queue.reasons, p_reason),
      available_at = clock_timestamp(),
      queued_at = least(public.ui_read_model_queue.queued_at, clock_timestamp()),
      claim_token = null,
      claimed_at = null,
      last_error = null;
  end if;
end;
$$;

revoke all on function public.enqueue_ui_read_model(text,text,text) from public, anon, authenticated;
grant execute on function public.enqueue_ui_read_model(text,text,text) to service_role;

create or replace function public.request_ui_read_model_rebuild(p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_generation integer;
begin
  update public.ui_read_model_state
  set target_generation = case
        when status in ('requested', 'building') and target_generation > active_generation then target_generation
        else active_generation + 1
      end,
      status = 'requested',
      reason = coalesce(nullif(trim(p_reason), ''), 'global_change'),
      requested_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where scope = 'catalog_ui'
  returning target_generation into next_generation;
  return next_generation;
end;
$$;

create or replace function public.seed_ui_read_model_rebuild()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target integer;
  product_count integer;
  listing_count integer;
begin
  select target_generation into target
  from public.ui_read_model_state
  where scope = 'catalog_ui'
  for update;

  insert into public.ui_read_model_queue(scope, generation, entity_kind, entity_key, reasons)
  select 'catalog_ui', target, 'product', product.id::text, array['generation_backfill']
  from public.produtos product
  on conflict (scope, generation, entity_kind, entity_key) do nothing;
  get diagnostics product_count = row_count;

  insert into public.ui_read_model_queue(scope, generation, entity_kind, entity_key, reasons)
  select 'catalog_ui', target, 'listing', listing.ml_item_id, array['generation_backfill']
  from public.anuncios_ml listing
  on conflict (scope, generation, entity_kind, entity_key) do nothing;
  get diagnostics listing_count = row_count;

  update public.ui_read_model_state
  set status = 'building', updated_at = clock_timestamp()
  where scope = 'catalog_ui';

  return jsonb_build_object('generation', target, 'productsQueued', product_count, 'listingsQueued', listing_count);
end;
$$;

create or replace function public.claim_ui_read_model_batch(p_limit integer default 100)
returns table(entity_kind text, entity_key text, generation integer, version bigint, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ui_read_model_queue queue
  set claim_token = null, claimed_at = null
  where queue.claim_token is not null
    and queue.claimed_at < clock_timestamp() - interval '5 minutes';

  return query
  with due as (
    select queue.scope, queue.generation, queue.entity_kind, queue.entity_key
    from public.ui_read_model_queue queue
    where queue.scope = 'catalog_ui'
      and queue.claim_token is null
      and queue.available_at <= clock_timestamp()
    order by queue.generation, queue.queued_at, queue.entity_kind, queue.entity_key
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  )
  update public.ui_read_model_queue queue
  set claim_token = extensions.gen_random_uuid(),
      claimed_at = clock_timestamp(),
      attempts = queue.attempts + 1
  from due
  where queue.scope = due.scope
    and queue.generation = due.generation
    and queue.entity_kind = due.entity_kind
    and queue.entity_key = due.entity_key
  returning queue.entity_kind, queue.entity_key, queue.generation, queue.version, queue.claim_token;
end;
$$;

create or replace function public.complete_ui_read_model_item(
  p_entity_kind text, p_entity_key text, p_generation integer,
  p_version bigint, p_claim_token uuid
) returns boolean
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.ui_read_model_queue
    where scope = 'catalog_ui'
      and generation = p_generation
      and entity_kind = p_entity_kind
      and entity_key = p_entity_key
      and version = p_version
      and claim_token = p_claim_token
    returning 1
  )
  select exists(select 1 from deleted);
$$;

create or replace function public.fail_ui_read_model_item(
  p_entity_kind text, p_entity_key text, p_generation integer,
  p_version bigint, p_claim_token uuid, p_error text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  update public.ui_read_model_queue
  set claim_token = null,
      claimed_at = null,
      last_error = left(coalesce(p_error, 'projection_failed'), 1000),
      available_at = clock_timestamp() + make_interval(secs => least(attempts, 20) * 15)
  where scope = 'catalog_ui'
    and generation = p_generation
    and entity_kind = p_entity_kind
    and entity_key = p_entity_key
    and version = p_version
    and claim_token = p_claim_token;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.upsert_ui_product_projections(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  insert into public.ui_product_projection(
    generation, product_id, sku, product_name, active, supplier_ids, supplier_name,
    has_internal_stock, ml_status, safe_stock, cost, ml_fee, ml_shipping, suggested_price,
    profit, margin_percent, pricing_inconclusive, search_document, payload,
    queue_version, source_updated_at, computed_at
  )
  select row.generation, row.product_id, row.sku, row.product_name, row.active,
    coalesce(row.supplier_ids, '{}'), row.supplier_name, coalesce(row.has_internal_stock, false),
    row.ml_status, coalesce(row.safe_stock, 0), row.cost, row.ml_fee, row.ml_shipping, row.suggested_price,
    row.profit, row.margin_percent, coalesce(row.pricing_inconclusive, false),
    row.search_document, row.payload, row.queue_version, row.source_updated_at,
    clock_timestamp()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row(
    generation integer, product_id uuid, sku text, product_name text,
    active boolean, supplier_ids text[], supplier_name text, has_internal_stock boolean,
    ml_status text, safe_stock integer, cost numeric, ml_fee numeric, ml_shipping numeric, suggested_price numeric,
    profit numeric, margin_percent numeric, pricing_inconclusive boolean,
    search_document text, payload jsonb, queue_version bigint,
    source_updated_at timestamptz
  )
  on conflict (generation, product_id) do update set
    sku=excluded.sku, product_name=excluded.product_name, active=excluded.active,
    supplier_ids=excluded.supplier_ids, supplier_name=excluded.supplier_name,
    has_internal_stock=excluded.has_internal_stock,
    ml_status=excluded.ml_status, safe_stock=excluded.safe_stock, cost=excluded.cost,
    ml_fee=excluded.ml_fee, ml_shipping=excluded.ml_shipping,
    suggested_price=excluded.suggested_price, profit=excluded.profit,
    margin_percent=excluded.margin_percent, pricing_inconclusive=excluded.pricing_inconclusive,
    search_document=excluded.search_document, payload=excluded.payload,
    queue_version=excluded.queue_version, source_updated_at=excluded.source_updated_at,
    computed_at=excluded.computed_at
  where public.ui_product_projection.queue_version <= excluded.queue_version;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.upsert_ui_listing_projections(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  insert into public.ui_listing_projection(
    generation, item_id, product_id, product_sku, product_name, listing_title,
    observed_status, listing_type, catalog_status, price, profit, margin_percent,
    sold, visits, quality_score, quality_available, price_review, search_document,
    payload, queue_version, source_updated_at, computed_at
  )
  select row.generation, row.item_id, row.product_id, row.product_sku,
    row.product_name, row.listing_title, row.observed_status, row.listing_type,
    row.catalog_status, coalesce(row.price, 0), row.profit, row.margin_percent,
    coalesce(row.sold, 0), coalesce(row.visits, 0), row.quality_score,
    coalesce(row.quality_available, false), coalesce(row.price_review, false),
    row.search_document, row.payload, row.queue_version, row.source_updated_at,
    clock_timestamp()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row(
    generation integer, item_id text, product_id uuid, product_sku text,
    product_name text, listing_title text, observed_status text,
    listing_type text, catalog_status text, price numeric, profit numeric,
    margin_percent numeric, sold integer, visits integer, quality_score numeric,
    quality_available boolean, price_review boolean, search_document text,
    payload jsonb, queue_version bigint, source_updated_at timestamptz
  )
  on conflict (generation, item_id) do update set
    product_id=excluded.product_id, product_sku=excluded.product_sku,
    product_name=excluded.product_name, listing_title=excluded.listing_title,
    observed_status=excluded.observed_status, listing_type=excluded.listing_type,
    catalog_status=excluded.catalog_status, price=excluded.price, profit=excluded.profit,
    margin_percent=excluded.margin_percent, sold=excluded.sold, visits=excluded.visits,
    quality_score=excluded.quality_score, quality_available=excluded.quality_available,
    price_review=excluded.price_review, search_document=excluded.search_document,
    payload=excluded.payload, queue_version=excluded.queue_version,
    source_updated_at=excluded.source_updated_at, computed_at=excluded.computed_at
  where public.ui_listing_projection.queue_version <= excluded.queue_version;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.delete_ui_projection_if_version(
  p_entity_kind text, p_entity_key text, p_generation integer, p_version bigint
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if p_entity_kind = 'product' then
    delete from public.ui_product_projection
    where generation=p_generation and product_id=p_entity_key::uuid and queue_version<=p_version;
  elsif p_entity_kind = 'listing' then
    delete from public.ui_listing_projection
    where generation=p_generation and item_id=p_entity_key and queue_version<=p_version;
  else
    raise exception 'invalid_ui_projection_entity';
  end if;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.activate_ui_read_model_generation(
  p_generation integer,
  p_context_fingerprint text,
  p_context jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending bigint;
  projected_products bigint;
  projected_listings bigint;
  source_products bigint;
  source_listings bigint;
begin
  select count(*) into pending
  from public.ui_read_model_queue
  where scope = 'catalog_ui' and generation = p_generation;
  select count(*) into projected_products from public.ui_product_projection where generation = p_generation;
  select count(*) into projected_listings from public.ui_listing_projection where generation = p_generation;
  select count(*) into source_products from public.produtos;
  select count(*) into source_listings from public.anuncios_ml;

  if pending <> 0 or projected_products <> source_products or projected_listings <> source_listings then
    raise exception 'ui_read_model_generation_incomplete pending=% products=%/% listings=%/%',
      pending, projected_products, source_products, projected_listings, source_listings;
  end if;

  update public.ui_read_model_state
  set active_generation = p_generation,
      target_generation = p_generation,
      status = 'ready',
      context_fingerprint = p_context_fingerprint,
      context = p_context,
      activated_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where scope = 'catalog_ui' and target_generation = p_generation;

  if not found then raise exception 'ui_read_model_generation_not_target'; end if;

  delete from public.ui_product_projection where generation <> p_generation;
  delete from public.ui_listing_projection where generation <> p_generation;
  delete from public.ui_read_model_queue where generation <> p_generation;

  return jsonb_build_object('generation', p_generation, 'products', projected_products, 'listings', projected_listings);
end;
$$;

revoke all on function public.request_ui_read_model_rebuild(text),
  public.seed_ui_read_model_rebuild(), public.claim_ui_read_model_batch(integer),
  public.complete_ui_read_model_item(text,text,integer,bigint,uuid),
  public.fail_ui_read_model_item(text,text,integer,bigint,uuid,text),
  public.upsert_ui_product_projections(jsonb), public.upsert_ui_listing_projections(jsonb),
  public.delete_ui_projection_if_version(text,text,integer,bigint),
  public.activate_ui_read_model_generation(integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.request_ui_read_model_rebuild(text),
  public.seed_ui_read_model_rebuild(), public.claim_ui_read_model_batch(integer),
  public.complete_ui_read_model_item(text,text,integer,bigint,uuid),
  public.fail_ui_read_model_item(text,text,integer,bigint,uuid,text),
  public.upsert_ui_product_projections(jsonb), public.upsert_ui_listing_projections(jsonb),
  public.delete_ui_projection_if_version(text,text,integer,bigint),
  public.activate_ui_read_model_generation(integer,text,jsonb)
  to service_role;

create or replace function public.search_ui_product_projection(
  p_search text default null,
  p_supplier_dslite_ids text[] default null,
  p_include_internal boolean default false,
  p_product_active_status text default 'ativo',
  p_ml_status text default null,
  p_estoque text default null,
  p_price_field text default 'cost',
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_page integer default 1,
  p_page_size integer default 100,
  p_sort_by text default 'sku',
  p_sort_order text default 'asc'
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_generation integer;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 500);
  v_offset integer;
  v_sort_by text := case when p_sort_by in ('sku','nome','fornecedor','estoque','custo','ml_fee','ml_shipping','suggested_price','profit','ml_status') then p_sort_by else 'sku' end;
  v_sort_order text := case when p_sort_order = 'desc' then 'desc' else 'asc' end;
  v_price_field text := case when p_price_field in ('cost','suggestedPrice','profit') then p_price_field else 'cost' end;
  v_result jsonb;
begin
  select active_generation into v_generation from public.ui_read_model_state where scope = 'catalog_ui';
  if coalesce(v_generation, 0) = 0 then raise exception 'ui_read_model_not_ready'; end if;
  v_offset := (v_page - 1) * v_page_size;

  with filtered as (
    select projection.*,
      case v_price_field when 'suggestedPrice' then projection.suggested_price when 'profit' then projection.profit else projection.cost end as selected_price
    from public.ui_product_projection projection
    where projection.generation = v_generation
      and (coalesce(nullif(trim(p_search), ''), '') = '' or projection.search_document ilike '%' || trim(p_search) || '%')
      and ((coalesce(cardinality(p_supplier_dslite_ids), 0) = 0 and not coalesce(p_include_internal, false))
        or projection.supplier_ids && p_supplier_dslite_ids
        or (coalesce(p_include_internal, false) and projection.has_internal_stock))
      and (p_product_active_status = 'todos' or (p_product_active_status = 'inativo' and not projection.active)
        or (p_product_active_status not in ('todos','inativo') and projection.active))
      and (coalesce(nullif(trim(p_ml_status), ''), '') = '' or projection.ml_status = p_ml_status)
      and (coalesce(p_estoque,'') <> 'com_estoque' or projection.safe_stock > 0)
      and (coalesce(p_estoque,'') <> 'sem_estoque' or projection.safe_stock = 0)
      and (p_price_min is null or (case v_price_field when 'suggestedPrice' then projection.suggested_price when 'profit' then projection.profit else projection.cost end) >= p_price_min)
      and (p_price_max is null or (case v_price_field when 'suggestedPrice' then projection.suggested_price when 'profit' then projection.profit else projection.cost end) <= p_price_max)
  ), ordered as (
    select filtered.*, row_number() over(order by
      case when v_sort_by='sku' and v_sort_order='asc' then sku end asc nulls last,
      case when v_sort_by='sku' and v_sort_order='desc' then sku end desc nulls last,
      case when v_sort_by='nome' and v_sort_order='asc' then product_name end asc nulls last,
      case when v_sort_by='nome' and v_sort_order='desc' then product_name end desc nulls last,
      case when v_sort_by='fornecedor' and v_sort_order='asc' then supplier_name end asc nulls last,
      case when v_sort_by='fornecedor' and v_sort_order='desc' then supplier_name end desc nulls last,
      case when v_sort_by='estoque' and v_sort_order='asc' then safe_stock end asc nulls last,
      case when v_sort_by='estoque' and v_sort_order='desc' then safe_stock end desc nulls last,
      case when v_sort_by='custo' and v_sort_order='asc' then cost end asc nulls last,
      case when v_sort_by='custo' and v_sort_order='desc' then cost end desc nulls last,
      case when v_sort_by='ml_fee' and v_sort_order='asc' then ml_fee end asc nulls last,
      case when v_sort_by='ml_fee' and v_sort_order='desc' then ml_fee end desc nulls last,
      case when v_sort_by='ml_shipping' and v_sort_order='asc' then ml_shipping end asc nulls last,
      case when v_sort_by='ml_shipping' and v_sort_order='desc' then ml_shipping end desc nulls last,
      case when v_sort_by='suggested_price' and v_sort_order='asc' then suggested_price end asc nulls last,
      case when v_sort_by='suggested_price' and v_sort_order='desc' then suggested_price end desc nulls last,
      case when v_sort_by='profit' and v_sort_order='asc' then profit end asc nulls last,
      case when v_sort_by='profit' and v_sort_order='desc' then profit end desc nulls last,
      case when v_sort_by='ml_status' and v_sort_order='asc' then ml_status end asc nulls last,
      case when v_sort_by='ml_status' and v_sort_order='desc' then ml_status end desc nulls last,
      sku asc, product_id asc) as position
    from filtered
  ), queue_status as (
    select count(*)::integer as pending,
      extract(epoch from clock_timestamp() - min(queued_at))::integer as lag_seconds
    from public.ui_read_model_queue where scope='catalog_ui' and generation=v_generation
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(payload order by position) from ordered where position > v_offset and position <= v_offset + v_page_size), '[]'::jsonb),
    'total', (select count(*) from filtered), 'page', v_page, 'pageSize', v_page_size,
    'summary', jsonb_build_object(
      'total', (select count(*) from filtered),
      'comEstoque', (select count(*) from filtered where safe_stock > 0),
      'semAnuncio', (select count(*) from filtered where ml_status = 'sem_anuncio'),
      'receitaPotencial', case when exists(select 1 from filtered where pricing_inconclusive) then null
        else (select coalesce(sum(suggested_price * greatest(safe_stock,0)),0) from filtered) end,
      'lucroMedio', (select round(avg(profit),2) from filtered where profit is not null),
      'pricingInconclusive', (select count(*) from filtered where pricing_inconclusive),
      'profitSampleCount', (select count(profit) from filtered)
    ),
    'pricingTaxContext', (select context->'taxContext' from public.ui_read_model_state where scope='catalog_ui'),
    'commercialPricing', (select context->'commercial' from public.ui_read_model_state where scope='catalog_ui'),
    'freshness', (select jsonb_build_object('computedAt', (select max(computed_at) from public.ui_product_projection where generation=v_generation),
      'lagSeconds', coalesce(lag_seconds,0), 'pendingCount', pending,
      'state', case when coalesce(lag_seconds,0)>60 then 'delayed' when pending>0 then 'refreshing' else 'fresh' end) from queue_status)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.search_ui_listing_projection(
  p_page integer default 1, p_page_size integer default 100,
  p_search text default null, p_focus text default 'all', p_quality text default 'all',
  p_catalog text default 'all', p_profitability text default 'all',
  p_price_min numeric default null, p_price_max numeric default null,
  p_sort_by text default 'product', p_sort_order text default 'asc',
  p_sold_only boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_generation integer;
  v_page integer := greatest(coalesce(p_page,1),1);
  v_page_size integer := least(greatest(coalesce(p_page_size,100),1),500);
  v_offset integer;
  v_sort_by text := case when p_sort_by in ('item','product','price','profit','sold','visits','quality','status','catalog') then p_sort_by else 'product' end;
  v_sort_order text := case when p_sort_order='desc' then 'desc' else 'asc' end;
  v_result jsonb;
begin
  select active_generation into v_generation from public.ui_read_model_state where scope='catalog_ui';
  if coalesce(v_generation,0)=0 then raise exception 'ui_read_model_not_ready'; end if;
  v_offset := (v_page-1)*v_page_size;
  with common_filtered as (
    select * from public.ui_listing_projection listing
    where generation=v_generation
      and (coalesce(nullif(trim(p_search),''),'')='' or search_document ilike '%'||trim(p_search)||'%')
      and (p_price_min is null or price>=p_price_min) and (p_price_max is null or price<=p_price_max)
      and (p_quality='all' or (p_quality='risk' and quality_available and quality_score<80)
        or (p_quality='good' and quality_available and quality_score>=80 and quality_score<100)
        or (p_quality='perfect' and quality_available and quality_score>=100)
        or (p_quality='unavailable' and not quality_available))
      and (p_catalog='all' or (p_catalog='standard' and listing_type='standard')
        or (p_catalog='catalog' and listing_type='catalog') or (p_catalog='winning' and catalog_status='ganhando')
        or (p_catalog='competing' and catalog_status='competindo') or (p_catalog='losing' and catalog_status='perdendo'))
      and (p_profitability='all' or (p_profitability='positive' and profit>=0)
        or (p_profitability='negative' and profit<0) or (p_profitability='unknown' and profit is null))
      and (not coalesce(p_sold_only,false) or sold>0)
  ), focused as (
    select * from common_filtered where p_focus='all'
      or (p_focus='active' and observed_status='active') or (p_focus='paused' and observed_status='paused')
      or (p_focus='sold' and sold>0) or (p_focus='visited_unsold' and observed_status='active' and visits>0 and sold<=0)
      or (p_focus='quality_risk' and quality_available and quality_score<80)
      or (p_focus='price_review' and price_review)
  ), ordered as (
    select focused.*, row_number() over(order by
      case when v_sort_by='item' and v_sort_order='asc' then item_id end asc nulls last,
      case when v_sort_by='item' and v_sort_order='desc' then item_id end desc nulls last,
      case when v_sort_by='product' and v_sort_order='asc' then product_name end asc nulls last,
      case when v_sort_by='product' and v_sort_order='desc' then product_name end desc nulls last,
      case when v_sort_by='price' and v_sort_order='asc' then price end asc nulls last,
      case when v_sort_by='price' and v_sort_order='desc' then price end desc nulls last,
      case when v_sort_by='profit' and v_sort_order='asc' then profit end asc nulls last,
      case when v_sort_by='profit' and v_sort_order='desc' then profit end desc nulls last,
      case when v_sort_by='sold' and v_sort_order='asc' then sold end asc nulls last,
      case when v_sort_by='sold' and v_sort_order='desc' then sold end desc nulls last,
      case when v_sort_by='visits' and v_sort_order='asc' then visits end asc nulls last,
      case when v_sort_by='visits' and v_sort_order='desc' then visits end desc nulls last,
      case when v_sort_by='quality' and v_sort_order='asc' then quality_score end asc nulls last,
      case when v_sort_by='quality' and v_sort_order='desc' then quality_score end desc nulls last,
      case when v_sort_by='status' and v_sort_order='asc' then observed_status end asc nulls last,
      case when v_sort_by='status' and v_sort_order='desc' then observed_status end desc nulls last,
      case when v_sort_by='catalog' and v_sort_order='asc' then catalog_status end asc nulls last,
      case when v_sort_by='catalog' and v_sort_order='desc' then catalog_status end desc nulls last,
      item_id asc) as position from focused
  ), queue_status as (
    select count(*)::integer pending, extract(epoch from clock_timestamp()-min(queued_at))::integer lag_seconds
    from public.ui_read_model_queue where scope='catalog_ui' and generation=v_generation
  )
  select jsonb_build_object(
    'data',coalesce((select jsonb_agg(payload order by position) from ordered where position>v_offset and position<=v_offset+v_page_size),'[]'::jsonb),
    'total',(select count(*) from focused),'page',v_page,'pageSize',v_page_size,
    'metrics',jsonb_build_object('total',(select count(*) from common_filtered),'active',(select count(*) from common_filtered where observed_status='active'),
      'paused',(select count(*) from common_filtered where observed_status='paused'),'sold',(select count(*) from common_filtered where sold>0),
      'visitedUnsold',(select count(*) from common_filtered where observed_status='active' and visits>0 and sold<=0),
      'qualityRisk',(select count(*) from common_filtered where quality_available and quality_score<80),
      'priceReview',(select count(*) from common_filtered where price_review)),
    'queueCounts',jsonb_build_object('total',(select count(*) from common_filtered),'active',(select count(*) from common_filtered where observed_status='active'),
      'paused',(select count(*) from common_filtered where observed_status='paused'),'sold',(select count(*) from common_filtered where sold>0),
      'visitedUnsold',(select count(*) from common_filtered where observed_status='active' and visits>0 and sold<=0),
      'qualityRisk',(select count(*) from common_filtered where quality_available and quality_score<80),
      'priceReview',(select count(*) from common_filtered where price_review)),
    'lastSyncedAt',(select max(source_updated_at) from common_filtered),
    'pricingTaxContext',(select context->'taxContext' from public.ui_read_model_state where scope='catalog_ui'),
    'commercialPricing',(select context->'commercial' from public.ui_read_model_state where scope='catalog_ui'),
    'freshness',(select jsonb_build_object('computedAt',(select max(computed_at) from public.ui_listing_projection where generation=v_generation),
      'lagSeconds',coalesce(lag_seconds,0),'pendingCount',pending,
      'state',case when coalesce(lag_seconds,0)>60 then 'delayed' when pending>0 then 'refreshing' else 'fresh' end) from queue_status)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.search_ui_product_projection(text,text[],boolean,text,text,text,text,numeric,numeric,integer,integer,text,text),
  public.search_ui_listing_projection(integer,integer,text,text,text,text,text,numeric,numeric,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.search_ui_product_projection(text,text[],boolean,text,text,text,text,numeric,numeric,integer,integer,text,text),
  public.search_ui_listing_projection(integer,integer,text,text,text,text,text,numeric,numeric,text,text,boolean)
  to service_role;

create or replace function public.ui_read_model_direct_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare new_key text; old_key text; key text; parent uuid;
begin
  if tg_table_name='produtos' then
    if tg_op <> 'DELETE' then new_key:=new.id::text; end if;
    if tg_op <> 'INSERT' then old_key:=old.id::text; end if;
  elsif tg_table_name in ('produto_fornecedor_ofertas','estoque_interno_movimentacoes','produto_kits') then
    if tg_op <> 'DELETE' then new_key:=new.produto_id::text; end if;
    if tg_op <> 'INSERT' then old_key:=old.produto_id::text; end if;
  end if;
  for key in select distinct value from unnest(array[new_key,old_key]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',key,tg_table_name);
    for parent in select component.kit_produto_id from public.produto_kit_componentes component where component.componente_produto_id=key::uuid loop
      perform public.enqueue_ui_read_model('product',parent::text,tg_table_name||'_kit_parent');
    end loop;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_kit_component_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare key uuid;
begin
  for key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.kit_produto_id end,
    case when tg_op <> 'INSERT' then old.kit_produto_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',key::text,'produto_kit_componentes');
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_listing_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare product_key uuid; item_key text;
begin
  for product_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.produto_id end,
    case when tg_op <> 'INSERT' then old.produto_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',product_key::text,tg_table_name);
  end loop;
  for item_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.ml_item_id end,
    case when tg_op <> 'INSERT' then old.ml_item_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('listing',item_key,tg_table_name);
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_outbox_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare product_key uuid; item_key text;
begin
  for product_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.produto_id end,
    case when tg_op <> 'INSERT' then old.produto_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('product',product_key::text,'anuncios_ml_outbox');
  end loop;
  for item_key in select distinct value from unnest(array[
    case when tg_op <> 'DELETE' then new.ml_item_id end,
    case when tg_op <> 'INSERT' then old.ml_item_id end
  ]) as candidate(value) where value is not null loop
    perform public.enqueue_ui_read_model('listing',item_key,'anuncios_ml_outbox');
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_global_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.request_ui_read_model_rebuild(tg_table_name||'_global_change');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.ui_read_model_pricing_group_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare product_key uuid; group_key uuid;
begin
  if tg_table_name = 'ml_pricing_groups' then
    for product_key in select distinct value from unnest(array[
      case when tg_op <> 'DELETE' then new.produto_id end,
      case when tg_op <> 'INSERT' then old.produto_id end
    ]) as candidate(value) where value is not null loop
      perform public.enqueue_ui_read_model('product',product_key::text,tg_table_name);
    end loop;
  else
    for group_key in select distinct value from unnest(array[
      case when tg_op <> 'DELETE' then new.group_id end,
      case when tg_op <> 'INSERT' then old.group_id end
    ]) as candidate(value) where value is not null loop
      select groups.produto_id into product_key from public.ml_pricing_groups groups where groups.id=group_key;
      if product_key is not null then
        perform public.enqueue_ui_read_model('product',product_key::text,tg_table_name);
      end if;
    end loop;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create trigger ui_read_model_produtos after insert or update or delete on public.produtos
  for each row execute function public.ui_read_model_direct_trigger();
create trigger ui_read_model_ofertas after insert or update or delete on public.produto_fornecedor_ofertas
  for each row execute function public.ui_read_model_direct_trigger();
create trigger ui_read_model_movimentos after insert or update or delete on public.estoque_interno_movimentacoes
  for each row execute function public.ui_read_model_direct_trigger();
create trigger ui_read_model_kits after insert or update or delete on public.produto_kits
  for each row execute function public.ui_read_model_direct_trigger();
create trigger ui_read_model_componentes after insert or update or delete on public.produto_kit_componentes
  for each row execute function public.ui_read_model_kit_component_trigger();
create trigger ui_read_model_anuncios after insert or update or delete on public.anuncios_ml
  for each row execute function public.ui_read_model_listing_trigger();
create trigger ui_read_model_snapshots after insert or update or delete on public.catalogo_ml_snapshot
  for each row execute function public.ui_read_model_listing_trigger();
create trigger ui_read_model_outbox after insert or update or delete on public.anuncios_ml_outbox
  for each row execute function public.ui_read_model_outbox_trigger();
create trigger ui_read_model_pricing_groups after insert or update or delete on public.ml_pricing_groups
  for each row execute function public.ui_read_model_pricing_group_trigger();
create trigger ui_read_model_pricing_group_members after insert or update or delete on public.ml_pricing_group_members
  for each row execute function public.ui_read_model_pricing_group_trigger();
create trigger ui_read_model_pricing_group_revisions after insert or update or delete on public.ml_pricing_group_revisions
  for each row execute function public.ui_read_model_pricing_group_trigger();
create trigger ui_read_model_config after update of pricing_ml_fee_fallback_rate,
  pricing_unspecified_shipping_cost, simples_inicio_atividade, simples_aliquota_confirmada,
  simples_aliquota_confirmada_em on public.configuracoes
  for each row execute function public.ui_read_model_global_trigger();
create trigger ui_read_model_fornecedores after update of ativo, status_dslite, dropshipping,
  dropshipping_retired_at on public.fornecedores
  for each row execute function public.ui_read_model_global_trigger();

comment on table public.ui_product_projection is 'Projecao descartavel de leitura da tela Produtos; nunca autoriza operacoes.';
comment on table public.ui_listing_projection is 'Projecao descartavel de leitura da tela Anuncios; nunca autoriza operacoes.';
comment on table public.ui_read_model_queue is 'Fila idempotente de invalidacao das projecoes de interface.';

commit;
