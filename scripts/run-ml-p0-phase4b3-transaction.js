#!/usr/bin/env node
/* Phase 4B.3 resumed: one true PostgreSQL transaction, no Mercado Livre writes. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
  EXPECTED,
  attribute,
  buildLocalRemoteDiff,
  mapListingType,
  mapStatus,
  remoteCommercialHash,
  validateRemoteIdentity,
} = require('./lib/ml-p0-phase4b3');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-p0-phase4b3');
const NORMALIZATION_REPORT = path.resolve('reports/ml-p0-phase4b31/full-report.json');
const SSH_HOST = '192.168.1.160';
const DB_CONTAINER = 'supabase-db';
const HOLD = 'P0 PHASE 4B.3 — LOCAL PERSISTENCE HOLD';
const ACCEPTED = Object.freeze({
  image6Id: '842932-MLA116279067739_082026',
  heightCm: 16,
  lengthCm: 5,
  widthCm: 11,
  weightG: 110,
  shippingCost: 18.45,
  supplierHeightCm: 17,
  supplierLengthCm: 12,
  supplierWidthCm: 13,
  supplierWeightKg: 0.262,
});
const now = () => new Date().toISOString();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(name, value) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  const remoteCommand = `docker exec -i ${DB_CONTAINER} psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At`;
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', SSH_HOST, remoteCommand], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = new Error(`psql_failed:${String(result.stderr || result.stdout).trim()}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return String(result.stdout || '').trim();
}

function parseLastJson(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('psql_json_output_missing');
  return JSON.parse(lines.at(-1));
}

function localReadbackSql() {
  return `
select json_build_object(
  'read_at', clock_timestamp(),
  'product', (
    select row_to_json(p) from (
      select id, sku, nome, gtin, ml_item_id, ml_status, altura, largura, profundidade,
             peso_bruto, estoque, custo, fornecedor, updated_at
      from public.produtos
      where id = '${EXPECTED.productId}'::uuid
    ) p
  ),
  'item_listings', coalesce((
    select json_agg(row_to_json(a) order by a.created_at)
    from (
      select id, ml_item_id, produto_id, sku, titulo, tipo, preco_ml, vendidos, visitas,
             qualidade, qualidade_info, status, catalogo, thumbnail, permalink,
             created_at, updated_at
      from public.anuncios_ml
      where ml_item_id = '${EXPECTED.itemId}'
      order by created_at
    ) a
  ), '[]'::json),
  'product_listings', coalesce((
    select json_agg(row_to_json(a) order by a.created_at)
    from (
      select id, ml_item_id, produto_id, sku, titulo, tipo, preco_ml, status, catalogo, permalink, created_at
      from public.anuncios_ml
      where produto_id = '${EXPECTED.productId}'::uuid or sku = '${EXPECTED.sku}'
      order by created_at
    ) a
  ), '[]'::json),
  'products_pointing_to_item', coalesce((
    select json_agg(row_to_json(p))
    from (select id, sku, ml_item_id, ml_status from public.produtos where ml_item_id = '${EXPECTED.itemId}') p
  ), '[]'::json)
);
`;
}

function buildTransactionSql(item) {
  const title = sqlLiteral(item.title);
  const thumbnail = sqlLiteral(item.pictures?.[0]?.secure_url || item.thumbnail || null);
  const permalink = sqlLiteral(item.permalink || null);
  const localType = sqlLiteral(mapListingType(item.listing_type_id));
  const localStatus = sqlLiteral(mapStatus(item.status));
  const catalog = item.catalog_listing === true ? 'true' : 'false';
  const price = Number(item.price).toFixed(2);
  const sold = Number(item.sold_quantity || 0);

  return `
\\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('ml-p0:${EXPECTED.sku}', 0));
create temp table phase4b3_result (
  result text not null,
  listing_id uuid,
  product_ml_item_id text,
  transaction_id bigint
) on commit preserve rows;

do $phase4b3$
declare
  v_product public.produtos%rowtype;
  v_existing public.anuncios_ml%rowtype;
  v_listing_id uuid;
  v_conflicts integer;
  v_updated integer;
begin
  select * into v_product
  from public.produtos
  where id = '${EXPECTED.productId}'::uuid
  for update;

  if not found then raise exception 'LOCAL_PERSIST_ABORT_IDENTITY_MISMATCH:product_not_found'; end if;
  if v_product.sku <> '${EXPECTED.sku}' or coalesce(v_product.gtin, '') <> '${EXPECTED.gtin}' then
    raise exception 'LOCAL_PERSIST_ABORT_IDENTITY_MISMATCH:local_product_identity';
  end if;
  if v_product.altura <> ${ACCEPTED.supplierHeightCm}
     or v_product.largura <> ${ACCEPTED.supplierWidthCm}
     or v_product.profundidade <> ${ACCEPTED.supplierLengthCm}
     or v_product.peso_bruto <> ${ACCEPTED.supplierWeightKg} then
    raise exception 'LOCAL_PERSIST_ABORT_IDENTITY_MISMATCH:supplier_master_dimensions_changed';
  end if;

  perform 1 from public.anuncios_ml
  where ml_item_id = '${EXPECTED.itemId}'
     or produto_id = '${EXPECTED.productId}'::uuid
     or sku = '${EXPECTED.sku}'
  for update;

  select count(*) into v_conflicts
  from public.produtos
  where id <> '${EXPECTED.productId}'::uuid and ml_item_id = '${EXPECTED.itemId}';
  if v_conflicts > 0 then raise exception 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK:other_product'; end if;

  select count(*) into v_conflicts
  from public.anuncios_ml
  where (produto_id = '${EXPECTED.productId}'::uuid or sku = '${EXPECTED.sku}')
    and ml_item_id <> '${EXPECTED.itemId}';
  if v_conflicts > 0 then raise exception 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK:other_listing'; end if;

  select * into v_existing
  from public.anuncios_ml
  where ml_item_id = '${EXPECTED.itemId}';

  if v_product.ml_item_id = '${EXPECTED.itemId}'
     and found
     and v_existing.produto_id = '${EXPECTED.productId}'::uuid
     and v_existing.sku = '${EXPECTED.sku}' then
    insert into phase4b3_result values (
      'LOCAL_PERSIST_ALREADY_CONSISTENT', v_existing.id, v_product.ml_item_id, txid_current()
    );
    return;
  end if;

  if v_product.ml_item_id is not null or found then
    raise exception 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK:partial_or_existing_link';
  end if;
  if v_product.ml_status <> 'sem_anuncio'::public.ml_status then
    raise exception 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK:unexpected_product_status';
  end if;

  insert into public.anuncios_ml (
    ml_item_id, produto_id, sku, titulo, tipo, preco_ml, vendidos, status,
    catalogo, thumbnail, permalink
  ) values (
    '${EXPECTED.itemId}', '${EXPECTED.productId}'::uuid, '${EXPECTED.sku}', ${title},
    ${localType}, ${price}, ${sold}, ${localStatus}::public.ml_status,
    ${catalog}, ${thumbnail}, ${permalink}
  ) returning id into v_listing_id;

  update public.produtos
  set ml_item_id = '${EXPECTED.itemId}', ml_status = 'ativo'::public.ml_status
  where id = '${EXPECTED.productId}'::uuid
    and sku = '${EXPECTED.sku}'
    and ml_item_id is null
    and ml_status = 'sem_anuncio'::public.ml_status
    and altura = ${ACCEPTED.supplierHeightCm}
    and largura = ${ACCEPTED.supplierWidthCm}
    and profundidade = ${ACCEPTED.supplierLengthCm}
    and peso_bruto = ${ACCEPTED.supplierWeightKg};
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'LOCAL_PERSIST_TRANSACTION_FAILED:conditional_update'; end if;

  insert into phase4b3_result values (
    'LOCAL_PERSIST_SUCCESS', v_listing_id, '${EXPECTED.itemId}', txid_current()
  );
end
$phase4b3$;
commit;

select row_to_json(r) from (
  select result, listing_id, product_ml_item_id, transaction_id, true as committed
  from phase4b3_result
) r;
`;
}

async function mlGet(token, resource, allow404 = false) {
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`ml_get_failed:${response.status}:${resource}:${data?.message || 'unknown'}`);
  return data;
}

async function loadRemote(token) {
  const item = await mlGet(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`);
  const userProduct = await mlGet(token, `/user-products/${EXPECTED.userProductId}`);
  const family = await mlGet(token, `/sites/MLB/user-products-families/${EXPECTED.familyId}`);
  const description = await mlGet(token, `/items/${EXPECTED.itemId}/description`, true);
  return { read_at: now(), item, user_product: userProduct, family, description };
}

function acceptedNormalizationChecks(remote, normalization) {
  const item = remote.item;
  const checks = [
    ['normalization_audit', 'REMOTE_NORMALIZATION_ACCEPTABLE', normalization.classification],
    ['image_6_id', ACCEPTED.image6Id, item.pictures?.[5]?.id],
    ['SELLER_PACKAGE_HEIGHT', `${ACCEPTED.heightCm} cm`, attribute(item, 'SELLER_PACKAGE_HEIGHT')],
    ['SELLER_PACKAGE_LENGTH', `${ACCEPTED.lengthCm} cm`, attribute(item, 'SELLER_PACKAGE_LENGTH')],
    ['SELLER_PACKAGE_WIDTH', `${ACCEPTED.widthCm} cm`, attribute(item, 'SELLER_PACKAGE_WIDTH')],
    ['SELLER_PACKAGE_WEIGHT', `${ACCEPTED.weightG} g`, attribute(item, 'SELLER_PACKAGE_WEIGHT')],
    ['shipping.mode', 'me2', item.shipping?.mode],
    ['shipping.logistic_type', 'xd_drop_off', item.shipping?.logistic_type],
  ].map(([field, expected, actual]) => ({
    field,
    expected,
    actual,
    status: String(expected) === String(actual) ? 'MATCH' : 'DIVERGENT',
  }));
  return { checks, valid: checks.every((row) => row.status === 'MATCH') };
}

function verifyLocalState(local, remote) {
  const listing = local.item_listings?.[0] || null;
  const diff = buildLocalRemoteDiff(local.product, listing, remote.item);
  const supplierMaster = [
    ['altura', ACCEPTED.supplierHeightCm, Number(local.product?.altura)],
    ['largura', ACCEPTED.supplierWidthCm, Number(local.product?.largura)],
    ['profundidade', ACCEPTED.supplierLengthCm, Number(local.product?.profundidade)],
    ['peso_bruto', ACCEPTED.supplierWeightKg, Number(local.product?.peso_bruto)],
  ].map(([field, expected, actual]) => ({ field, expected, actual, status: expected === actual ? 'MATCH' : 'DIVERGENT' }));
  const unique = local.item_listings?.length === 1
    && local.product_listings?.length === 1
    && local.products_pointing_to_item?.length === 1
    && local.products_pointing_to_item[0].id === EXPECTED.productId;
  return {
    ...diff,
    supplier_master: supplierMaster,
    supplier_master_preserved: supplierMaster.every((row) => row.status === 'MATCH'),
    uniqueness: {
      valid: unique,
      item_listing_count: local.item_listings?.length || 0,
      product_listing_count: local.product_listings?.length || 0,
      products_pointing_to_item_count: local.products_pointing_to_item?.length || 0,
    },
    material_drift: diff.material_drift || !unique || supplierMaster.some((row) => row.status !== 'MATCH'),
  };
}

async function main() {
  const startedAt = now();
  const normalization = readJson(NORMALIZATION_REPORT);
  if (normalization.classification !== 'REMOTE_NORMALIZATION_ACCEPTABLE') {
    throw new Error('normalization_authorization_evidence_missing');
  }

  const supabaseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_service_configuration_missing');
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const integrationResult = await supabase.from('integracoes').select('access_token,conectado').eq('tipo', 'mercadolivre').maybeSingle();
  if (integrationResult.error || !integrationResult.data?.conectado || !integrationResult.data?.access_token) {
    throw new Error(`ml_integration_unavailable:${integrationResult.error?.message || 'missing_token'}`);
  }
  const token = integrationResult.data.access_token;

  const previousFullPath = path.join(REPORT_DIR, 'full-report.json');
  if (fs.existsSync(previousFullPath)) {
    const previous = readJson(previousFullPath);
    if (previous.result === 'LOCAL_PERSIST_ABORT_REMOTE_DRIFT') {
      writeJson('attempt-1-remote-drift-abort.json', previous);
    }
  }

  const remoteBefore = await loadRemote(token);
  const identity = validateRemoteIdentity(remoteBefore.item, remoteBefore.user_product, remoteBefore.family);
  const acceptedNormalizations = acceptedNormalizationChecks(remoteBefore, normalization);
  if (identity.identityMismatch || identity.commercialDrift) throw new Error('LOCAL_PERSIST_ABORT_IDENTITY_MISMATCH');
  if (!acceptedNormalizations.valid) throw new Error('LOCAL_PERSIST_ABORT_REMOTE_DRIFT');
  if (Number(normalization.shipping_revalidation?.effective_current_cost) !== ACCEPTED.shippingCost
      || normalization.financial_revalidation?.current?.approved !== true) {
    throw new Error('LOCAL_PERSIST_ABORT_REMOTE_DRIFT:financial_evidence');
  }

  const localBefore = parseLastJson(psql(localReadbackSql()));
  writeJson('pre-write-product.json', { captured_at: now(), product: localBefore.product });
  writeJson('pre-write-listing-state.json', {
    captured_at: now(),
    item_listings: localBefore.item_listings,
    product_listings: localBefore.product_listings,
    products_pointing_to_item: localBefore.products_pointing_to_item,
  });
  writeJson('remote-readback.json', remoteBefore);

  const transactionSql = buildTransactionSql(remoteBefore.item);
  writeJson('transaction-plan.json', {
    generated_at: now(),
    mechanism: 'single_postgresql_session_begin_commit',
    advisory_lock: `ml-p0:${EXPECTED.sku}`,
    row_lock: 'public.produtos FOR UPDATE plus matching anuncios_ml FOR UPDATE',
    expected_mutations: ['insert public.anuncios_ml', 'update public.produtos.ml_item_id/ml_status'],
    supplier_master_fields_updated: [],
    statement_sha256: require('crypto').createHash('sha256').update(transactionSql).digest('hex'),
  });

  const transactionResult = parseLastJson(psql(transactionSql));
  const localAfter = parseLastJson(psql(localReadbackSql()));
  const remoteAfter = await loadRemote(token);
  const reconciliation = verifyLocalState(localAfter, remoteAfter);
  const remoteHashBefore = remoteCommercialHash(remoteBefore.item, remoteBefore.user_product, remoteBefore.family);
  const remoteHashAfter = remoteCommercialHash(remoteAfter.item, remoteAfter.user_product, remoteAfter.family);
  const remoteUnchanged = remoteHashBefore === remoteHashAfter;

  let result = transactionResult.result;
  if (!transactionResult.committed) result = 'LOCAL_PERSIST_TRANSACTION_FAILED';
  else if (reconciliation.material_drift || !remoteUnchanged) result = 'LOCAL_PERSIST_DRIFT';

  writeJson('local-write-result.json', {
    started_at: startedAt,
    completed_at: now(),
    result,
    transaction: transactionResult,
    writes: transactionResult.result === 'LOCAL_PERSIST_SUCCESS' ? [
      { table: 'anuncios_ml', operation: 'INSERT', ml_item_id: EXPECTED.itemId, produto_id: EXPECTED.productId, sku: EXPECTED.sku },
      { table: 'produtos', operation: 'UPDATE', fields: { ml_item_id: EXPECTED.itemId, ml_status: 'ativo' } },
    ] : [],
    supplier_master_fields_updated: [],
    mercado_livre_writes: 0,
    description_writes: 0,
  });
  writeJson('local-readback.json', localAfter);
  writeJson('local-remote-diff.json', { generated_at: now(), ...reconciliation, remote_commercial_hash_unchanged: remoteUnchanged });

  const report = {
    started_at: startedAt,
    completed_at: now(),
    result,
    sku: EXPECTED.sku,
    produto_id: EXPECTED.productId,
    item_id: EXPECTED.itemId,
    user_product_id: EXPECTED.userProductId,
    family_id: EXPECTED.familyId,
    accepted_normalizations: acceptedNormalizations,
    financial_gate: {
      shipping_cost: normalization.shipping_revalidation.effective_current_cost,
      profit: normalization.financial_revalidation.current.profit,
      margin_percent: normalization.financial_revalidation.current.margin_percent,
      approved: normalization.financial_revalidation.current.approved,
    },
    remote_before: remoteBefore,
    local_before: localBefore,
    transaction: transactionResult,
    local_after: localAfter,
    remote_after: remoteAfter,
    reconciliation,
    remote_commercial_hash_before: remoteHashBefore,
    remote_commercial_hash_after: remoteHashAfter,
    remote_commercial_hash_unchanged: remoteUnchanged,
    writes: {
      mercado_livre: 0,
      description: 0,
      second_sku: 0,
      supabase_transaction_committed: transactionResult.committed === true,
      product_master_dimensions: 0,
    },
    official_contracts: {
      mercado_livre_user_products: 'https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products',
      mercado_envios_2: 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/mercado-envios-2',
      supabase_postgres: 'https://supabase.com/docs/guides/database/connecting-to-postgres',
    },
    hold: HOLD,
  };
  writeJson('full-report.json', report);
  writeJson('summary.json', {
    generated_at: report.completed_at,
    result,
    sku: EXPECTED.sku,
    produto_id: EXPECTED.productId,
    item_id: EXPECTED.itemId,
    user_product_id: EXPECTED.userProductId,
    family_id: EXPECTED.familyId,
    remote_status: remoteAfter.item.status,
    remote_price: remoteAfter.item.price,
    remote_stock: remoteAfter.item.available_quantity,
    remote_title: remoteAfter.item.title,
    remote_permalink: remoteAfter.item.permalink,
    transaction_id: transactionResult.transaction_id,
    transaction_committed: transactionResult.committed,
    local_listing_id: transactionResult.listing_id,
    local_ml_item_id: localAfter.product.ml_item_id,
    local_ml_status: localAfter.product.ml_status,
    supplier_master_preserved: reconciliation.supplier_master_preserved,
    unique_link: reconciliation.uniqueness.valid,
    remote_commercial_hash_unchanged: remoteUnchanged,
    mercado_livre_writes: 0,
    description_writes: 0,
    hold: HOLD,
  });

  console.log(JSON.stringify({
    event: 'p0_phase4b3_transaction_complete',
    result,
    transaction_id: transactionResult.transaction_id,
    listing_id: transactionResult.listing_id,
    supplier_master_preserved: reconciliation.supplier_master_preserved,
    unique_link: reconciliation.uniqueness.valid,
    ml_writes: 0,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    writeJson('transaction-error.json', {
      failed_at: now(),
      result: error.message.includes('ABORT') ? error.message.split(':')[0] : 'LOCAL_PERSIST_TRANSACTION_FAILED',
      error: error.message,
      stdout: error.stdout || null,
      stderr: error.stderr || null,
      mercado_livre_writes: 0,
      description_writes: 0,
      hold: HOLD,
    });
    console.error(JSON.stringify({ event: 'p0_phase4b3_transaction_failed', error: error.message, ml_writes: 0 }));
    process.exitCode = 1;
  });
}

module.exports = { buildTransactionSql, localReadbackSql, sqlLiteral };
