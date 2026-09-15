create or replace function public.apply_ml_catalog_identity_projection(
  p_run_id uuid,
  p_actor_id uuid,
  p_manifest_hash text,
  p_command_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.ml_catalog_identity_runs%rowtype;
  audit_row public.ml_catalog_identity_audits%rowtype;
  existing_action public.ml_catalog_identity_actions%rowtype;
  listing_row public.anuncios_ml%rowtype;
  snapshot_row public.catalogo_ml_snapshot%rowtype;
  product_row public.produtos%rowtype;
  item_id text := nullif(p_payload->>'ml_item_id', '');
  state text := nullif(p_payload->>'identity_state', '');
  reason text := nullif(p_payload->>'reason_code', '');
  fingerprint text := nullif(p_payload->>'material_fingerprint', '');
  seller bigint := nullif(p_payload->>'seller_id', '')::bigint;
  live_available boolean := coalesce((p_payload->>'ml_live_source_available')::boolean, false);
  clear_identity boolean;
  action_type text;
  action_state text;
  product_id uuid := nullif(p_payload->>'produto_id', '')::uuid;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or item_id !~ '^MLB[0-9]+$'
    or state not in ('SEM_CONFLITO','CONFLITO_CONFIRMADO','PENDENCIA_VALIDACAO','INCONCLUSIVO')
    or reason is null
    or fingerprint !~ '^[a-f0-9]{64}$'
    or seller is null
    or product_id is null
  then
    raise exception 'ml_catalog_identity_projection_payload_invalid';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.cargo = 'admin'
  ) then
    raise exception 'ml_catalog_identity_projection_admin_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ml_catalog_identity:' || p_run_id::text || ':' || item_id, 0)
  );

  select * into run_row
  from public.ml_catalog_identity_runs run
  where run.id = p_run_id
  for update;

  if run_row.id is null
    or run_row.state <> 'applying'
    or run_row.mode <> 'apply'
    or run_row.manifest_hash is distinct from p_manifest_hash
    or run_row.approved_manifest_hash is distinct from p_manifest_hash
    or run_row.approved_by is distinct from p_actor_id
  then
    raise exception 'ml_catalog_identity_projection_run_invalid';
  end if;

  select * into audit_row
  from public.ml_catalog_identity_audits audit
  where audit.run_id = p_run_id and audit.ml_item_id = item_id
  for update;

  if audit_row.id is null then
    raise exception 'ml_catalog_identity_projection_audit_missing';
  end if;

  if audit_row.input_row->>'command_id' is distinct from p_command_id::text
    or audit_row.input_row->>'identity_state' is distinct from state
    or audit_row.input_row->>'reason_code' is distinct from reason
    or audit_row.input_row->>'material_fingerprint' is distinct from fingerprint
    or nullif(audit_row.input_row->>'seller_id', '')::bigint is distinct from seller
    or nullif(audit_row.input_row->>'produto_id', '')::uuid is distinct from product_id
    or audit_row.input_row->>'sku' is distinct from p_payload->>'sku'
    or audit_row.input_row->>'catalog_product_id' is distinct from p_payload->>'catalog_product_id'
    or audit_row.input_row->>'standard_item_id' is distinct from p_payload->>'standard_item_id'
  then
    raise exception 'ml_catalog_identity_projection_manifest_decision_mismatch';
  end if;

  select * into product_row
  from public.produtos product
  where product.id = product_id
  for share;

  select * into listing_row
  from public.anuncios_ml listing
  where listing.ml_item_id = item_id
  for share;

  select * into snapshot_row
  from public.catalogo_ml_snapshot snapshot
  where snapshot.seller_id = seller and snapshot.ml_item_id = item_id
  for share;

  if product_row.id is null
    or listing_row.id is null
    or snapshot_row.id is null
    or listing_row.produto_id is distinct from product_id
    or snapshot_row.produto_id is distinct from product_id
    or listing_row.sku is distinct from nullif(p_payload->>'sku', '')
    or snapshot_row.catalog_product_id is distinct from nullif(p_payload->>'catalog_product_id', '')
    or snapshot_row.related_item_id is distinct from nullif(p_payload->>'standard_item_id', '')
    or listing_row.preco_ml is distinct from nullif(p_payload->>'local_listing_price', '')::numeric
    or product_row.ativo is distinct from nullif(p_payload->>'produtos_ativo', '')::boolean
    or product_row.estoque is distinct from nullif(p_payload->>'produtos_estoque', '')::integer
    or product_row.custom_price is distinct from nullif(p_payload->>'produtos_custom_price', '')::numeric
  then
    raise exception 'ml_catalog_identity_projection_local_readback_changed';
  end if;

  if audit_row.processing_state = 'processed' then
    select * into existing_action
    from public.ml_catalog_identity_actions action
    where action.command_id = p_command_id;
    if existing_action.id is null
      or existing_action.audit_id <> audit_row.id
      or audit_row.material_fingerprint is distinct from fingerprint
      or audit_row.identity_state is distinct from state
    then
      raise exception 'ml_catalog_identity_projection_replay_conflict';
    end if;
    return jsonb_build_object('audit_id', audit_row.id, 'action_id', existing_action.id, 'replayed', true);
  end if;

  clear_identity := state = 'SEM_CONFLITO' and live_available;
  action_type := case when clear_identity then 'NO_ACTION' else 'MANUAL_REVIEW' end;
  action_state := case when clear_identity then 'confirmed' else 'inconclusive' end;

  update public.ml_catalog_identity_audits
  set seller_id = seller,
      produto_id = nullif(p_payload->>'produto_id', '')::uuid,
      sku = nullif(p_payload->>'sku', ''),
      ml_item_id_related = nullif(p_payload->>'standard_item_id', ''),
      catalog_product_id = nullif(p_payload->>'catalog_product_id', ''),
      identity_state = state,
      reason_code = reason,
      conflict_type = nullif(p_payload->>'conflict_type', ''),
      risk_tier = nullif(p_payload->>'risk_tier', ''),
      material_fingerprint = fingerprint,
      ml_live_source_available = live_available,
      block_price_write = not clear_identity,
      block_buy_box_chase = not clear_identity,
      produtos_ativo_before = nullif(p_payload->>'produtos_ativo', '')::boolean,
      produtos_ativo_after = nullif(p_payload->>'produtos_ativo', '')::boolean,
      old_relation = coalesce(p_payload->'old_relation', '{}'::jsonb),
      proposed_relation = coalesce(p_payload->'new_relation', '{}'::jsonb),
      evidence = coalesce(p_payload->'evidence', '{}'::jsonb),
      comparisons = coalesce(p_payload->'comparisons', '[]'::jsonb),
      old_price = nullif(p_payload->>'current_price', '')::numeric,
      new_price = nullif(p_payload->>'current_price', '')::numeric,
      pricing_source = 'mercado_livre',
      action = nullif(p_payload->>'action', ''),
      action_result = nullif(p_payload->>'action_result', ''),
      ml_readback = p_payload->'ml_readback',
      processing_state = 'processed',
      attempts = greatest(audit_row.attempts, 1),
      error = nullif(p_payload->>'error', ''),
      started_at = coalesce(audit_row.started_at, clock_timestamp()),
      finished_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = audit_row.id
  returning * into audit_row;

  insert into public.ml_catalog_identity_current (
    seller_id, ml_item_id, audit_id, identity_state, reason_code,
    material_fingerprint, ml_live_source_available, block_price_write,
    block_buy_box_chase, observed_at, updated_at
  ) values (
    seller, item_id, audit_row.id, state, reason, fingerprint, live_available,
    not clear_identity, not clear_identity,
    coalesce(nullif(p_payload->>'observed_at', '')::timestamptz, clock_timestamp()),
    clock_timestamp()
  )
  on conflict (seller_id, ml_item_id) do update
  set audit_id = excluded.audit_id,
      identity_state = excluded.identity_state,
      reason_code = excluded.reason_code,
      material_fingerprint = excluded.material_fingerprint,
      ml_live_source_available = excluded.ml_live_source_available,
      block_price_write = excluded.block_price_write,
      block_buy_box_chase = excluded.block_buy_box_chase,
      observed_at = excluded.observed_at,
      updated_at = clock_timestamp();

  insert into public.ml_catalog_identity_actions (
    audit_id, command_id, action_type, state, expected_fingerprint,
    actor_id, approved_by, reason, before_state, after_state, readback,
    rollback_plan, error, started_at, finished_at
  ) values (
    audit_row.id, p_command_id, action_type, action_state, fingerprint,
    p_actor_id, p_actor_id, left(coalesce(p_payload->>'action_reason', reason), 500),
    coalesce(p_payload->'old_relation', '{}'::jsonb),
    coalesce(p_payload->'new_relation', '{}'::jsonb),
    p_payload->'ml_readback',
    coalesce(p_payload->'rollback_plan', '{}'::jsonb),
    nullif(p_payload->>'error', ''), clock_timestamp(), clock_timestamp()
  )
  returning * into existing_action;

  return jsonb_build_object('audit_id', audit_row.id, 'action_id', existing_action.id, 'replayed', false);
end;
$$;

revoke all on function public.apply_ml_catalog_identity_projection(uuid,uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_ml_catalog_identity_projection(uuid,uuid,text,uuid,jsonb)
  to service_role;

notify pgrst, 'reload schema';

create or replace function public.invalidate_ml_catalog_identity_on_product_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.sku is distinct from new.sku
    or old.nome is distinct from new.nome
    or old.marca is distinct from new.marca
    or old.gtin is distinct from new.gtin
  then
    update public.ml_catalog_identity_current current_identity
    set identity_state = 'PENDENCIA_VALIDACAO',
        reason_code = 'PRODUTO_LOCAL_IDENTIDADE_ALTERADA',
        block_price_write = true,
        block_buy_box_chase = true,
        ml_live_source_available = false,
        updated_at = clock_timestamp()
    from public.catalogo_ml_snapshot snapshot
    where snapshot.produto_id = new.id
      and current_identity.seller_id = snapshot.seller_id
      and current_identity.ml_item_id = snapshot.ml_item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invalidate_ml_catalog_identity_on_product on public.produtos;
create trigger trg_invalidate_ml_catalog_identity_on_product
after update of sku,nome,marca,gtin on public.produtos
for each row execute function public.invalidate_ml_catalog_identity_on_product_change();

revoke all on function public.invalidate_ml_catalog_identity_on_product_change()
  from public, anon, authenticated;
grant execute on function public.invalidate_ml_catalog_identity_on_product_change()
  to service_role;

notify pgrst, 'reload schema';
