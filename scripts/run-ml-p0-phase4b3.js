#!/usr/bin/env node
/* Phase 4B.3: local-only, idempotent persistence for the single authorized canary. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
  EXPECTED,
  buildListingPayload,
  buildLocalRemoteDiff,
  classifyLocalState,
  compareStableRemoteState,
  remoteCommercialHash,
  stableRemoteCommercialState,
  validateRemoteIdentity,
} = require('./lib/ml-p0-phase4b3');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-p0-phase4b3');
const PHASE4B2_READBACK = path.resolve('reports/ml-p0-phase4b2/canary-readback.json');
const PHASE4B2_SUMMARY = path.resolve('reports/ml-p0-phase4b2/summary.json');
const HOLD = 'P0 PHASE 4B.3 — LOCAL PERSISTENCE HOLD';
const now = () => new Date().toISOString();

fs.mkdirSync(REPORT_DIR, { recursive: true });

function writeJson(name, value) {
  fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sanitizeError(error) {
  if (!error) return null;
  return { message: error.message || String(error), code: error.code || null, details: error.details || null, hint: error.hint || null };
}

function assertEnvironment() {
  const url = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_configuration_missing');
  return { url, key };
}

const env = assertEnvironment();
const supabase = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });

async function mlGet(token, resource) {
  if (!resource.startsWith('/')) throw new Error('invalid_ml_get_resource');
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`ml_get_failed:${response.status}:${resource}:${body?.message || 'unknown'}`);
  return body;
}

async function loadRemote(token) {
  const item = await mlGet(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`);
  const userProduct = await mlGet(token, `/user-products/${EXPECTED.userProductId}`);
  const family = await mlGet(token, `/sites/MLB/user-products-families/${EXPECTED.familyId}`);
  return { read_at: now(), item, user_product: userProduct, family };
}

async function loadLocalState() {
  const [productResult, productBySkuResult, itemListingsResult, productListingsResult, skuListingsResult, otherProductsResult] = await Promise.all([
    supabase.from('produtos').select('*').eq('id', EXPECTED.productId).maybeSingle(),
    supabase.from('produtos').select('*').eq('sku', EXPECTED.sku).maybeSingle(),
    supabase.from('anuncios_ml').select('*').eq('ml_item_id', EXPECTED.itemId),
    supabase.from('anuncios_ml').select('*').eq('produto_id', EXPECTED.productId),
    supabase.from('anuncios_ml').select('*').eq('sku', EXPECTED.sku),
    supabase.from('produtos').select('id,sku,ml_item_id,ml_status').eq('ml_item_id', EXPECTED.itemId),
  ]);
  const error = [productResult, productBySkuResult, itemListingsResult, productListingsResult, skuListingsResult, otherProductsResult]
    .map((result) => result.error).find(Boolean);
  if (error) throw new Error(`local_read_failed:${error.message}`);
  return {
    read_at: now(),
    product: productResult.data,
    product_by_sku: productBySkuResult.data,
    item_listings: itemListingsResult.data || [],
    product_listings: productListingsResult.data || [],
    sku_listings: skuListingsResult.data || [],
    products_pointing_to_item: otherProductsResult.data || [],
  };
}

function stateForClassifier(local) {
  return {
    product: local.product,
    productBySku: local.product_by_sku,
    itemListings: local.item_listings,
    productListings: local.product_listings,
    skuListings: local.sku_listings,
    otherProducts: local.products_pointing_to_item,
  };
}

function relevantProductSnapshot(product) {
  if (!product) return null;
  return {
    id: product.id,
    sku: product.sku,
    nome: product.nome,
    gtin: product.gtin,
    ml_item_id: product.ml_item_id,
    ml_status: product.ml_status,
    ativo: product.ativo,
    estoque: product.estoque,
    custo: product.custo,
    fornecedor: product.fornecedor,
    updated_at: product.updated_at,
  };
}

function emptyReports(startedAt) {
  return {
    started_at: startedAt,
    completed_at: null,
    sku: EXPECTED.sku,
    produto_id: EXPECTED.productId,
    item_id: EXPECTED.itemId,
    user_product_id: EXPECTED.userProductId,
    family_id: EXPECTED.familyId,
    result: null,
    ml_writes: 0,
    description_writes: 0,
    second_sku_actions: 0,
    local_writes: [],
    rollback: { required: false, attempted: false, succeeded: null },
    hold: HOLD,
  };
}

async function rollbackInsertedListing(listingId) {
  const deletion = await supabase.from('anuncios_ml').delete().eq('id', listingId).eq('ml_item_id', EXPECTED.itemId).select('id');
  if (deletion.error) return { succeeded: false, error: sanitizeError(deletion.error), deleted: [] };
  const verify = await supabase.from('anuncios_ml').select('id').eq('id', listingId);
  if (verify.error) return { succeeded: false, error: sanitizeError(verify.error), deleted: deletion.data || [] };
  return { succeeded: (verify.data || []).length === 0, error: null, deleted: deletion.data || [] };
}

async function main() {
  const startedAt = now();
  const previousReportPath = path.join(REPORT_DIR, 'full-report.json');
  const previousReport = fs.existsSync(previousReportPath) ? readJson(previousReportPath) : null;
  const preservePriorRemoteAbort = previousReport?.result === 'LOCAL_PERSIST_ABORT_REMOTE_DRIFT';
  const report = emptyReports(startedAt);
  let insertedListing = null;
  let preLocal = null;
  let remoteBefore = null;

  try {
    const priorSummary = readJson(PHASE4B2_SUMMARY);
    const priorReadback = readJson(PHASE4B2_READBACK);
    if (priorSummary.result !== 'CANARY_SUCCESS' || priorSummary.item_id !== EXPECTED.itemId) {
      throw new Error('phase4b2_success_evidence_missing');
    }

    const integrationResult = await supabase.from('integracoes').select('access_token,conectado').eq('tipo', 'mercadolivre').maybeSingle();
    if (integrationResult.error || !integrationResult.data?.conectado || !integrationResult.data?.access_token) {
      throw new Error(`ml_integration_unavailable:${integrationResult.error?.message || 'missing_token'}`);
    }

    remoteBefore = await loadRemote(integrationResult.data.access_token);
    writeJson('remote-readback.json', remoteBefore);
    const remoteValidation = validateRemoteIdentity(remoteBefore.item, remoteBefore.user_product, remoteBefore.family);
    report.remote_pre_validation = remoteValidation;
    report.remote_hash_before = remoteCommercialHash(remoteBefore.item, remoteBefore.user_product, remoteBefore.family);
    report.remote_hash_phase4b2 = remoteCommercialHash(priorReadback.item, priorReadback.user_product, priorReadback.family);
    report.remote_drift = compareStableRemoteState(
      stableRemoteCommercialState(priorReadback.item, priorReadback.user_product, priorReadback.family),
      stableRemoteCommercialState(remoteBefore.item, remoteBefore.user_product, remoteBefore.family),
    );

    preLocal = await loadLocalState();
    writeJson('pre-write-product.json', {
      captured_at: now(),
      product: relevantProductSnapshot(preLocal.product),
      product_by_sku: relevantProductSnapshot(preLocal.product_by_sku),
      no_write_yet: true,
    });
    writeJson('pre-write-listing-state.json', {
      captured_at: now(),
      item_listings: preLocal.item_listings,
      product_listings: preLocal.product_listings,
      sku_listings: preLocal.sku_listings,
      products_pointing_to_item: preLocal.products_pointing_to_item,
      no_write_yet: true,
    });
    report.local_before = {
      product: relevantProductSnapshot(preLocal.product),
      listings_for_item: preLocal.item_listings.length,
      listings_for_product: preLocal.product_listings.length,
      listings_for_sku: preLocal.sku_listings.length,
      products_pointing_to_item: preLocal.products_pointing_to_item.length,
    };

    if (remoteValidation.identityMismatch) {
      report.result = 'LOCAL_PERSIST_ABORT_IDENTITY_MISMATCH';
      return;
    }
    if (remoteValidation.commercialDrift || report.remote_hash_before !== report.remote_hash_phase4b2 || preservePriorRemoteAbort) {
      report.prior_remote_abort_preserved = preservePriorRemoteAbort;
      report.result = 'LOCAL_PERSIST_ABORT_REMOTE_DRIFT';
      return;
    }

    const classified = classifyLocalState(stateForClassifier(preLocal));
    report.prewrite_gate = classified.state;
    if (classified.state === 'IDENTITY_MISMATCH') {
      report.result = 'LOCAL_PERSIST_ABORT_IDENTITY_MISMATCH';
      return;
    }
    if (classified.state === 'CONCURRENT_LINK') {
      report.result = 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK';
      return;
    }

    if (classified.state === 'ALREADY_CONSISTENT') {
      report.result = 'LOCAL_PERSIST_ALREADY_CONSISTENT';
    } else {
      const listingPayload = buildListingPayload(remoteBefore.item);
      const listingInsert = await supabase.from('anuncios_ml').insert(listingPayload).select('*').single();
      if (listingInsert.error) {
        const concurrent = await loadLocalState();
        const currentClassification = classifyLocalState(stateForClassifier(concurrent));
        report.insert_error = sanitizeError(listingInsert.error);
        report.result = currentClassification.state === 'ALREADY_CONSISTENT'
          ? 'LOCAL_PERSIST_ALREADY_CONSISTENT'
          : 'LOCAL_PERSIST_ABORT_CONCURRENT_LINK';
        return;
      }
      insertedListing = listingInsert.data;
      report.local_writes.push({
        table: 'anuncios_ml', operation: 'INSERT', field: 'row', previous: null,
        next: { id: insertedListing.id, ...listingPayload },
      });

      const productUpdate = await supabase.from('produtos')
        .update({ ml_item_id: EXPECTED.itemId, ml_status: 'ativo' })
        .eq('id', EXPECTED.productId)
        .eq('sku', EXPECTED.sku)
        .is('ml_item_id', null)
        .eq('ml_status', 'sem_anuncio')
        .select('*');

      if (productUpdate.error || (productUpdate.data || []).length !== 1) {
        report.rollback = { required: true, attempted: true, succeeded: false };
        const rollback = await rollbackInsertedListing(insertedListing.id);
        report.rollback = { required: true, attempted: true, ...rollback };
        report.product_update_error = sanitizeError(productUpdate.error) || { message: 'conditional_product_update_affected_not_one_row' };
        report.result = 'LOCAL_PERSIST_TRANSACTION_FAILED';
        return;
      }
      report.local_writes.push({ table: 'produtos', operation: 'UPDATE', field: 'ml_item_id', previous: null, next: EXPECTED.itemId });
      report.local_writes.push({ table: 'produtos', operation: 'UPDATE', field: 'ml_status', previous: preLocal.product.ml_status, next: 'ativo' });
      report.result = 'LOCAL_PERSIST_SUCCESS';
    }

    const localAfter = await loadLocalState();
    const afterClassification = classifyLocalState(stateForClassifier(localAfter));
    const exactListings = localAfter.item_listings.filter((row) => row.produto_id === EXPECTED.productId && row.sku === EXPECTED.sku);
    const localDiff = buildLocalRemoteDiff(localAfter.product, exactListings[0], remoteBefore.item);
    writeJson('local-readback.json', { read_at: now(), local: localAfter, classification: afterClassification });
    writeJson('local-remote-diff.json', { generated_at: now(), ...localDiff });
    report.local_after = {
      product: relevantProductSnapshot(localAfter.product),
      exact_listing_count: exactListings.length,
      total_item_listing_count: localAfter.item_listings.length,
      products_pointing_to_item_count: localAfter.products_pointing_to_item.length,
      exact_listing: exactListings[0] || null,
      classification: afterClassification.state,
    };
    report.local_remote_diff = localDiff;

    const remoteAfter = await loadRemote(integrationResult.data.access_token);
    report.remote_hash_after = remoteCommercialHash(remoteAfter.item, remoteAfter.user_product, remoteAfter.family);
    report.remote_after_read_at = remoteAfter.read_at;
    report.commercial_hash_unchanged = report.remote_hash_after === report.remote_hash_before;

    const unique = afterClassification.state === 'ALREADY_CONSISTENT'
      && exactListings.length === 1
      && localAfter.item_listings.length === 1
      && localAfter.products_pointing_to_item.length === 1;
    if (!unique || localDiff.material_drift || !report.commercial_hash_unchanged) {
      report.result = 'LOCAL_PERSIST_DRIFT';
    }
  } catch (error) {
    report.unhandled_error = sanitizeError(error);
    if (insertedListing && !report.rollback.attempted) {
      report.rollback = { required: true, attempted: true, succeeded: false };
      const rollback = await rollbackInsertedListing(insertedListing.id);
      report.rollback = { required: true, attempted: true, ...rollback };
      report.result = 'LOCAL_PERSIST_TRANSACTION_FAILED';
    } else if (!report.result) {
      report.result = 'LOCAL_PERSIST_TRANSACTION_FAILED';
    }
  } finally {
    report.completed_at = now();
    report.ml_writes = 0;
    report.description_writes = 0;
    report.second_sku_actions = 0;
    report.transaction_strategy = {
      mechanism: 'postgrest_unique_guard_conditional_update_compensating_rollback',
      native_multi_table_transaction: false,
      reason: 'No existing transactional RPC and no direct PostgreSQL connection available; no migration authorized for this phase.',
    };

    if (!fs.existsSync(path.join(REPORT_DIR, 'pre-write-product.json'))) {
      writeJson('pre-write-product.json', { captured_at: now(), product: preLocal ? relevantProductSnapshot(preLocal.product) : null, write_performed: false });
    }
    if (!fs.existsSync(path.join(REPORT_DIR, 'pre-write-listing-state.json'))) {
      writeJson('pre-write-listing-state.json', { captured_at: now(), state: preLocal || null, write_performed: false });
    }
    if (!fs.existsSync(path.join(REPORT_DIR, 'remote-readback.json'))) {
      writeJson('remote-readback.json', remoteBefore || { read_at: null, error: 'remote_readback_not_completed' });
    }
    if (!fs.existsSync(path.join(REPORT_DIR, 'local-readback.json'))) {
      writeJson('local-readback.json', { read_at: null, reason: 'final_local_readback_not_reached', result: report.result });
    }
    if (!fs.existsSync(path.join(REPORT_DIR, 'local-remote-diff.json'))) {
      writeJson('local-remote-diff.json', { generated_at: now(), fields: [], material_drift: null, reason: 'final_diff_not_reached' });
    }
    writeJson('local-write-result.json', {
      started_at: startedAt,
      completed_at: report.completed_at,
      result: report.result,
      writes: report.local_writes,
      rollback: report.rollback,
      ml_writes: 0,
      description_writes: 0,
    });
    writeJson('full-report.json', report);
    writeJson('summary.json', {
      generated_at: report.completed_at,
      result: report.result,
      sku: EXPECTED.sku,
      produto_id: EXPECTED.productId,
      item_id: EXPECTED.itemId,
      user_product_id: EXPECTED.userProductId,
      family_id: EXPECTED.familyId,
      remote_status: remoteBefore?.item?.status || null,
      remote_price: remoteBefore?.item?.price ?? null,
      remote_stock: remoteBefore?.item?.available_quantity ?? null,
      remote_title: remoteBefore?.item?.title || null,
      remote_permalink: remoteBefore?.item?.permalink || null,
      local_writes: report.local_writes.length,
      remote_commercial_hash_unchanged: report.commercial_hash_unchanged ?? null,
      ml_writes: 0,
      description_writes: 0,
      hold: HOLD,
    });
    console.log(JSON.stringify({ event: 'p0_phase4b3_complete', result: report.result, item_id: EXPECTED.itemId, local_writes: report.local_writes.length, ml_writes: 0 }));
  }
}

main();
