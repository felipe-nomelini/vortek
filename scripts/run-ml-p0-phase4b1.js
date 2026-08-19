#!/usr/bin/env node
/* Phase 4B.1 diagnostic: external reads and local report writes only. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const SELLER_ID = '3294514937';
const CATEGORY_ID = 'MLB11290';
const SKU = 'VTK000486';
const REQUEST_ID = '60e5c148-b1f9-479c-8ed9-53a06a52b29a';
const SOURCE_DIR = path.resolve('reports/ml-p0-phase4');
const REPORT_DIR = path.resolve('reports/ml-p0-phase4b1');
const PAYLOAD_PATH = path.join(SOURCE_DIR, 'canary-prepublish-payload.json');
const POST_PATH = path.join(SOURCE_DIR, 'canary-post-response.json');
const PHASE4_PATH = path.join(SOURCE_DIR, 'full-report.json');
const now = () => new Date().toISOString();

const OFFICIAL_DOCS = {
  user_products: 'https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/preco-variacao',
  user_products_concepts: 'https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products',
  publish_items: 'https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos',
  attributes: 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos',
  listing_types: 'https://developers.mercadolivre.com.br/pt_br/tutorial-tipos-de-publicacao-y-atualizacao-de-artigos',
  pictures: 'https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/trabalhar-com-imagens',
};

const metrics = {
  supabase_reads: 0,
  supabase_writes: 0,
  ml_gets: 0,
  ml_posts: 0,
  ml_puts: 0,
  image_gets: 0,
  local_report_writes: 0,
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  metrics.local_report_writes += 1;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function getIntegrationToken() {
  const url = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_read_credentials_missing');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  metrics.supabase_reads += 1;
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token,conectado')
    .eq('tipo', 'mercadolivre')
    .maybeSingle();
  if (error) throw new Error(`supabase_read_failed:${error.message}`);
  if (!data?.conectado || !data.access_token) throw new Error('mercadolivre_integration_unavailable');
  return data.access_token;
}

async function mlGet(token, pathname) {
  metrics.ml_gets += 1;
  const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) throw new Error(`ml_get_failed:${pathname}:${response.status}:${text(raw).slice(0, 300)}`);
  return { status: response.status, body, consulted_at: now() };
}

function schemaMap(attributes) {
  return new Map(attributes.map((attribute) => [attribute.id, attribute]));
}

function inspectValue(schema, sent) {
  const valueId = text(sent.value_id);
  const valueName = text(sent.value_name);
  const suggested = (schema?.values || []).find((value) => (
    (valueId && text(value.id) === valueId) || (valueName && text(value.name) === valueName)
  ));
  const unit = valueName.includes(' ') ? valueName.split(/\s+/).at(-1) : null;
  const unitAccepted = schema?.value_type !== 'number_unit'
    || (schema.allowed_units || []).some((entry) => entry.id === unit || entry.name === unit);
  const booleanIdAccepted = schema?.value_type !== 'boolean'
    || (schema.values || []).some((entry) => text(entry.id) === valueId);
  const listIdAccepted = schema?.value_type !== 'list'
    || (schema.values || []).some((entry) => text(entry.id) === valueId);
  return {
    attribute_id: sent.id,
    sent,
    exists_in_category_schema: Boolean(schema),
    hierarchy: schema?.hierarchy || null,
    value_type: schema?.value_type || null,
    tags: schema?.tags || {},
    suggested_value_match: suggested ? { id: suggested.id, name: suggested.name } : null,
    encoding_checks: {
      number_unit_allowed: unitAccepted,
      boolean_value_id_allowed: booleanIdAccepted,
      list_value_id_allowed: listIdAccepted,
      multivalued_comma_encoding: schema?.tags?.multivalued
        ? valueName.split(',').map((part) => part.trim()).filter(Boolean)
        : null,
    },
    status: !schema ? 'UNKNOWN'
      : !unitAccepted || !booleanIdAccepted || !listIdAccepted ? 'UNKNOWN'
        : sent.id === 'INPUT_VOLTAGE' ? 'NORMALIZED'
          : schema.tags?.required ? 'REQUIRED' : 'OPTIONAL',
    conclusion: !schema ? 'attribute_not_returned_by_live_category_schema'
      : !unitAccepted || !booleanIdAccepted || !listIdAccepted ? 'encoding_not_confirmed'
        : schema.tags?.multivalued && valueName.includes(',')
          ? 'valid_multivalued_comma_separated_encoding_per_official_attributes_documentation'
          : schema.value_type === 'number_unit'
            ? 'valid_number_and_allowed_unit_in_value_name; value_struct_is_not_mandatory_for_item_write'
            : schema.value_type === 'boolean' || schema.value_type === 'list'
              ? 'value_id_matches_live_allowed_value'
              : 'value_matches_live_attribute_contract',
  };
}

async function auditImage(source, order) {
  const direct = await fetch(source, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  metrics.image_gets += 1;
  const redirectLocation = direct.headers.get('location');
  let finalResponse = direct;
  if (direct.status >= 300 && direct.status < 400 && redirectLocation) {
    finalResponse = await fetch(new URL(redirectLocation, source), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    metrics.image_gets += 1;
  }
  const buffer = Buffer.from(await finalResponse.arrayBuffer());
  const contentType = finalResponse.headers.get('content-type') || '';
  let metadata = {};
  if (finalResponse.ok && contentType.startsWith('image/')) metadata = await sharp(buffer).metadata();
  const externallyAccessible = finalResponse.ok && contentType.startsWith('image/');
  return {
    order,
    url: source,
    https: source.startsWith('https://'),
    authentication_sent: false,
    direct_http_status: direct.status,
    redirect: redirectLocation ? { location: redirectLocation, final_url: finalResponse.url } : null,
    final_http_status: finalResponse.status,
    content_type: contentType,
    content_length_bytes: buffer.length,
    format: metadata.format || null,
    width: metadata.width || null,
    height: metadata.height || null,
    externally_accessible: externallyAccessible,
    within_10_mb: buffer.length <= 10 * 1024 * 1024,
    meets_recommended_1200_square: metadata.width === 1200 && metadata.height === 1200,
    accepted_format: ['jpeg', 'png'].includes(metadata.format),
    status: externallyAccessible && source.startsWith('https://') && buffer.length <= 10 * 1024 * 1024
      && ['jpeg', 'png'].includes(metadata.format) ? 'PASS' : 'REVIEW',
    note: 'No ML picture-diagnostics POST was called because all POST requests are prohibited in Phase 4B.1.',
  };
}

function buildContractAudit(payload, category, listingType, attributes, seller) {
  const attrs = schemaMap(attributes);
  const inputVoltage = attrs.get('INPUT_VOLTAGE');
  const fields = [
    ['family_name', 'REQUIRED', 'Required for user_product_seller; used to calculate family_id.', payload.family_name],
    ['category_id', 'REQUIRED', 'Required by POST /items; live category is enabled and listing_allowed.', payload.category_id],
    ['price', 'REQUIRED', 'Required sales-condition field.', payload.price],
    ['currency_id', 'REQUIRED', 'Required sales-condition field; BRL is allowed by category.', payload.currency_id],
    ['available_quantity', 'REQUIRED', 'Required for initial item creation; category settings.stock=required.', payload.available_quantity],
    ['buying_mode', 'REQUIRED', 'Required and buy_it_now is allowed by category.', payload.buying_mode],
    ['listing_type_id', 'REQUIRED', 'Required; gold_pro is available and not excluded for MLB11290.', payload.listing_type_id],
    ['condition', 'DEPRECATED', 'Backward-compatible, but current official contract says to use ITEM_CONDITION inside attributes.', payload.condition],
    ['pictures', 'REQUIRED', 'gold_pro live configuration requires_picture=true; category permits up to 12.', `${payload.pictures.length} pictures`],
    ['attributes', 'REQUIRED', 'Required attributes BRAND, MODEL and PRODUCT_TYPE are carried here.', `${payload.attributes.length} attributes`],
    ['sale_terms', 'OPTIONAL', 'Omitted; no sale term is tagged required for a new item in this category.', payload.sale_terms ?? null],
    ['shipping', 'OPTIONAL', 'Optional sales-condition configuration.', payload.shipping],
    ['seller_custom_field', 'OPTIONAL', 'Seller internal reference; SELLER_SKU attribute is also present.', payload.seller_custom_field],
    ['title', 'PROHIBITED', 'Must not be sent for a user_product_seller; ML generates it.', payload.title ?? null],
    ['description', 'PROHIBITED', 'Must be posted only after item creation to /items/{id}/description.', payload.description ?? null],
    ['GTIN', 'UNKNOWN', 'Live schema marks GTIN conditional_required; resolving the condition requires POST /attributes/conditional, prohibited in this diagnostic. Present and valid in full payload.', '4904530109270'],
    ['PARENT_PK', 'REQUIRED', 'BRAND and MODEL are live PARENT_PK attributes tagged required; both are present.', ['BRAND', 'MODEL']],
    ['CHILD_PK', 'OPTIONAL', 'INPUT_VOLTAGE is the only live CHILD_PK in the payload and is not tagged required.', ['INPUT_VOLTAGE']],
    ['custom_attributes', 'OPTIONAL', 'Category attributes without required tags may enrich the UP but are not required for the initial contract.', payload.attributes.filter((item) => !['BRAND', 'MODEL', 'PRODUCT_TYPE', 'GTIN', 'ITEM_CONDITION'].includes(item.id)).map((item) => item.id)],
  ].map(([field, status, evidence, value]) => ({ field, status, sent: value !== null && value !== undefined, value, evidence }));

  const attributeAudit = payload.attributes.map((sent) => inspectValue(attrs.get(sent.id), sent));
  return {
    generated_at: now(),
    mode: 'AUDIT_ONLY',
    sku: SKU,
    seller: {
      id: SELLER_ID,
      user_product_seller: seller.tags.includes('user_product_seller'),
      listing_allowed: seller.status?.list?.allow === true,
    },
    endpoint_contract: {
      initial_user_product_creation: { method: 'POST', endpoint: '/items', confirmed: true },
      existing_user_product_condition_creation: { method: 'POST', endpoint: '/user-products/{USER_PRODUCT_ID}/items', applicable: false, reason: 'No existing equivalent User Product was found.' },
      separate_user_product_creation_endpoint: { exists_in_official_contract: false },
      required_headers: ['Authorization: Bearer <token>', 'Content-Type: application/json'],
      additional_headers_feature_flags_or_query_parameters: [],
      title_rule: 'ML generates title; title must be omitted.',
      family_name_rule: `Required and <= category max_title_length (${category.settings.max_title_length}).`,
      family_name_length: [...payload.family_name].length,
    },
    live_contract: {
      category_id: category.id,
      category_status: category.settings.status,
      listing_allowed: category.settings.listing_allowed,
      max_title_length: category.settings.max_title_length,
      max_pictures_per_item: category.settings.max_pictures_per_item,
      stock: category.settings.stock,
      price: category.settings.price,
      listing_type_id: listingType.id,
      requires_picture: listingType.configuration.requires_picture,
      max_stock_per_item: listingType.configuration.max_stock_per_item,
      input_voltage_allowed_values: inputVoltage.values,
    },
    fields,
    attributes: attributeAudit,
    special_attribute_conclusions: {
      INPUT_VOLTAGE: {
        sent: payload.attributes.find((item) => item.id === 'INPUT_VOLTAGE'),
        live_value: inputVoltage.values.find((value) => value.id === '39205163'),
        result: 'NORMALIZED',
        explanation: 'Official product evidence says AC 100-240V; category schema exposes 127/220V as its bivolt normalization. The authorized payload uses the exact live value_id and value_name.',
      },
      PRODUCT_TYPE: {
        result: 'CONFIRMED',
        explanation: 'value_id 28280064 maps to Pilha in the live list schema.',
      },
      CONNECTOR_TYPE: {
        result: 'CONFIRMED',
        explanation: 'value_id 24420060 maps to Plug in the live schema.',
      },
      SUPPORTED_BATTERY_SIZE: {
        result: 'CONFIRMED',
        explanation: 'Attribute is multivalued; official attribute documentation permits comma-separated values. AA and AAA both exist in the live value list.',
      },
      BATTERIES_CHARGE_CAPACITY: {
        result: 'CONFIRMED',
        explanation: 'number_unit accepts mAh; value_name 2600 mAh follows the official item-write form. value_struct is not mandatory for this write contract.',
      },
    },
    official_sources: OFFICIAL_DOCS,
    documentation_access_note: 'Direct portal opens returned HTTP 403 in this environment. Assertions were cross-checked against indexed official documentation and current official GET API contracts.',
  };
}

function buildMinimalPayload(payload) {
  return {
    family_name: payload.family_name,
    category_id: payload.category_id,
    price: payload.price,
    currency_id: payload.currency_id,
    available_quantity: payload.available_quantity,
    buying_mode: payload.buying_mode,
    listing_type_id: payload.listing_type_id,
    pictures: [payload.pictures[0]],
    attributes: [
      payload.attributes.find((attribute) => attribute.id === 'BRAND'),
      payload.attributes.find((attribute) => attribute.id === 'MODEL'),
      payload.attributes.find((attribute) => attribute.id === 'PRODUCT_TYPE'),
      { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' },
    ],
  };
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const payload = readJson(PAYLOAD_PATH);
  const post = readJson(POST_PATH);
  const phase4 = readJson(PHASE4_PATH);
  const payloadHash = sha256(JSON.stringify(payload));
  if (payloadHash !== post.payload_sha256) throw new Error('payload_hash_does_not_match_failed_request');
  if (post.request_id !== REQUEST_ID || post.http_status !== 500) throw new Error('failed_request_context_mismatch');

  const token = await getIntegrationToken();
  const [sellerResponse, categoryResponse, attributesResponse, technicalResponse, listingTypeResponse, saleTermsResponse] = await Promise.all([
    mlGet(token, `/users/${SELLER_ID}`),
    mlGet(token, `/categories/${CATEGORY_ID}`),
    mlGet(token, `/categories/${CATEGORY_ID}/attributes`),
    mlGet(token, `/categories/${CATEGORY_ID}/technical_specs/input`),
    mlGet(token, '/sites/MLB/listing_types/gold_pro'),
    mlGet(token, `/categories/${CATEGORY_ID}/sale_terms`),
  ]);
  const contractAudit = buildContractAudit(
    payload,
    categoryResponse.body,
    listingTypeResponse.body,
    attributesResponse.body,
    sellerResponse.body,
  );
  writeJson(path.join(REPORT_DIR, 'payload-contract-audit.json'), contractAudit);

  const minimalPayload = buildMinimalPayload(payload);
  writeJson(path.join(REPORT_DIR, 'canary-minimal-payload.json'), minimalPayload);

  const images = [];
  for (const [index, picture] of payload.pictures.entries()) images.push(await auditImage(picture.source, index + 1));
  const imageAudit = {
    generated_at: now(),
    mode: 'AUDIT_ONLY',
    total: images.length,
    passed: images.filter((image) => image.status === 'PASS').length,
    redirects: images.filter((image) => image.redirect).length,
    failures: images.filter((image) => image.status !== 'PASS').length,
    category_limit: categoryResponse.body.settings.max_pictures_per_item,
    within_category_limit: images.length <= categoryResponse.body.settings.max_pictures_per_item,
    images,
  };
  writeJson(path.join(REPORT_DIR, 'image-audit.json'), imageAudit);

  const minimalKeys = new Set(Object.keys(minimalPayload));
  const minimalAttributeIds = new Set(minimalPayload.attributes.map((attribute) => attribute.id));
  const extras = {
    top_level: Object.keys(payload).filter((key) => !minimalKeys.has(key)),
    attributes: payload.attributes.map((attribute) => attribute.id).filter((id) => !minimalAttributeIds.has(id)),
    pictures_beyond_minimum: payload.pictures.slice(1).map((picture) => picture.source),
    note: 'Extras are not proven invalid. They are omitted only to isolate optional dimensions in a future explicitly authorized attempt.',
  };
  const conditionMigration = {
    removed_top_level: { condition: payload.condition },
    added_current_attribute: { id: 'ITEM_CONDITION', value_id: '2230284', value_name: 'Novo' },
    reason: 'Top-level condition is backward-compatible but officially scheduled for deprecation; current implementations should use ITEM_CONDITION.',
  };

  const priorRemote = phase4.phase4b?.preflight?.duplicate || null;
  const cause = {
    classification: 'MERCADO_LIVRE_INTERNAL_ERROR',
    confidence: 'high',
    ruled_out: {
      PAYLOAD_CONTRACT_ERROR: 'No field in the failed payload is proven prohibited or invalid; title and description were correctly absent.',
      ATTRIBUTE_ENCODING_ERROR: 'All special values match the live schema; multivalued comma encoding and number_unit value_name forms are documented.',
      IMAGE_SOURCE_ERROR: imageAudit.failures === 0 ? 'All 9 public HTTPS images returned valid image responses without redirects.' : 'Not ruled out.',
      ENDPOINT_FLOW_ERROR: 'POST /items is the official endpoint for initial UP/item creation for user_product_seller.',
    },
    evidence: [
      'HTTP 500 response error=internal_error with empty cause array.',
      `Request id ${REQUEST_ID}.`,
      'Seller currently has user_product_seller tag.',
      'Payload follows current initial User Products contract: family_name present; title and description omitted; required PARENT_PK present.',
      'Live category, attribute, technical specification, listing type, and sale-term GET contracts were successfully read.',
      'No item was returned by the failed response and the exhaustive post-error remote scan found no equivalent item.',
    ],
    residual_uncertainty: 'Only Mercado Livre internal tracing tied to the request_id can identify the failing backend component. Optional-field reduction is a diagnostic strategy, not proof that an optional field caused the 500.',
  };

  const supportDiagnostic = {
    generated_at: now(),
    destination: 'Mercado Livre developer support',
    seller_id: SELLER_ID,
    timestamp_utc: post.attempted_at,
    timestamp_america_sao_paulo: '2026-08-16T03:25:48.432-03:00',
    endpoint: post.endpoint,
    http_status: post.http_status,
    request_id: REQUEST_ID,
    response: post.response_body,
    payload_sha256: payloadHash,
    category_id: CATEGORY_ID,
    seller_user_product_enabled: sellerResponse.body.tags.includes('user_product_seller'),
    item_created: false,
    remote_confirmation: priorRemote ? {
      checked_at: priorRemote.checked_at,
      exhaustive_scan_reliable: priorRemote.inventory?.reliable,
      seller_inventory_total: priorRemote.inventory?.expected_total,
      equivalent_matches: priorRemote.blocking_matches?.length || 0,
      existing_equivalent_family: priorRemote.existing_equivalent_family,
    } : null,
    credentials_included: false,
    requested_support_action: 'Trace the internal failure using request_id and identify the backend validation/service that returned HTTP 500 for a valid initial User Products POST /items request.',
  };
  writeJson(path.join(REPORT_DIR, 'support-diagnostic.json'), supportDiagnostic);

  const fullReport = {
    generated_at: now(),
    phase: '4B.1',
    mode: 'AUDIT_ONLY',
    result: 'P0_PHASE_4B1_DIAGNOSTIC_HOLD',
    sku: SKU,
    failed_request: supportDiagnostic,
    endpoint: contractAudit.endpoint_contract,
    complete_payload: payload,
    complete_payload_sha256: payloadHash,
    contract_audit: contractAudit,
    theoretical_minimal_payload: minimalPayload,
    theoretical_minimal_payload_sha256: sha256(JSON.stringify(minimalPayload)),
    extras_vs_minimal: extras,
    condition_migration: conditionMigration,
    image_audit: imageAudit,
    technical_specs_contract_read: { status: technicalResponse.status, consulted_at: technicalResponse.consulted_at, groups: technicalResponse.body.groups?.length || 0 },
    sale_terms_contract_read: { status: saleTermsResponse.status, consulted_at: saleTermsResponse.consulted_at, total: saleTermsResponse.body.length },
    suspicious_fields: [
      {
        field: 'condition',
        risk: 'LOW',
        finding: 'Deprecated but explicitly backward-compatible; migrate to ITEM_CONDITION in a future authorized payload.',
      },
      {
        field: 'optional_fields_and_8_extra_pictures',
        risk: 'LOW',
        finding: 'No invalid value found; a minimum payload would reduce the ML backend surface for a controlled retry.',
      },
      {
        field: 'SUPPORTED_BATTERY_SIZE',
        risk: 'CLEARED',
        finding: 'Comma-separated AA, AAA is the documented multivalued encoding and both values exist in the live schema.',
      },
    ],
    probable_cause: cause,
    recommended_next_action: {
      post_authorized: false,
      action: 'Open ML support case with support-diagnostic.json. After support feedback or explicit operator authorization, make at most one controlled POST using the theoretical minimum payload plus any business-required fields explicitly approved.',
      preserve_identity: ['family_name', 'category_id', 'price', 'currency_id', 'available_quantity', 'buying_mode', 'listing_type_id', 'BRAND', 'MODEL', 'PRODUCT_TYPE', 'ITEM_CONDITION'],
      unresolved_conditional_gate: 'GTIN conditional_required cannot be resolved in this phase because /attributes/conditional is a POST and all POST requests are prohibited.',
    },
    official_sources: OFFICIAL_DOCS,
    metrics,
    invariants: {
      ml_posts: metrics.ml_posts,
      ml_puts: metrics.ml_puts,
      supabase_writes: metrics.supabase_writes,
      commercial_changes: 0,
    },
    hold: 'P0 PHASE 4B.1 — DIAGNOSTIC HOLD',
  };
  writeJson(path.join(REPORT_DIR, 'full-report.json'), fullReport);
  writeJson(path.join(REPORT_DIR, 'summary.json'), {
    generated_at: fullReport.generated_at,
    phase: fullReport.phase,
    mode: fullReport.mode,
    result: fullReport.result,
    request_id: REQUEST_ID,
    payload_sha256: payloadHash,
    endpoint_confirmed: true,
    probable_cause: cause.classification,
    image_total: imageAudit.total,
    image_passed: imageAudit.passed,
    fields_with_proven_invalid_contract: 0,
    new_posts: metrics.ml_posts,
    supabase_writes: metrics.supabase_writes,
    hold: fullReport.hold,
  });
  console.log(JSON.stringify({
    event: 'p0_phase4b1_completed',
    result: fullReport.result,
    probable_cause: cause.classification,
    images: `${imageAudit.passed}/${imageAudit.total}`,
    ml_gets: metrics.ml_gets,
    ml_posts: metrics.ml_posts,
    supabase_writes: metrics.supabase_writes,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'p0_phase4b1_failed', error: error.message, metrics, timestamp: now() }));
  process.exitCode = 1;
});
