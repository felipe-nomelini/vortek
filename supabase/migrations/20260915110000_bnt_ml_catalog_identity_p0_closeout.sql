create or replace function public.apply_ml_catalog_identity_projection_batch(
  p_run_id uuid,
  p_actor_id uuid,
  p_manifest_hash text,
  p_payloads jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload_count integer;
  unique_count integer;
  payload jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_payloads) <> 'array' then
    raise exception 'ml_catalog_identity_projection_batch_payload_invalid';
  end if;

  payload_count := jsonb_array_length(p_payloads);
  if payload_count < 1 or payload_count > 25 then
    raise exception 'ml_catalog_identity_projection_batch_size_invalid';
  end if;

  select count(distinct value->>'ml_item_id')
    into unique_count
  from jsonb_array_elements(p_payloads);
  if unique_count <> payload_count then
    raise exception 'ml_catalog_identity_projection_batch_duplicate_item';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ml_catalog_identity_batch:' || p_run_id::text, 0)
  );

  for payload in
    select value
    from jsonb_array_elements(p_payloads)
    order by value->>'ml_item_id'
  loop
    result := public.apply_ml_catalog_identity_projection(
      p_run_id,
      p_actor_id,
      p_manifest_hash,
      nullif(payload->>'command_id', '')::uuid,
      payload
    );
    results := results || jsonb_build_array(
      jsonb_build_object('ml_item_id', payload->>'ml_item_id', 'result', result)
    );
  end loop;

  return results;
end;
$$;

revoke all on function public.apply_ml_catalog_identity_projection_batch(uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_ml_catalog_identity_projection_batch(uuid,uuid,text,jsonb)
  to service_role;

create or replace function public.ml_catalog_identity_safety_snapshot(
  p_seller_id bigint,
  p_item_ids text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_count integer;
  distinct_count integer;
  product_snapshot jsonb;
  listing_snapshot jsonb;
  target_snapshot jsonb;
  outbox_snapshot jsonb;
  identity_snapshot jsonb;
begin
  item_count := coalesce(array_length(p_item_ids, 1), 0);
  select count(distinct item_id) into distinct_count from unnest(p_item_ids) item_id;
  if p_seller_id is null or item_count <> 1550 or distinct_count <> 1550 then
    raise exception 'ml_catalog_identity_safety_snapshot_scope_invalid';
  end if;

  select jsonb_build_object(
    'row_count', count(*),
    'ativo_true_count', count(*) filter (where ativo),
    'estoque_sum', coalesce(sum(estoque), 0),
    'custom_price_sum', coalesce(sum(custom_price), 0),
    'sha256', encode(public.digest(coalesce(string_agg(
      concat_ws('|', id::text, coalesce(sku, ''), ativo::text, estoque::text,
        coalesce(custom_price::text, 'NULL')), E'\n' order by id::text
    ), ''), 'sha256'), 'hex')
  ) into product_snapshot
  from public.produtos;

  select jsonb_build_object(
    'row_count', count(*),
    'price_sum', coalesce(sum(preco_ml), 0),
    'sha256', encode(public.digest(coalesce(string_agg(
      concat_ws('|', id::text, coalesce(ml_item_id, ''), coalesce(produto_id::text, ''),
        coalesce(sku, ''), coalesce(preco_ml::text, 'NULL'), status::text, catalogo::text),
      E'\n' order by id::text
    ), ''), 'sha256'), 'hex')
  ) into listing_snapshot
  from public.anuncios_ml;

  select jsonb_build_object(
    'row_count', count(*),
    'sha256', encode(public.digest(coalesce(string_agg(
      concat_ws('|', snapshot.ml_item_id, snapshot.seller_id::text,
        coalesce(snapshot.produto_id::text, ''), coalesce(snapshot.catalog_product_id, ''),
        coalesce(snapshot.related_item_id, ''), coalesce(snapshot.status, '')),
      E'\n' order by snapshot.ml_item_id
    ), ''), 'sha256'), 'hex')
  ) into target_snapshot
  from public.catalogo_ml_snapshot snapshot
  where snapshot.seller_id = p_seller_id
    and snapshot.ml_item_id = any(p_item_ids);

  select jsonb_build_object(
    'row_count', count(*),
    'pending_count', count(*) filter (where status in ('pending','processing')),
    'sha256', encode(public.digest(coalesce(string_agg(
      concat_ws('|', id::text, ml_item_id, status, coalesce(desired_status::text, 'NULL'),
        coalesce(desired_price::text, 'NULL'), coalesce(desired_quantity::text, 'NULL')),
      E'\n' order by id::text
    ), ''), 'sha256'), 'hex')
  ) into outbox_snapshot
  from public.anuncios_ml_outbox;

  select jsonb_build_object(
    'row_count', count(*),
    'sem_conflito', count(*) filter (where identity_state = 'SEM_CONFLITO' and not block_price_write),
    'blocked', count(*) filter (where block_price_write),
    'sha256', encode(public.digest(coalesce(string_agg(
      concat_ws('|', ml_item_id, identity_state, reason_code, material_fingerprint,
        ml_live_source_available::text, block_price_write::text, block_buy_box_chase::text),
      E'\n' order by ml_item_id
    ), ''), 'sha256'), 'hex')
  ) into identity_snapshot
  from public.ml_catalog_identity_current
  where seller_id = p_seller_id
    and ml_item_id = any(p_item_ids);

  return jsonb_build_object(
    'seller_id', p_seller_id,
    'item_count', item_count,
    'captured_at', clock_timestamp(),
    'products', product_snapshot,
    'listings', listing_snapshot,
    'target_relations', target_snapshot,
    'outbox', outbox_snapshot,
    'identity', identity_snapshot
  );
end;
$$;

revoke all on function public.ml_catalog_identity_safety_snapshot(bigint,text[])
  from public, anon, authenticated;
grant execute on function public.ml_catalog_identity_safety_snapshot(bigint,text[])
  to service_role;

notify pgrst, 'reload schema';
