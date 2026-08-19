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

const TARGET_SIZE = 200;
const BLOCKED_STATES = new Set([
  'BLOCK_IDENTITY', 'BLOCK_GTIN', 'BLOCK_GTIN_BRAND', 'BLOCK_GTIN_BRAND_CONFLICT',
  'BLOCK_GTIN_MODEL', 'BLOCK_GTIN_MODEL_CONFLICT', 'BLOCK_GTIN_UNIT',
  'BLOCK_GTIN_UNIT_CONFLICT', 'BLOCK_LOCAL_DUPLICATE', 'BLOCK_REMOTE_DUPLICATE',
  'BLOCK_CATEGORY', 'BLOCK_CATALOG_IDENTITY', 'BLOCK_REQUIRED_ATTRIBUTE',
  'BLOCK_REQUIRED_ATTRIBUTE_EVIDENCE', 'BLOCK_ATTRIBUTE_EVIDENCE', 'BLOCK_IMAGE',
  'BLOCK_API_CONTRACT', 'BLOCK_PROTECTIVE_PRICE', 'BLOCK_PROTECTIVE_PRICE_ENGINE',
  'SOURCE_DEFERRED', 'SKIPPED_KNOWN_BLOCK', 'MANUAL_IDENTITY', 'MANUAL_GTIN',
  'MANUAL_TECH', 'MANUAL_IMAGE', 'CATEGORY_MISMATCH',
]);
const REMOTE_LINK_STATES = new Set(['LINK_EXISTING', 'BLOCK_DUPLICATE', 'MANUAL_LINK_REVIEW']);
const SUCCESS_STATES = new Set(['SAFE_PUBLICATION_PERSIST_SUCCESS', 'ALREADY_CONSISTENT']);

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function csvLine(values) {
  return values.map(csvCell).join(',');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows.filter((entry) => entry.some(Boolean));
  return body.map((entry) => Object.fromEntries(header.map((key, index) => [key, entry[index] ?? ''])));
}

function walk(root, filename, found = []) {
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) walk(target, filename, found);
    else if (entry.name === filename) found.push(target);
  }
  return found;
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function collectHistoricalLedger(reportsRoot) {
  const ledger = new Map();
  const remoteLinks = new Map();
  const record = (sku, state, source, evidence = null) => {
    if (!sku || !state) return;
    ledger.set(String(sku), { sku: String(sku), state: String(state), source, evidence });
  };

  // Sanitation files are the oldest baseline. Later phase summaries overwrite them.
  for (const file of walk(reportsRoot, 'sanitation-queue.csv')) {
    for (const row of parseCsv(fs.readFileSync(file, 'utf8'))) {
      record(row.sku, row.gate || row.state, path.relative(reportsRoot, file), row.evidence || null);
    }
  }

  const phase3 = readJson(path.join(reportsRoot, 'ml-p0-phase3', 'full-report.json'));
  for (const row of phase3?.candidates || []) {
    record(row.sku, row.recommended_action, 'ml-p0-phase3/full-report.json');
    if (REMOTE_LINK_STATES.has(row.recommended_action)) {
      remoteLinks.set(row.sku, { sku: row.sku, state: row.recommended_action, source: 'phase3', item_ids: (row.remote_matches || []).map((match) => match.item?.item_id).filter(Boolean) });
    }
  }

  const phase5a = readJson(path.join(reportsRoot, 'ml-p0-phase5a', 'summary.json'));
  for (const row of phase5a?.results || []) record(row.sku, row.state, 'ml-p0-phase5a/summary.json', row.blocking_reason || null);

  for (const phase of ['6a', '6b', '6c', '6d']) {
    const dir = path.join(reportsRoot, `ml-p0-phase${phase}`);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const summary = readJson(path.join(dir, entry.name, 'summary.json'));
      if (!summary) continue;
      record(summary.sku || entry.name, summary.result || summary.state, `ml-p0-phase${phase}/${entry.name}/summary.json`, summary.observation || null);
    }
  }
  return { ledger, remoteLinks };
}

function localIdentityConfidence(product) {
  return Number(Boolean(product.marca)) * 35
    + Number(Boolean(product.nome)) * 30
    + Number(Boolean(product.descricao)) * 20
    + Number(Array.isArray(product.imagens) && product.imagens.length > 0) * 15;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function prepareSelection({ allProducts, allOffers, reportsRoot, reportDir }) {
  const selectedFile = path.join(reportDir, 'selected-200.csv');
  const freezeFile = path.join(reportDir, 'selection-freeze.json');
  const { ledger, remoteLinks } = collectHistoricalLedger(reportsRoot);
  const offers = new Map(allOffers.map((row) => [row.id, row]));

  if (fs.existsSync(selectedFile) && fs.existsSync(freezeFile)) {
    const contents = fs.readFileSync(selectedFile, 'utf8');
    const freeze = readJson(freezeFile);
    if (sha256(contents) !== freeze.sha256) throw new Error('ABORT_SELECTION_FREEZE_HASH_DRIFT');
    const bySku = new Map(allProducts.map((row) => [row.sku, row]));
    const selected = parseCsv(contents).map((row) => {
      const product = bySku.get(row.sku);
      if (!product || product.id !== row.produto_id) throw new Error(`ABORT_SELECTION_PRODUCT_DRIFT:${row.sku}`);
      return { sku: row.sku, gtin: row.gtin || '', requestedName: row.nome, decision: 'PASS', frozenProductId: row.produto_id };
    });
    return { selected, exclusions: readJson(path.join(reportDir, 'selection-exclusions.json'))?.rows || [], freeze, resumed: true, ledger, remoteLinks };
  }

  const raw = allProducts.filter((row) => row.ativo === true && Number(row.estoque) > 0 && row.ml_item_id == null);
  const exclusions = [];
  const candidates = [];
  for (const product of raw) {
    const historical = ledger.get(product.sku);
    const preferredOffer = offers.get(product.oferta_preferencial_id);
    let reason = null;
    let evidence = null;
    if (product.sku === 'VTK017508') { reason = 'EXCLUDED_VTK017508'; evidence = 'MLB7432501874 REMOTE_PROPAGATION_PENDING'; }
    else if (historical && BLOCKED_STATES.has(historical.state)) { reason = 'EXCLUDED_BY_HISTORICAL_LEDGER'; evidence = `${historical.state}:${historical.source}`; }
    else if (remoteLinks.has(product.sku)) { reason = 'REMOTE_LINK_REVIEW'; evidence = JSON.stringify(remoteLinks.get(product.sku)); }
    else if (!(Number(product.custo) > 0)) { reason = 'EXCLUDED_LOCAL_COST'; evidence = product.custo; }
    else if (!preferredOffer || preferredOffer.ativo !== true) { reason = 'EXCLUDED_NO_ACTIVE_PREFERRED_OFFER'; evidence = product.oferta_preferencial_id; }
    if (reason) exclusions.push({ sku: product.sku, produto_id: product.id, reason, evidence });
    else candidates.push({ product, preferredOffer, identityConfidence: localIdentityConfidence(product) });
  }
  candidates.sort((left, right) => Number(Boolean(normalizeGtin(right.product.gtin))) - Number(Boolean(normalizeGtin(left.product.gtin)))
    || Number(right.product.estoque) - Number(left.product.estoque)
    || right.identityConfidence - left.identityConfidence
    || left.product.sku.localeCompare(right.product.sku));
  const chosen = candidates.slice(0, TARGET_SIZE);
  const header = ['ordinal', 'sku', 'produto_id', 'nome', 'marca', 'estoque', 'custo', 'gtin', 'fornecedor', 'oferta_preferencial', 'motivo_de_elegibilidade'];
  const rows = chosen.map(({ product, preferredOffer }, index) => [index + 1, product.sku, product.id, product.nome, product.marca, product.estoque, product.custo, product.gtin || '', preferredOffer.fornecedor_nome || product.fornecedor || '', preferredOffer.id, 'ativo+estoque+custo+oferta+sem_vinculo+sem_bloqueio_historico']);
  const contents = `${[csvLine(header), ...rows.map(csvLine)].join('\n')}\n`;
  fs.writeFileSync(selectedFile, contents);
  fs.writeFileSync(path.join(reportDir, 'selection-exclusions.csv'), `${[csvLine(['sku', 'produto_id', 'motivo', 'evidencia']), ...exclusions.map((row) => csvLine([row.sku, row.produto_id, row.reason, row.evidence]))].join('\n')}\n`);
  fs.writeFileSync(path.join(reportDir, 'selection-exclusions.json'), `${JSON.stringify({ rows: exclusions }, null, 2)}\n`);
  const freeze = {
    generated_at: new Date().toISOString(), raw_universe: raw.length, historical_ledger_entries: ledger.size,
    exclusions: exclusions.length, remaining_candidates: candidates.length, selected: chosen.length,
    target: TARGET_SIZE, eligible_count_below_target: chosen.length < TARGET_SIZE,
    with_gtin: chosen.filter((row) => normalizeGtin(row.product.gtin)).length,
    without_gtin: chosen.filter((row) => !normalizeGtin(row.product.gtin)).length,
    sha256: sha256(contents), file: 'selected-200.csv',
  };
  fs.writeFileSync(freezeFile, `${JSON.stringify(freeze, null, 2)}\n`);
  return {
    selected: chosen.map(({ product }) => ({ sku: product.sku, gtin: product.gtin || '', requestedName: product.nome, decision: 'PASS', frozenProductId: product.id })),
    exclusions, freeze, resumed: false, ledger, remoteLinks,
  };
}

function values(entity, id) {
  const row = (entity?.attributes || []).find((attribute) => attribute.id === id);
  if (!row) return [];
  return [...new Set([row.value_name, ...(row.values || []).map((value) => value.name)].filter(Boolean).map(String))];
}

function brandMatches(localBrand, catalogBrand) {
  const local = normalize(localBrand);
  const catalog = normalize(catalogBrand);
  return Boolean(local && catalog && (local === catalog || (Math.min(local.length, catalog.length) >= 5 && (local.includes(catalog) || catalog.includes(local)))));
}

function extractPackCount(text) {
  const source = String(text || '');
  const patterns = [
    /\b(?:kit|pct|pacote|cart(?:ela)?|caixa|cx|c\/|com)\s*(?:de\s*)?(\d{1,3})\b/i,
    /\b(\d{1,3})\s*(?:unidades|unid|un\.|pe[cç]as|pcs)\b/i,
    /\b(\d{1,3})\s*[x×]\s*\d/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function catalogPackCount(result) {
  for (const id of ['UNITS_PER_PACK', 'UNITS_PER_PACKAGE', 'PACKAGE_QUANTITY', 'PIECES_PER_PACKAGE', 'UNITS_NUMBER']) {
    const found = values(result, id).map(Number).find(Number.isFinite);
    if (found != null) return found;
  }
  return null;
}

function explicitVoltages(text) {
  return [...new Set([...String(text || '').matchAll(/\b(110|127|220|240)\s*v\b/gi)].map((match) => Number(match[1])))];
}

function catalogVoltages(result) {
  return [...new Set((result?.attributes || []).filter((row) => /VOLTAGE/.test(row.id)).flatMap((row) => [row.value_name, ...(row.values || []).map((value) => value.name)]).flatMap((value) => explicitVoltages(value)))];
}

const COLORS = ['preto', 'branco', 'vermelho', 'verde', 'azul', 'amarelo', 'rosa', 'pink', 'cinza', 'grafite', 'natural', 'marrom', 'laranja', 'roxo', 'prata', 'dourado', 'ciano'];
function explicitColors(text) {
  const source = normalize(text);
  return COLORS.filter((color) => source.includes(normalize(color)));
}

function modelIsUseful(model) {
  const value = normalize(model);
  return value.length >= 3 && !['naoseaplica', 'seminformacao', 'desconhecido', 'generico', 'modelo'].includes(value);
}

function identityAssessment(product, offer, result, gtin) {
  const corpus = `${product.nome || ''} ${product.descricao || ''} ${offer?.nome || ''} ${offer?.descricao || ''}`;
  const catalogBrand = attributeValue(result, 'BRAND');
  const model = attributeValue(result, 'MODEL');
  const localPack = extractPackCount(corpus);
  const remotePack = catalogPackCount(result);
  const localVolts = explicitVoltages(corpus);
  const remoteVolts = catalogVoltages(result);
  const localColors = explicitColors(corpus);
  const remoteColors = explicitColors(values(result, 'COLOR').join(' '));
  const conflicts = [];
  if (normalizeGtin(attributeValue(result, 'GTIN')) !== normalizeGtin(gtin)) conflicts.push('GTIN');
  if (!brandMatches(product.marca, catalogBrand)) conflicts.push('BRAND');
  if (localPack != null && remotePack != null && localPack !== remotePack) conflicts.push('UNIT');
  if (localVolts.length && remoteVolts.length && !localVolts.every((voltage) => remoteVolts.includes(voltage))) conflicts.push('VOLTAGE');
  if (localColors.length && remoteColors.length && !localColors.some((color) => remoteColors.includes(color))) conflicts.push('COLOR');
  if (modelIsUseful(model) && !normalize(corpus).includes(normalize(model))) conflicts.push('MODEL');

  const localBatterySizes = ['aaa', 'aa', 'c', 'd'].filter((size) => new RegExp(`(^|[^a-z])${size}([^a-z]|$)`, 'i').test(corpus));
  const remoteBatterySizes = values(result, 'CELL_BATTERY_SIZE').map((value) => normalize(value));
  if (localBatterySizes.length && remoteBatterySizes.length && !localBatterySizes.some((size) => remoteBatterySizes.includes(normalize(size)))) conflicts.push('BATTERY_SIZE');
  const compositionMap = [['alcalina', 'alcalina'], ['litio', 'litio'], ['nimh', 'nimh']];
  const localComposition = compositionMap.find(([needle]) => normalize(corpus).includes(needle))?.[1];
  const remoteComposition = normalize(values(result, 'CELL_BATTERY_COMPOSITION').join(' '));
  if (localComposition && remoteComposition && !remoteComposition.includes(localComposition)) conflicts.push('COMPOSITION');

  const titleWords = new Set(normalizeWords(result?.name));
  const localWords = new Set(normalizeWords(product.nome));
  const overlap = [...titleWords].filter((word) => localWords.has(word)).length;
  const similarity = titleWords.size ? overlap / titleWords.size : 0;
  if (!modelIsUseful(model) && similarity < 0.35) conflicts.push('TITLE_IDENTITY');
  return { passed: conflicts.length === 0, conflicts, catalog_brand: catalogBrand, model, local_pack: localPack, catalog_pack: remotePack, local_voltages: localVolts, catalog_voltages: remoteVolts, local_colors: localColors, catalog_colors: remoteColors, title_similarity: similarity };
}

function normalizeWords(text) {
  const stop = new Set(['para', 'com', 'sem', 'kit', 'produto', 'de', 'da', 'do', 'e', 'em', 'the']);
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !stop.has(word));
}

function blockForAssessment(assessment) {
  if (assessment.conflicts.includes('BRAND')) return { decision: 'BLOCK_GTIN_BRAND_CONFLICT', sanitation: 'GTIN_FIX_REQUIRED' };
  if (assessment.conflicts.includes('MODEL')) return { decision: 'BLOCK_GTIN_MODEL_CONFLICT', sanitation: 'GTIN_FIX_REQUIRED' };
  if (assessment.conflicts.includes('UNIT')) return { decision: 'BLOCK_GTIN_UNIT_CONFLICT', sanitation: 'GTIN_FIX_REQUIRED' };
  return { decision: 'BLOCK_IDENTITY', sanitation: 'IDENTITY_FIX_REQUIRED' };
}

function categorySemanticAssessment({ product, dslite, catalog, category }) {
  const localCategory = dslite?.product?.categoria_nome || product.categoria || '';
  const local = normalize(`${localCategory} ${product.nome || ''} ${product.descricao || ''}`);
  const remotePath = (category?.path_from_root || []).map((row) => row.name).join(' > ');
  const remote = normalize(`${catalog?.domain_id || ''} ${category?.settings?.catalog_domain || ''} ${remotePath} ${category?.name || ''}`);
  const conflicts = [];

  // A GTIN catalog record can be community-authored and live in the wrong domain.
  // Strongly incompatible verticals must never be accepted merely because the
  // domain-discovery response and the catalog record agree with each other.
  const localVehicle = /veicul|automotiv|somautomotivo/.test(local);
  const remoteComputingPart = /tablet|informatica|computador|notebook|internal_speaker/.test(remote);
  if (localVehicle && remoteComputingPart) conflicts.push('LOCAL_VEHICLE_REMOTE_COMPUTING');

  const remoteTabletSpeaker = /tablet.*altofalante|tablet_internal_speaker/.test(remote);
  const professionalSpeaker = /altofalante/.test(local)
    && (/(?:^|\D)1[0258](?:\D|$).*pol|1500w|rms|subgrave|bobina.*100mm/.test(local)
      || Number(product.largura) >= 30
      || Number(product.peso_bruto || product.peso_liq) >= 5);
  if (remoteTabletSpeaker && professionalSpeaker) conflicts.push('PROFESSIONAL_SPEAKER_REMOTE_TABLET_PART');

  return {
    passed: conflicts.length === 0,
    conflicts,
    local_category: localCategory,
    remote_domain: category?.settings?.catalog_domain || catalog?.domain_id || null,
    remote_path: remotePath,
  };
}

async function resolveDynamicConfig({ config, product, offer, dslite, exactResults, ml }) {
  if (!normalizeGtin(config.gtin)) {
    return { decision: 'SOURCE_DEFERRED', reason: 'GTIN absence is not a product failure; this SKU has no prior official identity proof sufficient for automatic publication', sanitation: 'IDENTITY_FIX_REQUIRED', source: 'local + DSLite supplier; official identity unresolved' };
  }
  if (!exactResults.length) {
    return { decision: 'SOURCE_DEFERRED', reason: 'exact GTIN lookup completed without an ML catalog identity; supplier evidence alone is insufficient for automatic category/model approval', sanitation: 'IDENTITY_FIX_REQUIRED', source: 'DSLite supplier + exact ML GTIN lookup' };
  }
  const assessed = exactResults.map((result) => ({ result, assessment: identityAssessment(product, offer, result, config.gtin) }));
  const passed = assessed.filter((row) => row.assessment.passed).sort((left, right) => right.assessment.title_similarity - left.assessment.title_similarity);
  if (!passed.length) {
    const strongest = assessed.sort((left, right) => left.assessment.conflicts.length - right.assessment.conflicts.length)[0];
    return { ...blockForAssessment(strongest.assessment), reason: `exact GTIN catalog identity conflict: ${strongest.assessment.conflicts.join(',')}`, foundValue: strongest.result.id, source: `ML catalog ${strongest.result.id} + DSLite supplier`, identityAssessment: strongest.assessment };
  }
  if (passed.length > 1 && Math.abs(passed[0].assessment.title_similarity - passed[1].assessment.title_similarity) < 0.15) {
    return { decision: 'SOURCE_DEFERRED', reason: 'multiple exact-GTIN catalog identities remain materially plausible', sanitation: 'CATALOG_REVIEW_REQUIRED', source: 'ML exact GTIN search + DSLite supplier' };
  }
  const chosen = passed[0];
  const discovery = await ml(`/sites/MLB/domain_discovery/search?q=${encodeURIComponent(product.nome)}`);
  if (!discovery.ok) return { decision: 'SOURCE_DEFERRED', reason: `category discovery HTTP ${discovery.status}`, sanitation: 'CATEGORY_FIX_REQUIRED', source: `ML catalog ${chosen.result.id} + DSLite supplier` };
  const matching = (discovery.data || []).filter((row) => row.domain_id === chosen.result.domain_id);
  const categories = [...new Set(matching.map((row) => row.category_id).filter(Boolean))];
  if (categories.length !== 1) return { decision: 'BLOCK_CATEGORY', reason: `category confidence is not HIGH for domain ${chosen.result.domain_id}`, sanitation: 'CATEGORY_FIX_REQUIRED', source: `ML catalog ${chosen.result.id} + domain discovery` };
  const categoryResponse = await ml(`/categories/${categories[0]}`);
  if (!categoryResponse.ok) return { decision: 'SOURCE_DEFERRED', reason: `category contract HTTP ${categoryResponse.status}`, sanitation: 'CATEGORY_FIX_REQUIRED', source: `ML category ${categories[0]}` };
  const categoryAssessment = categorySemanticAssessment({ product, dslite, catalog: chosen.result, category: categoryResponse.data });
  if (!categoryAssessment.passed) {
    return {
      decision: 'BLOCK_CATEGORY',
      reason: `category semantic conflict: ${categoryAssessment.conflicts.join(',')}`,
      sanitation: 'CATEGORY_FIX_REQUIRED',
      source: `ML catalog ${chosen.result.id} + category ${categories[0]} + DSLite supplier`,
      categoryAssessment,
    };
  }
  const model = chosen.assessment.model;
  const catalogRequired = chosen.result.settings?.listing_strategy === 'catalog_required';
  const familyName = String(chosen.result.name || `${chosen.assessment.catalog_brand} ${model || product.nome}`).slice(0, 60).trim();
  const catalogTitleAliases = [chosen.assessment.catalog_brand, ...(modelIsUseful(model) ? [model] : [])].filter(Boolean);
  return {
    decision: 'PASS', brand: chosen.assessment.catalog_brand, modelAliases: modelIsUseful(model) ? [model] : [],
    catalogProductId: catalogRequired ? chosen.result.id : null, catalogEvidenceId: chosen.result.id,
    categoryId: categories[0], domainId: chosen.result.domain_id, familyName,
    catalogTitleAliases, critical: {}, catalogEvidence: chosen.result,
    source: `ML exact GTIN catalog ${chosen.result.id} + DSLite supplier ${dslite?.url || ''}`.trim(),
    sourceConfidence: 'ML_catalog_and_supplier', identityAssessment: chosen.assessment, categoryAssessment,
  };
}

function buildManualAttributes(config, categoryAttributes, sku) {
  return buildCatalogAttributes(config.catalogEvidence, categoryAttributes, sku);
}

module.exports = {
  ...shared,
  ALLOWED: [],
  BLOCKED_STATES,
  REMOTE_LINK_STATES,
  SUCCESS_STATES,
  TARGET_SIZE,
  buildManualAttributes,
  collectHistoricalLedger,
  categorySemanticAssessment,
  identityAssessment,
  parseCsv,
  prepareSelection,
  resolveDynamicConfig,
  sha256,
};
