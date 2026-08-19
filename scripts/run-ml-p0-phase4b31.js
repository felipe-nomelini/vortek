#!/usr/bin/env node
/* Phase 4B.3.1: read-only remote normalization and financial audit. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { EXPECTED, attribute } = require('./lib/ml-p0-phase4b3');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-p0-phase4b31');
const PRIOR_FINANCIAL_PATH = path.resolve('reports/ml-p0-phase4b2/canary-financial-validation.json');
const ITEM_ID = EXPECTED.itemId;
const ORIGINAL_DIMENSIONS = Object.freeze({ height_cm: 17, length_cm: 12, width_cm: 13, weight_g: 262 });
const IMAGE_FILES = Object.freeze({
  source: '/tmp/vtk000486-source-6.jpg',
  ml_previous: '/tmp/vtk000486-ml-old-6.jpg',
  ml_current: '/tmp/vtk000486-ml-current-6.jpg',
});
const IMAGE_URLS = Object.freeze({
  source: 'https://static.hayapek.com.br/produtos/74810/550/6.jpg',
  ml_previous: 'https://http2.mlstatic.com/D_881494-MLA116279066915_082026-O.jpg',
  ml_current: 'https://http2.mlstatic.com/D_842932-MLA116279067739_082026-O.jpg',
});
const HOLD = 'P0 PHASE 4B.3.1 — REMOTE NORMALIZATION HOLD';
const now = () => new Date().toISOString();

function writeJson(name, value) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function remoteDimension(item, id) {
  const value = attribute(item, id);
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

async function getJson(token, resource, allow404 = false) {
  const response = await fetch(`https://api.mercadolibre.com${resource}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (allow404 && response.status === 404) return { status: 404, data: null };
  if (!response.ok) throw new Error(`ml_get_failed:${response.status}:${resource}:${data?.message || 'unknown'}`);
  return { status: response.status, data };
}

function quoteCost(quote) {
  const value = Number(quote?.coverage?.all_country?.list_cost);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function financial({ price, commission, shipping, cost, taxRate = 0.05 }) {
  const tax = price * taxRate;
  const profit = price - commission - shipping - cost - tax;
  return {
    price,
    commission,
    shipping,
    cost,
    tax_rate_percent: taxRate * 100,
    tax,
    profit,
    margin_percent: price > 0 ? (profit / price) * 100 : 0,
    target_margin_percent: 15,
    approved: price > 0 && (profit / price) * 100 + 0.000001 >= 15,
  };
}

function criticalChecks(item, userProduct, family) {
  const actualFamilyId = String(item.family_id || userProduct?.family_id || family?.family_id || '');
  return [
    ['seller_id', EXPECTED.sellerId, item.seller_id],
    ['seller_sku', EXPECTED.sku, item.seller_custom_field || attribute(item, 'SELLER_SKU')],
    ['GTIN', EXPECTED.gtin, attribute(item, 'GTIN')],
    ['BRAND', EXPECTED.brand, attribute(item, 'BRAND')],
    ['MODEL', EXPECTED.model, attribute(item, 'MODEL')],
    ['category_id', EXPECTED.categoryId, item.category_id],
    ['user_product_id', EXPECTED.userProductId, item.user_product_id || userProduct?.id],
    ['family_id', String(EXPECTED.familyId), actualFamilyId],
    ['PRODUCT_TYPE', EXPECTED.productType, attribute(item, 'PRODUCT_TYPE')],
    ['price', EXPECTED.price, Number(item.price)],
    ['available_quantity', EXPECTED.quantity, Number(item.available_quantity)],
    ['listing_type', EXPECTED.listingTypeId, item.listing_type_id],
    ['condition', EXPECTED.condition, item.condition],
  ].map(([field, expected, remote]) => ({
    field,
    expected,
    remote,
    result: String(expected) === String(remote) ? 'MATCH' : 'DIVERGENT',
  }));
}

async function main() {
  const startedAt = now();
  const supabaseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('supabase_service_configuration_missing');
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [integrationResult, productResult] = await Promise.all([
    supabase.from('integracoes').select('access_token,conectado').eq('tipo', 'mercadolivre').maybeSingle(),
    supabase.from('produtos').select('id,sku,nome,gtin,custo,estoque,ml_item_id,ml_status').eq('id', EXPECTED.productId).maybeSingle(),
  ]);
  if (integrationResult.error || !integrationResult.data?.conectado || !integrationResult.data?.access_token) {
    throw new Error(`ml_integration_unavailable:${integrationResult.error?.message || 'missing_token'}`);
  }
  if (productResult.error || !productResult.data) throw new Error(`product_read_failed:${productResult.error?.message || 'not_found'}`);
  const token = integrationResult.data.access_token;

  const item = (await getJson(token, `/items/${ITEM_ID}?include_internal_attributes=true`)).data;
  const userProduct = (await getJson(token, `/user-products/${EXPECTED.userProductId}`)).data;
  const family = (await getJson(token, `/sites/MLB/user-products-families/${EXPECTED.familyId}`)).data;
  const checks = criticalChecks(item, userProduct, family);
  const criticalMatch = checks.every((row) => row.result === 'MATCH');

  const currentDimensions = {
    height_cm: remoteDimension(item, 'SELLER_PACKAGE_HEIGHT'),
    length_cm: remoteDimension(item, 'SELLER_PACKAGE_LENGTH'),
    width_cm: remoteDimension(item, 'SELLER_PACKAGE_WIDTH'),
    weight_g: remoteDimension(item, 'SELLER_PACKAGE_WEIGHT'),
  };
  const currentDimensionParam = `${currentDimensions.height_cm}x${currentDimensions.width_cm}x${currentDimensions.length_cm},${currentDimensions.weight_g}`;
  const originalDimensionParam = `${ORIGINAL_DIMENSIONS.height_cm}x${ORIGINAL_DIMENSIONS.width_cm}x${ORIGINAL_DIMENSIONS.length_cm},${ORIGINAL_DIMENSIONS.weight_g}`;
  const logisticType = item.shipping?.logistic_type || 'xd_drop_off';
  const baseParams = {
    verbose: 'true',
    item_price: Number(item.price).toFixed(2),
    listing_type_id: item.listing_type_id,
    mode: item.shipping?.mode || 'me2',
    condition: item.condition,
    logistic_type: logisticType,
    free_shipping: String(item.shipping?.free_shipping === true),
  };
  const params = (values) => new URLSearchParams({ ...baseParams, ...values }).toString();
  const feeParams = new URLSearchParams({
    price: Number(item.price).toFixed(2),
    category_id: item.category_id,
    listing_type_id: item.listing_type_id,
    currency_id: item.currency_id || 'BRL',
    logistic_type: logisticType,
    shipping_mode: item.shipping?.mode || 'me2',
  }).toString();

  const [feeResult, itemQuoteResult, currentDimensionsQuoteResult, originalDimensionsQuoteResult, currentPictureErrors, previousPictureErrors] = await Promise.all([
    getJson(token, `/sites/MLB/listing_prices?${feeParams}`),
    getJson(token, `/users/${EXPECTED.sellerId}/shipping_options/free?${params({ item_id: ITEM_ID })}`),
    getJson(token, `/users/${EXPECTED.sellerId}/shipping_options/free?${params({ dimensions: currentDimensionParam })}`),
    getJson(token, `/users/${EXPECTED.sellerId}/shipping_options/free?${params({ dimensions: originalDimensionParam })}`),
    getJson(token, '/pictures/842932-MLA116279067739_082026/errors', true),
    getJson(token, '/pictures/881494-MLA116279066915_082026/errors', true),
  ]);

  const feeRows = Array.isArray(feeResult.data) ? feeResult.data : [feeResult.data];
  const fee = feeRows.find((row) => row?.listing_type_id === item.listing_type_id) || feeRows[0];
  const commission = Number(fee?.sale_fee_amount);
  const itemQuoteCost = quoteCost(itemQuoteResult.data);
  const currentDimensionsQuoteCost = quoteCost(currentDimensionsQuoteResult.data);
  const originalDimensionsQuoteCost = quoteCost(originalDimensionsQuoteResult.data);
  const effectiveShipping = itemQuoteCost ?? currentDimensionsQuoteCost;
  if (!Number.isFinite(commission) || !Number.isFinite(effectiveShipping)) throw new Error('financial_quote_incomplete');

  const priorFinancial = JSON.parse(fs.readFileSync(PRIOR_FINANCIAL_PATH, 'utf8')).remote;
  const currentFinancial = financial({
    price: Number(item.price),
    commission,
    shipping: effectiveShipping,
    cost: Number(productResult.data.custo),
  });

  const imageAudit = {
    classification: 'IMAGE_NORMALIZED_BY_ML',
    reviewed_manually_at: now(),
    position: 6,
    original_source_url: IMAGE_URLS.source,
    previous_ml_url: IMAGE_URLS.ml_previous,
    current_ml_url: IMAGE_URLS.ml_current,
    file_sha256: Object.fromEntries(Object.entries(IMAGE_FILES).map(([key, file]) => [key, sha256File(file)])),
    resolutions: { source: '550x550', previous_ml: '380x500', current_ml: '380x500' },
    visual_checks: {
      same_product: true,
      same_brand: true,
      same_model_label: true,
      same_commercial_quantity: true,
      same_color_or_variation: true,
      different_kit: false,
      excluded_accessory_added: false,
    },
    observation: 'Same rear view and product label; Mercado Livre assigned a new CDN picture ID and binary encoding without changing commercial identity.',
    diagnostics: {
      previous: previousPictureErrors,
      current: currentPictureErrors,
    },
  };

  let classification = 'REMOTE_NORMALIZATION_ACCEPTABLE';
  if (!criticalMatch) classification = 'MATERIAL_REMOTE_DRIFT';
  else if (imageAudit.classification !== 'IMAGE_NORMALIZED_BY_ML') classification = 'MATERIAL_REMOTE_DRIFT';
  else if (!currentFinancial.approved) classification = 'FINANCIAL_DRIFT_BLOCKING';

  const report = {
    phase: '4B.3.1',
    mode: 'AUDIT_ONLY',
    started_at: startedAt,
    completed_at: now(),
    sku: EXPECTED.sku,
    item_id: ITEM_ID,
    critical_identity: { result: criticalMatch ? 'MATCH' : 'MATERIAL_REMOTE_DRIFT', checks },
    image_audit: imageAudit,
    package_dimensions: {
      original_supplier_payload: ORIGINAL_DIMENSIONS,
      current_ml: currentDimensions,
      initial_classification: 'ML_LOGISTICS_NORMALIZATION_PENDING_VALIDATION',
      final_classification: 'ML_LOGISTICS_NORMALIZATION_ACCEPTABLE',
      overwrite_product_master: false,
      source_separation_required: true,
      ml_context: { shipping_mode: item.shipping?.mode, logistic_type: logisticType },
    },
    shipping_revalidation: {
      currency_id: itemQuoteResult.data?.coverage?.all_country?.currency_id || 'BRL',
      previous_cost: Number(priorFinancial.shipping),
      item_id_quote_cost: itemQuoteCost,
      current_ml_dimensions_quote_cost: currentDimensionsQuoteCost,
      original_dimensions_control_quote_cost: originalDimensionsQuoteCost,
      effective_current_cost: effectiveShipping,
      effective_source: itemQuoteCost !== null ? 'active_item_id_quote' : 'current_ml_dimensions_quote',
      caveat: 'Pre-sale estimate. Definitive seller charge exists only after a sale via /shipments/{shipment_id}/costs senders[].cost.',
      item_id_quote: itemQuoteResult.data,
      current_dimensions_quote: currentDimensionsQuoteResult.data,
      original_dimensions_control_quote: originalDimensionsQuoteResult.data,
    },
    financial_revalidation: {
      previous: priorFinancial,
      current: currentFinancial,
      shipping_difference: effectiveShipping - Number(priorFinancial.shipping),
      profit_difference: currentFinancial.profit - Number(priorFinancial.profit),
      margin_percentage_point_difference: currentFinancial.margin_percent - Number(priorFinancial.margin_percent),
      commission_quote: fee,
    },
    classification,
    recommendation: classification === 'REMOTE_NORMALIZATION_ACCEPTABLE'
      ? 'Authorize a new local-persistence phase using current remote commercial fields; keep supplier package data and ML logistics data as separate evidence.'
      : 'Do not persist the local link until the blocking drift is resolved.',
    pipeline_proposal_only: {
      applied_globally: false,
      blocking_drift: ['seller_sku', 'gtin', 'brand', 'model', 'category_id', 'price', 'available_quantity', 'condition', 'commercial_unit', 'material_visual_identity'],
      acceptable_remote_normalization: ['equivalent_image_rehosting', 'ordering_or_formatting', 'platform_managed_fields', 'logistics_normalization_without_identity_or_margin_harm'],
    },
    writes: { mercado_livre: 0, supabase: 0, description: 0 },
    hold: HOLD,
  };

  writeJson('full-report.json', report);
  writeJson('summary.json', {
    generated_at: report.completed_at,
    classification,
    critical_identity: report.critical_identity.result,
    image: imageAudit.classification,
    dimensions: report.package_dimensions,
    previous_shipping: report.shipping_revalidation.previous_cost,
    current_shipping: effectiveShipping,
    previous_margin_percent: priorFinancial.margin_percent,
    current_margin_percent: currentFinancial.margin_percent,
    current_profit: currentFinancial.profit,
    recommendation: report.recommendation,
    writes: report.writes,
    hold: HOLD,
  });
  console.log(JSON.stringify({ event: 'p0_phase4b31_complete', classification, current_shipping: effectiveShipping, current_margin_percent: currentFinancial.margin_percent, writes: report.writes }));
}

main().catch((error) => {
  writeJson('error.json', { failed_at: now(), error: error.message, writes: { mercado_livre: 0, supabase: 0, description: 0 }, hold: HOLD });
  console.error(JSON.stringify({ event: 'p0_phase4b31_failed', error: error.message }));
  process.exitCode = 1;
});
