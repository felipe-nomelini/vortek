#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');
const { attributeValue, normalize, normalizeGtin } = require('./lib/ml-p0-phase6a');
const {
  EXPECTED_SELECTION_SHA256,
  TERMINAL_STATES,
  candidateDecision,
  catalogSemantics,
  categorySemantics,
  identityAssessment,
  inferProductSemantics,
  parseCsv,
  preservePriorBlock,
  secondPass,
  semanticAssessment,
  sha256,
} = require('./lib/ml-p0-phase6e1');

dotenv.config({ path: '.env.local', quiet: true });

const ROOT = path.resolve(__dirname, '..');
const PHASE6E_DIR = path.join(ROOT, 'reports', 'ml-p0-phase6e');
const REPORT_DIR = path.join(ROOT, 'reports', 'ml-p0-phase6e1');
const SELECTION_FILE = path.join(PHASE6E_DIR, 'selected-200.csv');
const SELLER_ID = 3294514937;
const HOLD = 'P0 PHASE 6E.1 — SEMANTIC CATEGORY REVALIDATION HOLD';
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metrics = {
  selected: 0, processed: 0, semantic_ready: 0, semantic_mismatches: 0,
  alternatives_found: 0, source_deferred: 0, category_unresolved: 0,
  gtin_conflicts: 0, second_pass_rejects: 0, source_recoveries: 0,
  category_block_recoveries: 0, ml_gets: 0, ml_read_retries: 0,
  supabase_reads: 0, dslite_live_reads: 0,
  ml_item_posts: 0, ml_puts: 0, local_commercial_writes: 0,
  started_at: now(),
};
let lastMlAt = 0;

const InventoryPageSchema = z.object({
  paging: z.object({ total: z.number().nonnegative() }),
  results: z.array(z.union([z.string(), z.number()])),
  scroll_id: z.string().optional(),
}).passthrough();
const MultiGetSchema = z.array(z.object({
  id: z.union([z.string(), z.number()]),
  status_code: z.number(),
  body: z.record(z.any()).optional(),
}).passthrough());
const ProductSearchSchema = z.object({ results: z.array(z.record(z.any())).default([]) }).passthrough();
const DomainDiscoverySchema = z.array(z.object({
  domain_id: z.string(), category_id: z.string(), domain_name: z.string().optional(), category_name: z.string().optional(),
}).passthrough());
const CategorySchema = z.object({ id: z.string(), name: z.string(), path_from_root: z.array(z.object({ id: z.string().optional(), name: z.string() })), settings: z.record(z.any()) }).passthrough();

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function csvCell(value) {
  const rendered = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return `"${rendered.replaceAll('"', '""')}"`;
}

function writeCsv(file, headers, rows) {
  fs.writeFileSync(file, `${[headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n')}\n`);
}

function dbClient() {
  const url = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('AUTH_SYSTEMIC_FAILURE:supabase_configuration_missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function selectAll(db, table, columns, configure, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    metrics.supabase_reads += 1;
    let query = db.from(table).select(columns).order('id').range(from, from + pageSize - 1);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`supabase_${table}:${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function mlGet(token, resource, schema = null) {
  if (!resource.startsWith('/')) throw new Error(`invalid_ml_resource:${resource}`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const delay = 140 - (Date.now() - lastMlAt);
    if (delay > 0) await sleep(delay);
    lastMlAt = Date.now(); metrics.ml_gets += 1;
    const response = await fetch(`https://api.mercadolibre.com${resource}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) {
      if (schema) {
        const parsed = schema.safeParse(data);
        if (!parsed.success) throw new Error(`ml_contract_invalid:${resource}:${parsed.error.issues[0]?.message}`);
        return { ok: true, status: response.status, data: parsed.data, headers: Object.fromEntries(response.headers) };
      }
      return { ok: true, status: response.status, data, headers: Object.fromEntries(response.headers) };
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) return { ok: false, status: response.status, data, headers: Object.fromEntries(response.headers) };
    metrics.ml_read_retries += 1;
    await sleep((2 ** (attempt - 1)) * 500 + Math.floor(Math.random() * 200));
  }
  throw new Error('unreachable_ml_get');
}

async function scanInventory(token) {
  const ids = []; const seenScroll = new Set(); let scrollId = ''; let expected = null; let pages = 0;
  while (pages < 1000) {
    const query = scrollId ? `search_type=scan&scroll_id=${encodeURIComponent(scrollId)}` : 'search_type=scan&limit=100';
    const response = await mlGet(token, `/users/${SELLER_ID}/items/search?${query}`, InventoryPageSchema);
    if (!response.ok) throw new Error(`BATCH_ABORT_REMOTE_INVENTORY_UNRELIABLE:http_${response.status}`);
    pages += 1; expected ??= response.data.paging.total;
    ids.push(...response.data.results.map(String));
    if (!response.data.results.length || new Set(ids).size >= expected || !response.data.scroll_id || seenScroll.has(response.data.scroll_id)) break;
    seenScroll.add(response.data.scroll_id); scrollId = response.data.scroll_id;
  }
  const unique = [...new Set(ids)]; const items = [];
  const fields = 'body.title,body.status,body.sub_status,body.seller_id,body.seller_custom_field,body.user_product_id,body.family_id,body.family_name,body.catalog_product_id,body.category_id,body.attributes,body.price,body.available_quantity,body.listing_type_id,body.catalog_listing,body.permalink,body.pictures,body.condition,body.domain_id';
  for (let index = 0; index < unique.length; index += 20) {
    const response = await mlGet(token, `/items/bulk?ids=${unique.slice(index, index + 20).join(',')}&attributes=${fields}`, MultiGetSchema);
    if (!response.ok) throw new Error(`BATCH_ABORT_REMOTE_INVENTORY_UNRELIABLE:multiget_${response.status}`);
    for (const row of response.data) if (row.status_code === 200 && row.id && row.body) items.push({ ...row.body, id: String(row.id) });
  }
  if (unique.length !== expected || items.length !== unique.length) throw new Error(`BATCH_ABORT_REMOTE_INVENTORY_UNRELIABLE:${unique.length}/${expected}/${items.length}`);
  return { expected, captured: unique.length, pages, reliable: true, timestamp: now(), ids: unique, items };
}

function sellerSku(item) {
  return item.seller_custom_field || attributeValue(item, 'SELLER_SKU');
}

function remoteMatches(inventory, sku, gtin) {
  return inventory.filter((item) => normalize(sellerSku(item)) === normalize(sku) || (normalizeGtin(gtin) && normalizeGtin(attributeValue(item, 'GTIN')) === normalizeGtin(gtin)));
}

function existingArtifacts(sku) {
  const dir = path.join(PHASE6E_DIR, sku);
  return {
    baseline: readJson(path.join(dir, 'local-baseline.json'), {}),
    identity: readJson(path.join(dir, 'identity.json'), {}),
    category: readJson(path.join(dir, 'category.json'), {}),
    catalog: readJson(path.join(dir, 'catalog.json'), {}),
    attributes: readJson(path.join(dir, 'required-attributes.json'), readJson(path.join(dir, 'attributes.json'), {})),
    images: readJson(path.join(dir, 'image-audit.json'), {}),
  };
}

function sourceSemantics(product, artifacts) {
  const supplier = artifacts.identity?.dslite?.product || artifacts.baseline?.preferred_offer || null;
  return {
    supplier_present: Boolean(supplier),
    supplier_name: supplier?.titulo || supplier?.nome || null,
    supplier_category: supplier?.categoria_nome || product?.categoria || null,
    supplier_brand: supplier?.marca || artifacts.baseline?.preferred_offer?.marca || null,
    supplier_gtin: supplier?.ean11 || supplier?.gtin || null,
    supplier_url: artifacts.identity?.dslite?.url || null,
    captured_at: artifacts.identity?.dslite?.consulted_at || artifacts.identity?.checked_at || null,
    independent_of_ml: Boolean(supplier),
    live_lookup: false,
  };
}

async function categoryCandidates(token, product, catalog, max = 3) {
  const discovery = await mlGet(token, `/sites/MLB/domain_discovery/search?q=${encodeURIComponent(product.nome)}`, DomainDiscoverySchema);
  if (!discovery.ok) return { status: 'SOURCE_DEFERRED', http_status: discovery.status, rows: [] };
  const unique = [];
  for (const row of discovery.data) if (!unique.some((entry) => entry.category_id === row.category_id)) unique.push(row);
  const ordered = unique.sort((left, right) => Number(right.domain_id === catalog?.domain_id) - Number(left.domain_id === catalog?.domain_id)).slice(0, max);
  const rows = [];
  for (const candidate of ordered) {
    const [categoryResponse, attributesResponse] = await Promise.all([
      mlGet(token, `/categories/${candidate.category_id}`, CategorySchema),
      mlGet(token, `/categories/${candidate.category_id}/attributes`, z.array(z.record(z.any()))),
    ]);
    if (!categoryResponse.ok || !attributesResponse.ok) {
      rows.push({ candidate, error: `category_or_attributes_http_${categoryResponse.status}/${attributesResponse.status}` });
      continue;
    }
    rows.push({ candidate, category: categoryResponse.data, attributes: attributesResponse.data });
  }
  return { status: rows.length ? 'FOUND' : 'SOURCE_DEFERRED', rows, raw_count: discovery.data.length };
}

function writeSkuArtifacts(sku, payload) {
  const dir = path.join(REPORT_DIR, sku);
  for (const [name, value] of Object.entries(payload)) writeJson(path.join(dir, name), value);
}

function baseResult(index, sku, previousState) {
  return { ordinal: index, sku, phase6e_state: previousState, phase6e1_state: null, category_candidate: null, semantic_score: null, second_pass: 'NOT_APPLICABLE', evidence: null };
}

async function processSku({ index, selected, product, offer, previous, inventory, token }) {
  metrics.processed += 1;
  const artifacts = existingArtifacts(selected.sku);
  const result = baseResult(index, selected.sku, previous?.result || 'UNKNOWN');
  const source = sourceSemantics(product, artifacts);
  const supplierProduct = artifacts.identity?.dslite?.product || null;
  const localSemantics = inferProductSemantics(product || {}, supplierProduct);
  const matches = remoteMatches(inventory.items, selected.sku, selected.gtin);
  const common = {
    'local-product-semantics.json': { generated_at: now(), product: product || null, semantics: localSemantics },
    'source-semantics.json': { generated_at: now(), source, preferred_offer: offer || null },
    'image-semantic-signals.json': { generated_at: now(), local_images: product?.imagens || [], catalog_images: artifacts.identity?.catalog_results?.flatMap((row) => row.pictures || []) || [], classification: 'SUPPORTING_ONLY_NOT_USED_AS_PRIMARY_SEMANTIC_PROOF' },
  };

  if (selected.sku === 'VTK012864') {
    const catalog = (artifacts.identity?.catalog_results || [])[0] || null;
    const category = artifacts.category?.category || null;
    const categoryData = categorySemantics(category || {}, { domain_id: catalog?.domain_id || 'MLB-TABLET_INTERNAL_SPEAKERS', category_id: 'MLB129666' });
    const assessment = semanticAssessment({ productSemantics: localSemantics, category: categoryData, catalog, identityConfidence: 100, attributes: artifacts.attributes?.category_attributes || [], independentSource: true });
    const second = secondPass({ productSemantics: localSemantics, category: categoryData, assessment, supplierCategory: source.supplier_category });
    result.phase6e1_state = 'KNOWN_WRONG_CATEGORY_REMOTE_ITEM'; result.category_candidate = categoryData.category_path.join(' > '); result.semantic_score = assessment.score; result.second_pass = second.verdict;
    result.evidence = 'MLB7437196478 exists in MLB-TABLET_INTERNAL_SPEAKERS; new gate simulation blocks before payload';
    writeSkuArtifacts(selected.sku, {
      ...common,
      'domain-semantics.json': { domain_id: categoryData.domain_id, classification: 'SEMANTIC_MISMATCH' },
      'category-tree.json': { category_id: categoryData.category_id, path: categoryData.category_path },
      'category-semantics.json': categoryData,
      'catalog-semantics.json': catalogSemantics(catalog),
      'attribute-semantic-signals.json': assessment.attribute_signals,
      'semantic-score.json': assessment,
      'second-pass.json': second,
      'recommendation.json': { action: 'PENDING_INCIDENT_CONTAINMENT', commercial_write_authorized: false },
      'summary.json': result,
    });
    return result;
  }

  if (!product || product.id !== selected.produto_id || product.ativo !== true || Number(product.estoque) <= 0 || Number(product.custo) <= 0 || product.ml_item_id != null || product.ml_status !== 'sem_anuncio') {
    result.phase6e1_state = 'BLOCK_LOCAL_STATE'; result.evidence = 'frozen local product state no longer satisfies baseline';
    return finalizeSimple(result, common, localSemantics, source);
  }
  if (matches.length) {
    result.phase6e1_state = 'BLOCK_REMOTE_DUPLICATE'; result.evidence = matches.map((row) => row.id).join('|');
    return finalizeSimple(result, common, localSemantics, source, { remote_matches: matches.map((row) => ({ id: row.id, status: row.status, sku: sellerSku(row), gtin: attributeValue(row, 'GTIN') })) });
  }
  const preserved = preservePriorBlock(previous?.result);
  if (preserved) {
    result.phase6e1_state = preserved; result.evidence = previous?.observation || 'Phase 6E blocking evidence preserved';
    return finalizeSimple(result, common, localSemantics, source);
  }
  if (!normalizeGtin(selected.gtin)) {
    result.phase6e1_state = 'SOURCE_DEFERRED'; result.evidence = 'no GTIN and no independent official identity/category proof sufficient for automatic semantic approval';
    return finalizeSimple(result, common, localSemantics, source);
  }

  let catalogs = artifacts.identity?.catalog_results || [];
  if (previous?.result === 'SOURCE_DEFERRED') {
    const search = await mlGet(token, `/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(selected.gtin)}`, ProductSearchSchema);
    if (!search.ok) {
      result.phase6e1_state = 'SOURCE_DEFERRED'; result.evidence = `current exact-GTIN search HTTP ${search.status}`;
      return finalizeSimple(result, common, localSemantics, source);
    }
    catalogs = search.data.results;
    if (catalogs.length) metrics.source_recoveries += 1;
  }
  if (!catalogs.length) {
    result.phase6e1_state = 'SOURCE_DEFERRED'; result.evidence = 'current exact-GTIN search found no ML catalog and cached supplier evidence is insufficient for category approval';
    return finalizeSimple(result, common, localSemantics, source);
  }

  const assessedCatalogs = catalogs.map((catalog) => ({ catalog, identity: identityAssessment(product, offer || {}, catalog, selected.gtin) }));
  const passed = assessedCatalogs.filter((row) => row.identity.passed).sort((left, right) => right.identity.title_similarity - left.identity.title_similarity);
  if (!passed.length) {
    const bestIdentity = assessedCatalogs.sort((left, right) => left.identity.conflicts.length - right.identity.conflicts.length)[0];
    result.phase6e1_state = bestIdentity.identity.conflicts.includes('BRAND') ? 'BLOCK_GTIN_BRAND_CONFLICT'
      : bestIdentity.identity.conflicts.includes('MODEL') ? 'BLOCK_GTIN_MODEL_CONFLICT'
        : bestIdentity.identity.conflicts.includes('UNIT') ? 'BLOCK_GTIN_UNIT_CONFLICT' : 'BLOCK_IDENTITY';
    result.evidence = `current exact-GTIN identity conflicts: ${bestIdentity.identity.conflicts.join(',')}`;
    return finalizeSimple(result, common, localSemantics, source, { catalog: catalogSemantics(bestIdentity.catalog), identity: bestIdentity.identity });
  }

  const chosen = passed[0];
  const candidates = await categoryCandidates(token, product, chosen.catalog);
  if (candidates.status !== 'FOUND') {
    result.phase6e1_state = candidates.status === 'SOURCE_DEFERRED' ? 'SOURCE_DEFERRED' : 'BLOCK_CATEGORY'; result.evidence = 'no current category tree candidate could be validated';
    return finalizeSimple(result, common, localSemantics, source, { catalog: catalogSemantics(chosen.catalog) });
  }
  const supplierGtin = normalizeGtin(source.supplier_gtin);
  const independentSource = source.supplier_present && supplierGtin === normalizeGtin(selected.gtin);
  const scored = candidates.rows.filter((row) => row.category).map((row) => {
    const semantics = categorySemantics(row.category, row.candidate);
    const assessment = semanticAssessment({ productSemantics: localSemantics, category: semantics, catalog: chosen.catalog, identityConfidence: independentSource ? 100 : 90, attributes: row.attributes, independentSource });
    const second = secondPass({ productSemantics: localSemantics, category: semantics, assessment, supplierCategory: source.supplier_category });
    return { ...row, semantics, assessment, second };
  }).sort((left, right) => right.assessment.score - left.assessment.score);
  if (!scored.length) {
    result.phase6e1_state = 'SOURCE_DEFERRED'; result.evidence = 'category candidate reads unavailable';
    return finalizeSimple(result, common, localSemantics, source, { catalog: catalogSemantics(chosen.catalog) });
  }
  const best = scored[0];
  const catalogDomain = normalize(chosen.catalog.domain_id);
  const hasAlternative = normalize(best.semantics.domain_id) !== catalogDomain || previous?.result === 'BLOCK_CATEGORY';
  const decision = candidateDecision({ previousState: previous?.result, assessment: best.assessment, second: best.second, hasAlternative });
  result.phase6e1_state = decision; result.category_candidate = best.semantics.category_path.join(' > '); result.semantic_score = best.assessment.score; result.second_pass = best.second.verdict;
  result.evidence = best.assessment.hard_conflicts.length ? best.assessment.hard_conflicts.join('|') : best.second.reason;
  if (decision === 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND' && previous?.result === 'BLOCK_CATEGORY') metrics.category_block_recoveries += 1;
  writeSkuArtifacts(selected.sku, {
    ...common,
    'domain-semantics.json': { candidates: scored.map((row) => ({ domain_id: row.semantics.domain_id, domain_name: row.semantics.domain_name, classification: row.assessment.classification, score: row.assessment.score })) },
    'category-tree.json': { candidates: scored.map((row) => ({ category_id: row.semantics.category_id, path: row.semantics.category_path })) },
    'category-semantics.json': { selected: best.semantics, candidates: scored.map((row) => ({ semantics: row.semantics, score: row.assessment.score, hard_mismatch: row.assessment.hard_mismatch })) },
    'catalog-semantics.json': catalogSemantics(chosen.catalog),
    'attribute-semantic-signals.json': best.assessment.attribute_signals,
    'semantic-score.json': best.assessment,
    'second-pass.json': best.second,
    'recommendation.json': { action: decision, future_write_authorized: false, alternative: decision === 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND' ? best.semantics : null },
    'summary.json': result,
  });
  return result;
}

function finalizeSimple(result, common, localSemantics, source, extra = {}) {
  writeSkuArtifacts(result.sku, {
    ...common,
    'domain-semantics.json': { status: 'not_resolved', reason: result.phase6e1_state },
    'category-tree.json': { status: 'not_resolved', reason: result.phase6e1_state },
    'category-semantics.json': { status: 'not_resolved', reason: result.phase6e1_state },
    'catalog-semantics.json': extra.catalog || null,
    'attribute-semantic-signals.json': { status: 'not_evaluated', reason: result.phase6e1_state },
    'semantic-score.json': { score: null, reason: result.phase6e1_state, product_semantics_confidence: localSemantics.confidence },
    'second-pass.json': { verdict: 'NOT_APPLICABLE', reason: result.phase6e1_state },
    'recommendation.json': { action: result.phase6e1_state, future_write_authorized: false, source },
    'summary.json': result,
  });
  return result;
}

function updateMetrics(result) {
  if (result.phase6e1_state === 'SEMANTIC_CATEGORY_READY') metrics.semantic_ready += 1;
  if (result.phase6e1_state === 'BLOCK_SEMANTIC_CATEGORY_MISMATCH' || result.phase6e1_state === 'KNOWN_WRONG_CATEGORY_REMOTE_ITEM') metrics.semantic_mismatches += 1;
  if (result.phase6e1_state === 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND') metrics.alternatives_found += 1;
  if (result.phase6e1_state === 'SOURCE_DEFERRED') metrics.source_deferred += 1;
  if (result.phase6e1_state === 'BLOCK_CATEGORY' || result.phase6e1_state === 'SEMANTIC_CATEGORY_REVIEW_REQUIRED') metrics.category_unresolved += 1;
  if (/^BLOCK_GTIN_/.test(result.phase6e1_state)) metrics.gtin_conflicts += 1;
  if (result.phase6e1_state === 'SEMANTIC_CATEGORY_REVIEW_REQUIRED') metrics.second_pass_rejects += 1;
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const tests = spawnSync(process.execPath, ['--test', 'tests/ml-p0-phase6e1.test.js'], { cwd: ROOT, encoding: 'utf8' });
  const testReport = { executed_at: now(), command: 'node --test tests/ml-p0-phase6e1.test.js', exit_code: tests.status, passed: tests.status === 0, stdout: tests.stdout, stderr: tests.stderr };
  writeJson(path.join(REPORT_DIR, 'test-results.json'), testReport);
  if (tests.status !== 0) throw new Error('SEMANTIC_GATE_TESTS_FAILED');

  const selectionBytes = fs.readFileSync(SELECTION_FILE);
  const selectionHash = sha256(selectionBytes);
  if (selectionHash !== EXPECTED_SELECTION_SHA256) throw new Error(`ABORT_SELECTION_DRIFT:${selectionHash}`);
  const selected = parseCsv(selectionBytes.toString('utf8'));
  if (selected.length !== 200) throw new Error(`ABORT_SELECTION_COUNT:${selected.length}`);
  metrics.selected = selected.length;

  const db = dbClient();
  const [allProducts, allOffers, integrations] = await Promise.all([
    selectAll(db, 'produtos', '*'),
    selectAll(db, 'produto_fornecedor_ofertas', '*'),
    selectAll(db, 'integracoes', '*'),
  ]);
  const mlIntegration = integrations.find((row) => String(row.tipo).toLowerCase() === 'mercadolivre');
  if (!mlIntegration?.access_token) throw new Error('AUTH_SYSTEMIC_FAILURE:mercadolivre_token_missing');
  const account = await assertAllowedMercadoLivreToken(mlIntegration.access_token, 'ml-p0-phase6e1');
  if (String(account.userId) !== String(SELLER_ID)) throw new Error(`AUTH_SYSTEMIC_FAILURE:seller_${account.userId}`);

  const inventory = await scanInventory(mlIntegration.access_token);
  const selectedSkus = new Set(selected.map((row) => row.sku));
  const inventoryMatches = inventory.items.filter((item) => selectedSkus.has(String(sellerSku(item) || '')) || selected.some((row) => normalizeGtin(row.gtin) && normalizeGtin(attributeValue(item, 'GTIN')) === normalizeGtin(row.gtin)));
  writeJson(path.join(REPORT_DIR, 'remote-inventory-snapshot.json'), {
    captured_at: inventory.timestamp, expected: inventory.expected, captured: inventory.captured, pages: inventory.pages,
    reliable: inventory.reliable, ids_sha256: sha256(inventory.ids.sort().join('\n')), selected_matches: inventoryMatches.map((item) => ({ id: item.id, sku: sellerSku(item), gtin: attributeValue(item, 'GTIN'), category_id: item.category_id, status: item.status })),
  });

  const previousSummary = readJson(path.join(PHASE6E_DIR, 'summary.json'));
  const previousBySku = new Map((previousSummary.results || []).map((row) => [row.sku, row]));
  const productsBySku = new Map(allProducts.map((row) => [row.sku, row]));
  const offersById = new Map(allOffers.map((row) => [row.id, row]));
  const results = [];
  for (const [offset, row] of selected.entries()) {
    const product = productsBySku.get(row.sku) || null;
    const result = await processSku({
      index: offset + 1, selected: row, product,
      offer: product ? offersById.get(product.oferta_preferencial_id) || null : null,
      previous: previousBySku.get(row.sku), inventory, token: mlIntegration.access_token,
    });
    if (!TERMINAL_STATES.has(result.phase6e1_state)) throw new Error(`NON_TERMINAL_RESULT:${row.sku}:${result.phase6e1_state}`);
    results.push(result); updateMetrics(result);
    if ((offset + 1) % 25 === 0) process.stdout.write(`${JSON.stringify({ checkpoint: offset + 1, counts: countBy(results, 'phase6e1_state'), writes: { ml_post: 0, ml_put: 0, local: 0 } })}\n`);
  }

  metrics.completed_at = now(); metrics.elapsed_ms = Date.parse(metrics.completed_at) - Date.parse(metrics.started_at);
  const counts = countBy(results, 'phase6e1_state');
  const readyRows = results.filter((row) => row.phase6e1_state === 'SEMANTIC_CATEGORY_READY');
  const retrospective = {
    ready_audited: readyRows.length,
    hard_mismatch_ready: readyRows.filter((row) => readJson(path.join(REPORT_DIR, row.sku, 'semantic-score.json'))?.hard_mismatch).map((row) => row.sku),
    vtk012864_prevented: results.find((row) => row.sku === 'VTK012864')?.phase6e1_state === 'KNOWN_WRONG_CATEGORY_REMOTE_ITEM'
      && readJson(path.join(REPORT_DIR, 'VTK012864', 'semantic-score.json'))?.hard_mismatch === true,
  };
  const incidents = [
    { sku: 'VTK017508', state: 'EXCLUDED_PENDING_INCIDENT', item_id: 'MLB7432501874', action_taken: 'NONE' },
    { sku: 'VTK012864', state: 'KNOWN_WRONG_CATEGORY_REMOTE_ITEM', item_id: 'MLB7437196478', action_taken: 'READ_ONLY_CLASSIFICATION' },
  ];
  const summary = {
    phase: '6E.1', mode: 'AUDIT_ONLY_SEMANTIC_CATEGORY_REVALIDATION', generated_at: now(), selection: { file: 'reports/ml-p0-phase6e/selected-200.csv', sha256: selectionHash, expected_sha256: EXPECTED_SELECTION_SHA256, count: selected.length, order_preserved: true },
    inventory: { expected: inventory.expected, captured: inventory.captured, pages: inventory.pages, reliable: inventory.reliable, timestamp: inventory.timestamp },
    processed: results.length, counts, metrics, retrospective_stop_loss_audit: retrospective, incidents,
    writes: { ml_item_posts: 0, ml_puts: 0, descriptions: 0, quality_calls: 0, supabase_mutations: 0, commercial_local_persistence: 0 },
    approved: results.length === 200 && retrospective.vtk012864_prevented && retrospective.hard_mismatch_ready.length === 0 && metrics.ml_item_posts === 0 && metrics.ml_puts === 0 && metrics.local_commercial_writes === 0,
    next_phase_started: false, hold: HOLD,
  };

  writeCsv(path.join(REPORT_DIR, 'semantic-results.csv'), ['ordinal', 'sku', 'phase6e_state', 'phase6e1_state', 'category_candidate', 'semantic_score', 'second_pass', 'evidence'], results);
  writeCsv(path.join(REPORT_DIR, 'semantic-blocks.csv'), ['ordinal', 'sku', 'phase6e_state', 'phase6e1_state', 'category_candidate', 'semantic_score', 'second_pass', 'evidence'], results.filter((row) => !['SEMANTIC_CATEGORY_READY', 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND'].includes(row.phase6e1_state)));
  writeCsv(path.join(REPORT_DIR, 'semantic-alternatives.csv'), ['ordinal', 'sku', 'phase6e_state', 'phase6e1_state', 'category_candidate', 'semantic_score', 'second_pass', 'evidence'], results.filter((row) => row.phase6e1_state === 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND'));
  writeCsv(path.join(REPORT_DIR, 'source-deferred.csv'), ['ordinal', 'sku', 'phase6e_state', 'phase6e1_state', 'evidence'], results.filter((row) => row.phase6e1_state === 'SOURCE_DEFERRED'));
  writeCsv(path.join(REPORT_DIR, 'second-pass-results.csv'), ['ordinal', 'sku', 'phase6e1_state', 'semantic_score', 'second_pass', 'evidence'], results.filter((row) => row.second_pass !== 'NOT_APPLICABLE'));
  writeJson(path.join(REPORT_DIR, 'semantic-category-model.json'), {
    version: '6E.1', weights: { product_identity: 25, function_match: 25, intended_use: 20, category_path_coherence: 20, catalog_coherence: 10 },
    automatic_ready_gate: 95, hard_mismatch_score_cap: 74, consensus: ['product_semantics', 'full_category_path', 'supplier_or_official_source'],
    ml_catalog_and_domain_discovery_are_one_evidence_family: true, community_catalog_downweighted: true,
    fast_gate_0_future: 'Does this full category path make material sense for what the product actually is?',
  });
  writeJson(path.join(REPORT_DIR, 'summary.json'), summary);
  writeJson(path.join(REPORT_DIR, 'full-report.json'), { ...summary, results, official_contracts: { mercado_livre: 'https://developers.mercadolivre.com.br', dslite: 'https://documenter.getpostman.com/view/5316990/RWaRNkaA', supabase: 'https://supabase.com/docs/guides/database/connecting-to-postgres' }, substitutions: { firecrawl: 'local immutable evidence + official ML API reads', supabase_cloud: 'self-hosted Data API reads' } });
  process.stdout.write(`${JSON.stringify({ hold: HOLD, approved: summary.approved, counts, writes: summary.writes })}\n`);
}

function countBy(rows, key) {
  return rows.reduce((accumulator, row) => { accumulator[row[key]] = (accumulator[row[key]] || 0) + 1; return accumulator; }, {});
}

main().catch((error) => {
  writeJson(path.join(REPORT_DIR, 'abort.json'), { aborted_at: now(), error: error.message, writes: { ml_item_posts: metrics.ml_item_posts, ml_puts: metrics.ml_puts, local_commercial_writes: metrics.local_commercial_writes } });
  console.error(error.stack || error.message); process.exit(1);
});
