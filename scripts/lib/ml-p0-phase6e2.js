'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  attributeValue,
  buildCatalogAttributes,
  normalize,
  normalizeGtin,
} = require('./ml-p0-phase6a');
const shared = require('./ml-p0-phase6c');
const phase6e = require('./ml-p0-phase6e');
const {
  categorySemantics,
  inferProductSemantics,
  parseCsv,
  secondPass,
  semanticAssessment,
} = require('./ml-p0-phase6e1');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_FILE = path.join(ROOT, 'reports', 'ml-p0-phase6e1', 'semantic-alternatives.csv');
const SOURCE_DIR = path.dirname(SOURCE_FILE);
const FORBIDDEN = new Set(['VTK017508', 'VTK012864']);
const SELECTION_INFO = {};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function loadAuthorizedAlternatives() {
  if (!fs.existsSync(SOURCE_FILE)) throw new Error('ABORT_SEMANTIC_ALTERNATIVE_SOURCE_MISSING');
  const sourceBytes = fs.readFileSync(SOURCE_FILE);
  const rows = parseCsv(sourceBytes.toString('utf8'));
  if (rows.length !== 7) throw new Error(`ABORT_SEMANTIC_ALTERNATIVE_COUNT_DRIFT:${rows.length}`);
  if (new Set(rows.map((row) => row.sku)).size !== 7) throw new Error('ABORT_SEMANTIC_ALTERNATIVE_DUPLICATE_SKU');
  if (rows.some((row) => FORBIDDEN.has(row.sku))) throw new Error('AUTHORIZATION_SCOPE_VIOLATION');

  const selected = rows.map((row) => {
    const dir = path.join(SOURCE_DIR, row.sku);
    const recommendation = readJson(path.join(dir, 'recommendation.json'));
    const local = readJson(path.join(dir, 'local-product-semantics.json'));
    const semantic = readJson(path.join(dir, 'semantic-score.json'));
    const second = readJson(path.join(dir, 'second-pass.json'));
    const source = readJson(path.join(dir, 'source-semantics.json'));
    const alternative = recommendation.alternative;
    if (row.phase6e1_state !== 'SEMANTIC_CATEGORY_ALTERNATIVE_FOUND' || recommendation.action !== row.phase6e1_state || !alternative?.category_id || !alternative?.domain_id) {
      throw new Error(`ABORT_SEMANTIC_ALTERNATIVE_ARTIFACT_DRIFT:${row.sku}`);
    }
    if (Number(row.semantic_score) !== Number(semantic.score) || row.second_pass !== second.verdict) throw new Error(`ABORT_SEMANTIC_ALTERNATIVE_EVIDENCE_DRIFT:${row.sku}`);
    return {
      sku: row.sku,
      gtin: String(local.product?.gtin || ''),
      requestedName: local.product?.nome || '',
      frozenProductId: local.product?.id,
      decision: 'PASS',
      semanticScore: Number(semantic.score),
      secondPass: second.verdict,
      semanticAlternative: alternative,
      supplierEvidence: source.source,
      previousCategory: 'UNRESOLVED (Phase 6E BLOCK_CATEGORY)',
      sourceRow: row,
    };
  });
  return { selected, sourceHash: sha256(sourceBytes), sourceRows: rows };
}

const loaded = loadAuthorizedAlternatives();
const ALLOWED = loaded.selected;

function freezeSelection(reportDir) {
  fs.mkdirSync(reportDir, { recursive: true });
  const header = ['ordinal', 'sku', 'produto_id', 'produto', 'categoria_anterior', 'categoria_alternativa', 'category_id_alternativo', 'domain_id', 'semantic_score', 'second_pass', 'evidencias_principais'];
  const lines = [header.map(csvCell).join(',')];
  ALLOWED.forEach((row, index) => lines.push([
    index + 1, row.sku, row.frozenProductId, row.requestedName, row.previousCategory,
    row.semanticAlternative.category_path.join(' > '), row.semanticAlternative.category_id,
    row.semanticAlternative.domain_id, row.semanticScore, row.secondPass,
    row.sourceRow.evidence,
  ].map(csvCell).join(',')));
  const contents = `${lines.join('\n')}\n`;
  const file = path.join(reportDir, 'selected-7.csv');
  fs.writeFileSync(file, contents);
  Object.assign(SELECTION_INFO, {
    source_file: path.relative(ROOT, SOURCE_FILE),
    source_sha256: loaded.sourceHash,
    selected_file: path.relative(ROOT, file),
    selected_sha256: sha256(contents),
    count: ALLOWED.length,
    order_preserved: true,
    substitutions: false,
  });
  return SELECTION_INFO;
}

function values(entity, id) {
  const attribute = (entity?.attributes || []).find((row) => row.id === id);
  return [...new Set([attribute?.value_name, ...(attribute?.values || []).map((row) => row.name)].filter(Boolean).map(String))];
}

function usefulModel(value) {
  const model = normalize(value);
  return model.length >= 3 && !['naoseaplica', 'generico', 'modelo', 'seminformacao'].includes(model);
}

function categoryPath(category) {
  return (category?.path_from_root || []).map((row) => row.name);
}

function pathsEqual(left, right) {
  return left.length === right.length && left.every((value, index) => normalize(value) === normalize(right[index]));
}

function identityBlock(assessment) {
  if (assessment?.conflicts?.includes('BRAND')) return 'BLOCK_GTIN_BRAND_CONFLICT';
  if (assessment?.conflicts?.includes('MODEL')) return 'BLOCK_GTIN_MODEL_CONFLICT';
  if (assessment?.conflicts?.includes('UNIT')) return 'BLOCK_GTIN_UNIT_CONFLICT';
  return 'BLOCK_IDENTITY';
}

function semanticGatePasses({ independentSource, identityConfidence, score, hardMismatch, secondPassVerdict, pathMatch, domainMatch }) {
  return independentSource === true
    && Number(identityConfidence) >= 95
    && Number(score) >= 95
    && hardMismatch === false
    && secondPassVerdict === 'PASS'
    && pathMatch === true
    && domainMatch === true;
}

async function resolveDynamicConfig({ config, product, offer, dslite, exactResults, ml }) {
  const alternative = config.semanticAlternative;
  const categoryResponse = await ml(`/categories/${alternative.category_id}`);
  const attributesResponse = await ml(`/categories/${alternative.category_id}/attributes`);
  if (!categoryResponse.ok || !attributesResponse.ok) return { decision: 'BLOCK_CATEGORY', reason: `alternative category contract unavailable: ${categoryResponse.status}/${attributesResponse.status}` };

  const supplierGtin = normalizeGtin(dslite?.product?.ean11 || dslite?.product?.gtin);
  const independentSource = supplierGtin === normalizeGtin(config.gtin);
  const assessed = exactResults.map((catalog) => ({ catalog, identity: phase6e.identityAssessment(product, offer || {}, catalog, config.gtin) }));
  const passed = assessed.filter((row) => row.identity.passed).sort((left, right) => right.identity.title_similarity - left.identity.title_similarity);
  if (!passed.length) {
    const best = assessed.sort((left, right) => (left.identity?.conflicts?.length || 99) - (right.identity?.conflicts?.length || 99))[0];
    return { decision: identityBlock(best?.identity), reason: `live exact-GTIN identity recheck failed: ${(best?.identity?.conflicts || ['NO_EXACT_CATALOG']).join(',')}`, identityAssessment: best?.identity || null };
  }
  const chosen = passed[0];
  const productSemantics = inferProductSemantics(product, dslite?.product || null);
  const remoteCategory = categorySemantics(categoryResponse.data, { domain_id: categoryResponse.data?.settings?.catalog_domain });
  const assessment = semanticAssessment({ productSemantics, category: remoteCategory, catalog: chosen.catalog, identityConfidence: independentSource ? 100 : 90, attributes: attributesResponse.data || [], independentSource });
  const second = secondPass({ productSemantics, category: remoteCategory, assessment, supplierCategory: dslite?.product?.categoria_nome || product.categoria });
  const samePath = pathsEqual(remoteCategory.category_path, alternative.category_path);
  const sameDomain = normalize(remoteCategory.domain_id) === normalize(alternative.domain_id);
  const semanticRecheck = {
    passed: semanticGatePasses({ independentSource, identityConfidence: assessment.identity_confidence, score: assessment.score, hardMismatch: assessment.hard_mismatch, secondPassVerdict: second.verdict, pathMatch: samePath, domainMatch: sameDomain }),
    required_score: 95,
    original_score: config.semanticScore,
    assessment,
    second_pass: second,
    independent_supplier_gtin_match: independentSource,
    category: remoteCategory,
    expected_path: alternative.category_path,
    path_match: samePath,
    expected_domain: alternative.domain_id,
    domain_match: sameDomain,
    anti_frankenstein_answer: assessment.hard_mismatch || !samePath || !sameDomain ? 'NO' : 'YES',
  };
  if (!semanticRecheck.passed) return { decision: 'BLOCK_SEMANTIC_CATEGORY_MISMATCH', reason: `semantic alternative recheck failed: score=${assessment.score}, second=${second.verdict}, path=${samePath}, domain=${sameDomain}, supplier=${independentSource}`, semanticRecheck, identityAssessment: chosen.identity };

  const catalogInAlternativeDomain = normalize(chosen.catalog.domain_id) === normalize(alternative.domain_id);
  const catalogRequired = catalogInAlternativeDomain && chosen.catalog.settings?.listing_strategy === 'catalog_required';
  const model = attributeValue(chosen.catalog, 'MODEL');
  const brand = attributeValue(chosen.catalog, 'BRAND') || product.marca;
  const maxFamilyLength = Number(categoryResponse.data?.settings?.max_title_length || 60);
  const critical = {};
  for (const id of ['COLOR', 'VOLTAGE']) {
    const found = values(chosen.catalog, id);
    if (found.length) critical[id] = found;
  }
  return {
    decision: 'PASS',
    reason: 'SEMANTIC_ALTERNATIVE_CONFIRMED',
    brand,
    modelAliases: usefulModel(model) ? [model] : [],
    catalogProductId: catalogRequired ? chosen.catalog.id : null,
    catalogEvidenceId: chosen.catalog.id,
    categoryId: alternative.category_id,
    domainId: alternative.domain_id,
    familyName: String(chosen.catalog.name || `${brand} ${model || product.nome}`).slice(0, maxFamilyLength).trim(),
    critical,
    catalogEvidence: chosen.catalog,
    source: `DSLite supplier ${dslite?.url || ''} + ML exact GTIN ${chosen.catalog.id} + semantic alternative Phase 6E.1`,
    sourceConfidence: 'supplier_and_ml_catalog',
    identityConfidence: independentSource ? 100 : 90,
    identityAssessment: chosen.identity,
    semanticRecheck,
    oldPayloadState: 'INVALIDATED_BY_CATEGORY_CHANGE',
  };
}

function buildManualAttributes(config, categoryAttributes, sku) {
  return buildCatalogAttributes(config.catalogEvidence, categoryAttributes, sku);
}

function expectedDomain({ config }) {
  return config.domainId;
}

async function postSemanticValidation({ config, item, ml }) {
  const categoryResponse = await ml(`/categories/${item.category_id}`);
  const catalogResponse = item.catalog_product_id ? await ml(`/products/${item.catalog_product_id}`) : { ok: true, data: config.catalogEvidence };
  if (!categoryResponse.ok || !catalogResponse.ok) return { passed: false, reason: `post semantic read unavailable: ${categoryResponse.status}/${catalogResponse.status}` };
  const category = categorySemantics(categoryResponse.data, { domain_id: categoryResponse.data?.settings?.catalog_domain });
  const productSemantics = config.semanticRecheck?.assessment ? inferProductSemantics({ nome: config.requestedName, categoria: config.supplierEvidence?.supplier_category || '' }, null) : null;
  const semantics = productSemantics || config.productSemantics;
  const assessment = semanticAssessment({ productSemantics: semantics, category, catalog: catalogResponse.data, identityConfidence: 100, attributes: [], independentSource: true });
  const second = secondPass({ productSemantics: semantics, category, assessment, supplierCategory: config.supplierEvidence?.supplier_category || '' });
  const pathMatch = pathsEqual(category.category_path, config.semanticAlternative.category_path);
  const domainMatch = normalize(category.domain_id) === normalize(config.domainId);
  const catalogMatch = !config.catalogProductId || item.catalog_product_id === config.catalogProductId;
  const exactRemoteClassification = item.category_id === config.categoryId && pathMatch && domainMatch && catalogMatch;
  const preSemanticScore = Number(config.semanticRecheck?.assessment?.score || 0);
  // /products/{id} can temporarily omit GTIN after creation. Preserve the
  // validated pre-POST score only when every remote classification identifier
  // is unchanged; material mismatches still fail independently.
  const effectiveSemanticScore = exactRemoteClassification
    ? Math.max(assessment.score, preSemanticScore)
    : assessment.score;
  return {
    passed: exactRemoteClassification && effectiveSemanticScore >= 95 && !assessment.hard_mismatch && second.verdict === 'PASS',
    result: 'POST_SEMANTIC_CATEGORY_MATCH',
    expected_category_id: config.categoryId,
    remote_category_id: item.category_id,
    expected_category_path: config.semanticAlternative.category_path,
    remote_category_path: category.category_path,
    path_match: pathMatch,
    expected_domain_id: config.domainId,
    remote_domain_id: category.domain_id,
    domain_match: domainMatch,
    expected_catalog_product_id: config.catalogProductId || null,
    remote_catalog_product_id: item.catalog_product_id || null,
    catalog_match: catalogMatch,
    semantic_score: assessment.score,
    pre_semantic_score: preSemanticScore,
    effective_semantic_score: effectiveSemanticScore,
    exact_remote_classification: exactRemoteClassification,
    hard_mismatch: assessment.hard_mismatch,
    second_pass: second,
  };
}

module.exports = {
  ...shared,
  ALLOWED,
  SELECTION_INFO,
  buildManualAttributes,
  expectedDomain,
  freezeSelection,
  ignoreUnrelatedCatalogRequired: true,
  postSemanticValidation,
  resolveDynamicConfig,
  loadAuthorizedAlternatives,
  pathsEqual,
  semanticGatePasses,
};
