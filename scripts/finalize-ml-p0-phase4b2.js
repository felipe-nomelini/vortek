#!/usr/bin/env node
/* Final read-only reconciliation for the already-created Phase 4B.2 canary. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { plain, sha256, validateGeneratedTitle } = require('./lib/ml-p0-phase4');

dotenv.config({ path: '.env.local', quiet: true });

const SKU = 'VTK000486';
const ITEM_ID = 'MLB7432157712';
const EXPECTED_HASH = '653cefbbb29736d4973a8099f939923efef7d196a22b005400243b5e85609792';
const SOURCE_DIR = path.resolve('reports/ml-p0-phase4');
const REPORT_DIR = path.resolve('reports/ml-p0-phase4b2');
const now = () => new Date().toISOString();

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function attribute(item, id) {
  const row = (item.attributes || []).find((entry) => entry.id === id);
  return String(row?.value_name || row?.value_id || '').trim();
}

async function get(url, token, allow404 = false) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (allow404 && response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(`get_failed:${response.status}:${url}`);
  return data;
}

async function main() {
  const payload = readJson(path.join(SOURCE_DIR, 'canary-prepublish-payload.json'));
  const payloadHash = sha256(JSON.stringify(payload));
  if (payloadHash !== EXPECTED_HASH) throw new Error('ABORT_PAYLOAD_DRIFT');
  const post = readJson(path.join(REPORT_DIR, 'canary-post-response.json'));
  if (post.http_status !== 201 || post.item_id !== ITEM_ID || post.one_post_guard?.attempts !== 1) {
    throw new Error('phase4b2_post_invariant_failed');
  }
  const { data: integration, error: integrationError } = await supabase
    .from('integracoes').select('access_token').eq('tipo', 'mercadolivre').maybeSingle();
  if (integrationError || !integration?.access_token) throw new Error(integrationError?.message || 'ml_token_missing');
  const token = integration.access_token;
  const item = await get(`https://api.mercadolibre.com/items/${ITEM_ID}?include_internal_attributes=true`, token);
  if (item.id !== ITEM_ID) throw new Error('readback_identity_mismatch');
  const userProduct = item.user_product_id
    ? await get(`https://api.mercadolibre.com/user-products/${encodeURIComponent(item.user_product_id)}`, token)
    : null;
  const familyId = item.family_id || userProduct?.family_id;
  const family = familyId
    ? await get(`https://api.mercadolibre.com/sites/MLB/user-products-families/${encodeURIComponent(familyId)}`, token)
    : null;
  const description = await get(`https://api.mercadolibre.com/items/${ITEM_ID}/description`, token, true);
  const pictureDiagnostics = [];
  for (const picture of item.pictures || []) {
    const errors = await get(`https://api.mercadolibre.com/pictures/${encodeURIComponent(picture.id)}/errors`, token, true);
    pictureDiagnostics.push({ picture_id: picture.id, status: errors === null ? 404 : 200, errors: Array.isArray(errors) ? errors : errors?.errors || [] });
  }
  const [{ data: products, error: productsError }, { data: listings, error: listingsError }] = await Promise.all([
    supabase.from('produtos').select('id,sku,ml_item_id,ml_status').eq('sku', SKU),
    supabase.from('anuncios_ml').select('id,ml_item_id,produto_id,sku').or(`sku.eq.${SKU},ml_item_id.eq.${ITEM_ID}`),
  ]);
  if (productsError || listingsError) throw new Error(productsError?.message || listingsError?.message);

  const readback = {
    read_at: now(),
    item,
    description,
    user_product: userProduct,
    family,
    picture_diagnostics: pictureDiagnostics,
  };
  writeJson(path.join(REPORT_DIR, 'canary-readback.json'), readback);

  const diff = readJson(path.join(REPORT_DIR, 'canary-diff.json'));
  const fields = new Map(diff.fields.map((row) => [row.field, row]));
  const update = (field, remote, status, material, reason) => {
    const row = fields.get(field);
    if (!row) throw new Error(`diff_field_missing:${field}`);
    row.remote = remote;
    row.status = status;
    row.material = material;
    if (reason) row.reason = reason;
    else delete row.reason;
  };
  const expectedFamily = payload.family_name;
  const remoteFamily = item.family_name || userProduct?.family_name || '';
  const familyExact = remoteFamily === expectedFamily;
  const familyNormalized = !familyExact && plain(remoteFamily) === plain(expectedFamily);
  update('family_name', remoteFamily, familyExact ? 'MATCH' : familyNormalized ? 'NORMALIZED_BY_ML' : 'DIVERGENT', !familyExact && !familyNormalized,
    familyNormalized ? 'capitalization_normalized_by_ml_without_identity_change' : null);
  const titleAnalysis = validateGeneratedTitle(item.title);
  const titleRow = fields.get('title_generated_by_ml');
  titleRow.remote = item.title;
  titleRow.analysis = titleAnalysis;
  titleRow.status = titleAnalysis.valid ? 'NORMALIZED_BY_ML' : 'DIVERGENT';
  titleRow.material = !titleAnalysis.valid;
  update('status', item.status, item.status === 'active' ? 'MATCH' : 'DIVERGENT', item.status !== 'active',
    item.status === 'active' ? 'picture_processing_completed' : null);
  update('price', Number(item.price), Number(item.price) === Number(payload.price) ? 'MATCH' : 'DIVERGENT', Number(item.price) !== Number(payload.price));
  update('available_quantity', Number(item.available_quantity), Number(item.available_quantity) === Number(payload.available_quantity) ? 'MATCH' : 'DIVERGENT', Number(item.available_quantity) !== Number(payload.available_quantity));
  update('category_id', item.category_id, item.category_id === payload.category_id ? 'MATCH' : 'DIVERGENT', item.category_id !== payload.category_id);
  update('BRAND', attribute(item, 'BRAND'), attribute(item, 'BRAND') === 'Toshiba' ? 'MATCH' : 'DIVERGENT', attribute(item, 'BRAND') !== 'Toshiba');
  update('MODEL', attribute(item, 'MODEL'), attribute(item, 'MODEL') === 'TNHC-6GAE4 CB' ? 'MATCH' : 'DIVERGENT', attribute(item, 'MODEL') !== 'TNHC-6GAE4 CB');
  update('PRODUCT_TYPE', attribute(item, 'PRODUCT_TYPE'), attribute(item, 'PRODUCT_TYPE') === 'Pilha' ? 'MATCH' : 'DIVERGENT', attribute(item, 'PRODUCT_TYPE') !== 'Pilha');
  update('pictures_count', (item.pictures || []).length, (item.pictures || []).length === payload.pictures.length ? 'NORMALIZED_BY_ML' : 'DIVERGENT', (item.pictures || []).length !== payload.pictures.length,
    (item.pictures || []).length === payload.pictures.length ? 'source_urls_ingested_and_rehosted_by_ml' : null);
  diff.generated_at = now();
  diff.fields = [...fields.values()];
  diff.picture_processing = {
    pending: (item.pictures || []).filter((picture) => String(picture.secure_url || picture.url || '').includes('processing-image')).length,
    diagnostics_with_errors: pictureDiagnostics.filter((row) => row.errors.length).length,
    status: item.status,
    sub_status: item.sub_status || [],
  };
  diff.material_drift = diff.fields.some((row) => row.material && ['DIVERGENT', 'MISSING'].includes(row.status))
    || diff.picture_processing.pending > 0 || diff.picture_processing.diagnostics_with_errors > 0;
  writeJson(path.join(REPORT_DIR, 'canary-diff.json'), diff);

  const full = readJson(path.join(REPORT_DIR, 'full-report.json'));
  const result = diff.material_drift ? 'CANARY_POST_DRIFT' : 'CANARY_SUCCESS';
  full.phase4b2 = {
    ...full.phase4b2,
    completed_at: now(),
    result,
    readback,
    diff,
    local_persistence: {
      performed: false,
      authorized: false,
      product_ml_item_id: products[0]?.ml_item_id || null,
      local_listing_count: listings.length,
      concurrent_drift: Boolean(products[0]?.ml_item_id) || listings.length > 0,
      reason: diff.material_drift ? 'material_remote_drift' : 'phase4b2_hold_requires_human_link_authorization',
      proposal: diff.material_drift ? null : {
        produto_id: products[0]?.id || null,
        sku: SKU,
        ml_item_id: ITEM_ID,
        ml_status: 'ativo',
        anuncio_status: 'ativo',
        preco_ml: Number(item.price),
        tipo: item.listing_type_id === 'gold_pro' ? 'premium' : item.listing_type_id,
        catalogo: item.catalog_listing === true,
      },
    },
    post_readback_followup: {
      performed_at: now(),
      external_writes: 0,
      supabase_writes: 0,
      item_gets: 1,
      user_product_gets: userProduct ? 1 : 0,
      family_gets: family ? 1 : 0,
      description_gets: 1,
      picture_diagnostic_gets: pictureDiagnostics.length,
    },
    hold: 'P0 PHASE 4B.2 — DIURNAL RETEST HOLD',
  };
  writeJson(path.join(REPORT_DIR, 'full-report.json'), full);
  writeJson(path.join(REPORT_DIR, 'summary.json'), {
    generated_at: now(),
    result,
    payload_sha256: payloadHash,
    item_id: item.id,
    user_product_id: item.user_product_id,
    family_id: familyId,
    family_name: remoteFamily,
    title: item.title,
    status: item.status,
    sub_status: item.sub_status || [],
    permalink: item.permalink,
    pictures_total: (item.pictures || []).length,
    pictures_pending: diff.picture_processing.pending,
    material_drift: diff.material_drift,
    local_persistence_performed: false,
    ml_item_post_attempts: post.one_post_guard.attempts,
    ml_item_posts_successful: post.one_post_guard.successful,
    hold: 'P0 PHASE 4B.2 — DIURNAL RETEST HOLD',
  });
  console.log(JSON.stringify({ event: 'p0_phase4b2_finalized', result, item_id: item.id, status: item.status, material_drift: diff.material_drift, local_persistence: false }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'p0_phase4b2_finalize_failed', error: error.message, timestamp: now() }));
  process.exitCode = 1;
});
