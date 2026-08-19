#!/usr/bin/env node
/* Phase 4C: one controlled description POST for the single authorized canary. */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
  EXPECTED,
  compareStableRemoteState,
  stableRemoteCommercialState,
  validateRemoteIdentity,
} = require('./lib/ml-p0-phase4b3');
const {
  DESCRIPTION,
  classifyWrite,
  compareDescription,
  sha256,
  validateDescription,
} = require('./lib/ml-p0-phase4c');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-p0-phase4c');
const PHASE4B3_REPORT = path.resolve('reports/ml-p0-phase4b3/full-report.json');
const PHASE4B31_SUMMARY = path.resolve('reports/ml-p0-phase4b31/summary.json');
const DESCRIPTION_RESOURCE = `/items/${EXPECTED.itemId}/description`;
const DESCRIPTION_ENDPOINT = `https://api.mercadolibre.com${DESCRIPTION_RESOURCE}`;
const HOLD = 'P0 PHASE 4C — DESCRIPTION HOLD';
const now = () => new Date().toISOString();

fs.mkdirSync(REPORT_DIR, { recursive: true });

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function headerObject(headers) {
  return Object.fromEntries([...headers.entries()].filter(([name]) => !name.toLowerCase().includes('token')));
}

function requestId(headers) {
  return headers.get('x-request-id') || headers.get('x-correlation-id') || headers.get('x-amzn-trace-id') || null;
}

async function mlRequest(token, resource, options = {}) {
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  return { status: response.status, ok: response.ok, headers: headerObject(response.headers), request_id: requestId(response.headers), body };
}

async function requireMlGet(token, resource) {
  const result = await mlRequest(token, resource);
  if (!result.ok) throw new Error(`ml_get_failed:${result.status}:${resource}:${result.body?.message || 'unknown'}`);
  return result.body;
}

async function loadRemote(token) {
  const [item, userProduct, family] = await Promise.all([
    requireMlGet(token, `/items/${EXPECTED.itemId}?include_internal_attributes=true`),
    requireMlGet(token, `/user-products/${EXPECTED.userProductId}`),
    requireMlGet(token, `/sites/MLB/user-products-families/${EXPECTED.familyId}`),
  ]);
  return { read_at: now(), item, user_product: userProduct, family };
}

async function loadLocalGate(supabase) {
  const [product, listings, otherProducts] = await Promise.all([
    supabase.from('produtos').select('id,sku,gtin,ml_item_id,ml_status').eq('id', EXPECTED.productId).maybeSingle(),
    supabase.from('anuncios_ml').select('id,ml_item_id,produto_id,sku,titulo,tipo,preco_ml,status,catalogo,permalink').eq('ml_item_id', EXPECTED.itemId),
    supabase.from('produtos').select('id,sku,ml_item_id').eq('ml_item_id', EXPECTED.itemId),
  ]);
  const error = [product, listings, otherProducts].map((row) => row.error).find(Boolean);
  if (error) throw new Error(`local_gate_read_failed:${error.message}`);
  return { product: product.data, listings: listings.data || [], products_pointing_to_item: otherProducts.data || [] };
}

function localGateValid(local) {
  const listing = local.listings[0];
  return local.product?.id === EXPECTED.productId
    && local.product?.sku === EXPECTED.sku
    && local.product?.gtin === EXPECTED.gtin
    && local.product?.ml_item_id === EXPECTED.itemId
    && local.listings.length === 1
    && listing?.produto_id === EXPECTED.productId
    && listing?.sku === EXPECTED.sku
    && local.products_pointing_to_item.length === 1
    && local.products_pointing_to_item[0]?.id === EXPECTED.productId;
}

function emptyOutput(reason, result) {
  return { generated_at: now(), result, reason, not_reached: true };
}

async function main() {
  const startedAt = now();
  const report = {
    phase: '4C', mode: 'CONTROLLED_EXECUTION', started_at: startedAt, completed_at: null,
    sku: EXPECTED.sku, item_id: EXPECTED.itemId, user_product_id: EXPECTED.userProductId,
    family_id: EXPECTED.familyId, result: null, write_result: null,
    description_write_attempts: 0, mercado_livre_commercial_writes: 0, supabase_writes: 0,
    second_sku_actions: 0, hold: HOLD,
  };
  let payloadReport = null;
  let postReport = null;
  let descriptionReadback = null;
  let descriptionDiff = null;
  let commercialReadback = null;

  try {
    const phase4b3 = readJson(PHASE4B3_REPORT);
    const phase4b31 = readJson(PHASE4B31_SUMMARY);
    if (phase4b3.result !== 'LOCAL_PERSIST_SUCCESS' || phase4b31.classification !== 'REMOTE_NORMALIZATION_ACCEPTABLE') {
      throw new Error('prior_phase_evidence_not_approved');
    }
    const referenceRemote = phase4b3.remote_after;
    if (!referenceRemote?.item) throw new Error('phase4b3_remote_reference_missing');

    const supabaseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) throw new Error('supabase_service_configuration_missing');
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [integrationResult, local] = await Promise.all([
      supabase.from('integracoes').select('access_token,conectado').eq('tipo', 'mercadolivre').maybeSingle(),
      loadLocalGate(supabase),
    ]);
    if (integrationResult.error || !integrationResult.data?.conectado || !integrationResult.data?.access_token) {
      throw new Error(`ml_integration_unavailable:${integrationResult.error?.message || 'missing_token'}`);
    }
    if (!localGateValid(local)) {
      report.result = 'DESCRIPTION_ABORT_REMOTE_DRIFT';
      report.local_gate = { result: 'DIVERGENT', local };
      return;
    }
    report.local_gate = { result: 'MATCH', product: local.product, listing: local.listings[0] };
    const token = integrationResult.data.access_token;

    const before = await loadRemote(token);
    const identity = validateRemoteIdentity(before.item, before.user_product, before.family);
    const commercialBefore = stableRemoteCommercialState(before.item, before.user_product, before.family);
    const referenceState = stableRemoteCommercialState(referenceRemote.item, referenceRemote.user_product, referenceRemote.family);
    const referenceDrift = compareStableRemoteState(referenceState, commercialBefore);
    report.pre_description_gate = { identity, reference_drift: referenceDrift };
    if (identity.identityMismatch || identity.commercialDrift || referenceDrift.drift) {
      report.result = 'DESCRIPTION_ABORT_REMOTE_DRIFT';
      return;
    }

    const existingDescription = await mlRequest(token, DESCRIPTION_RESOURCE);
    report.description_before = {
      http_status: existingDescription.status,
      body: existingDescription.body,
      absent: existingDescription.status === 404 || !String(existingDescription.body?.plain_text || '').trim(),
    };
    if (!report.description_before.absent) {
      report.result = 'DESCRIPTION_ABORT_REMOTE_DRIFT';
      return;
    }

    const contentValidation = validateDescription(DESCRIPTION);
    if (!contentValidation.valid) throw new Error(`description_content_invalid:${contentValidation.failures.join(',')}`);
    const exactPayload = { plain_text: DESCRIPTION };
    payloadReport = {
      generated_at: now(), method: 'POST', endpoint: DESCRIPTION_ENDPOINT,
      contract: 'create_missing_item_description', payload: exactPayload,
      payload_sha256: sha256(JSON.stringify(exactPayload)), content_validation: contentValidation,
      write_limit: 1, fallback: false, retry: false,
      evidence: [
        { source: 'manufacturer', url: 'https://www.toshibaenergia.com.br/carregador-de-pilha-com-4-pilhas-TNHC-6GAE4-aa-aaa-toshiba', supports: ['brand', 'model', 'AA/AAA', 'Ni-MH', 'four_simultaneous_cells', 'four_AA_2600mAh', 'not_9V'] },
        { source: 'manufacturer_label', url: 'https://static.hayapek.com.br/produtos/74810/550/9.jpg', supports: ['input_100_240V', '50_60Hz', '6W'] },
        { source: 'manufacturer_manual', url: 'https://www.toshibaenergia.com.br/uploads/downloads/Manual_Toshiba_Carregador_TNHC-6GAE4_CB.pdf', supports: ['manual_in_package', 'usage_and_charge_safety'] },
      ],
    };
    writeJson('description-payload.json', payloadReport);

    report.description_write_attempts = 1;
    const postedAt = now();
    const post = await mlRequest(token, DESCRIPTION_RESOURCE, { method: 'POST', body: exactPayload });
    postReport = {
      attempted_at: postedAt, completed_at: now(), method: 'POST', endpoint: DESCRIPTION_ENDPOINT,
      payload_sha256: payloadReport.payload_sha256, http_status: post.status,
      request_id: post.request_id, headers: post.headers, response_body: post.body,
      classification: classifyWrite(post.status), write_attempt_number: 1,
      retry_performed: false, fallback_performed: false,
    };
    report.write_result = postReport.classification;
    if (!post.ok) {
      report.result = 'DESCRIPTION_POST_FAILED';
      return;
    }

    const [descriptionAfter, after] = await Promise.all([
      mlRequest(token, DESCRIPTION_RESOURCE),
      loadRemote(token),
    ]);
    if (!descriptionAfter.ok) throw new Error(`description_readback_failed:${descriptionAfter.status}`);
    descriptionReadback = {
      read_at: now(), endpoint: DESCRIPTION_ENDPOINT, http_status: descriptionAfter.status,
      item_id: EXPECTED.itemId, plain_text: descriptionAfter.body?.plain_text || '',
      last_updated: descriptionAfter.body?.last_updated || null,
      date_created: descriptionAfter.body?.date_created || null,
      response_body: descriptionAfter.body,
    };
    descriptionDiff = {
      generated_at: now(), sent_sha256: sha256(DESCRIPTION), remote_sha256: sha256(descriptionReadback.plain_text),
      sent_characters: DESCRIPTION.length, remote_characters: descriptionReadback.plain_text.length,
      ...compareDescription(DESCRIPTION, descriptionReadback.plain_text),
    };

    const commercialAfter = stableRemoteCommercialState(after.item, after.user_product, after.family);
    const commercialDiff = compareStableRemoteState(commercialBefore, commercialAfter);
    commercialReadback = {
      read_at: after.read_at, before: commercialBefore, after: commercialAfter,
      diff: commercialDiff, side_effect_drift: commercialDiff.drift,
    };
    if (commercialDiff.drift) report.result = 'DESCRIPTION_SIDE_EFFECT_DRIFT';
    else if (descriptionDiff.material_drift) report.result = 'DESCRIPTION_TEXT_DRIFT';
    else report.result = descriptionDiff.result === 'MATCH' ? 'DESCRIPTION_SUCCESS' : 'DESCRIPTION_SUCCESS_NORMALIZED';
  } catch (error) {
    report.error = { message: error.message, code: error.code || null };
    if (!report.result) report.result = 'DESCRIPTION_POST_FAILED';
  } finally {
    report.completed_at = now();
    writeJson('description-payload.json', payloadReport || emptyOutput('payload_not_reached', report.result));
    writeJson('description-post-response.json', postReport || emptyOutput('write_not_attempted', report.result));
    writeJson('description-readback.json', descriptionReadback || emptyOutput('readback_not_reached', report.result));
    writeJson('description-diff.json', descriptionDiff || emptyOutput('diff_not_reached', report.result));
    writeJson('commercial-readback.json', commercialReadback || emptyOutput('commercial_post_readback_not_reached', report.result));
    writeJson('full-report.json', report);
    writeJson('summary.json', {
      generated_at: report.completed_at, result: report.result, write_result: report.write_result,
      sku: EXPECTED.sku, item_id: EXPECTED.itemId, endpoint: DESCRIPTION_ENDPOINT,
      http_status: postReport?.http_status ?? null, request_id: postReport?.request_id ?? null,
      description_diff: descriptionDiff?.result || null,
      commercial_side_effect_drift: commercialReadback?.side_effect_drift ?? null,
      final_remote_status: commercialReadback?.after?.status || null,
      final_remote_price: commercialReadback?.after?.price ?? null,
      final_remote_stock: commercialReadback?.after?.available_quantity ?? null,
      description_write_attempts: report.description_write_attempts,
      mercado_livre_commercial_writes: 0, supabase_writes: 0, second_sku_actions: 0, hold: HOLD,
    });
    console.log(JSON.stringify({ event: 'p0_phase4c_complete', result: report.result, http_status: postReport?.http_status || null, request_id: postReport?.request_id || null, description_writes: report.description_write_attempts }));
  }
}

main();
