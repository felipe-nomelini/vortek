const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const AUDIT_CSV = path.resolve(process.env.EVOLUSOM_AUDIT_CSV || '');
const EXPECTED_COUNT = Math.max(1, Number(process.env.EVOLUSOM_EXPECTED_APT_COUNT || '164'));
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '10'));
const IMAGE_CONCURRENCY = Math.max(1, Number(process.env.ML_IMAGE_CONCURRENCY || '4'));
const SUPPLIER_ID = '133';
const BUCKET = 'product-images';
const VORTEK_IMAGE_PREFIX = 'https://supabase.vortek.shop/storage/v1/object/public/product-images/';
const PUBLICATION_CORRECTIONS = new Map([
  ['VTK017331', {
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788222', value_name: 'VGA' }],
  }],
  ['VTK017456', {
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788220', value_name: 'RCA' }],
  }],
  ['VTK017781', {
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788220', value_name: 'RCA' }],
  }],
  ['VTK017959', {
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788220', value_name: 'RCA' }],
  }],
  ['VTK018069', {
    categoryId: 'MLB235632',
    categoryName: 'Abraçadeiras',
    attributes: [
      { id: 'BRAND', value_name: 'Ferragens FTTH' },
      { id: 'MODEL', value_name: 'BAP 3' },
    ],
  }],
  ['VTK018851', {
    categoryId: 'MLB45256',
    categoryName: 'Antenas',
    attributes: [{ id: 'VEHICLE_TYPE', value_id: '11377043', value_name: 'Carro/Caminhonete' }],
  }],
  ['VTK018865', {
    attributes: [{ id: 'VEHICLE_TYPE', value_id: '11377043', value_name: 'Carro/Caminhonete' }],
  }],
  ['VTK019484', {
    attributes: [
      { id: 'CABLE_AND_ADAPTER_TYPE', value_id: '16874774', value_name: 'Audio Video e Informática' },
      { id: 'CABLE_LENGTH', value_name: '100 m' },
    ],
  }],
]);

if (!process.env.EVOLUSOM_AUDIT_CSV || !fs.existsSync(AUDIT_CSV)) {
  throw new Error('Defina EVOLUSOM_AUDIT_CSV com o CSV auditado da Evolusom.');
}

const OUTPUT_ROOT = path.resolve(
  process.env.EVOLUSOM_BATCH_OUTPUT_DIR || path.join(path.dirname(AUDIT_CSV), 'publicacao-tradicional'),
);
const MANIFEST_DIR = path.join(OUTPUT_ROOT, 'approved');

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function positive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function readApprovedAuditRows() {
  const workbook = XLSX.readFile(AUDIT_CSV, { raw: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  return rows.filter((row) => String(row.Resultado || '').trim() === 'APTO');
}

async function selectInChunks(table, columns, filterColumn, values, configure) {
  const rows = [];
  for (const group of chunks(values, 100)) {
    let query = supabase.from(table).select(columns).in(filterColumn, group);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
}

function directSupplierUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  if (parsed.hostname === 'evolusom.com.br') parsed.hostname = 'www.evolusom.com.br';
  return parsed.toString();
}

async function validatePublicImage(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Vortek/1.0 product-image-audit' },
  });
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim();
  if (response.status !== 200 || !contentType.startsWith('image/')) {
    throw new Error(`URL pública inválida HTTP ${response.status}`);
  }
}

async function mirrorImage(product, sourceUrl, imageIndex) {
  if (sourceUrl.startsWith(VORTEK_IMAGE_PREFIX)) {
    await validatePublicImage(sourceUrl);
    return sourceUrl;
  }

  const response = await fetch(directSupplierUrl(sourceUrl), {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Vortek/1.0 product-image-audit' },
  });
  if (!response.ok) throw new Error(`origem HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) throw new Error(`content-type ${contentType || 'ausente'}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    throw new Error(`tamanho inválido ${buffer.length}`);
  }
  const metadata = await sharp(buffer).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 250 ||
    metadata.height < 250 ||
    Math.max(metadata.width, metadata.height) <= 500
  ) {
    throw new Error(`dimensões insuficientes ${metadata.width || 0}x${metadata.height || 0}`);
  }

  const normalized = await sharp(buffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const hash = crypto
    .createHash('sha256')
    .update(sourceUrl)
    .update(normalized)
    .digest('hex')
    .slice(0, 20);
  const objectPath = `catalog/evolusom/${product.sku}/${String(imageIndex + 1).padStart(2, '0')}-${hash}.jpg`;
  const upload = await supabase.storage.from(BUCKET).upload(objectPath, normalized, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (upload.error && !/already exists/i.test(upload.error.message || '')) {
    throw new Error(`upload: ${upload.error.message}`);
  }
  const publicUrl = `${VORTEK_IMAGE_PREFIX}${objectPath}`;
  await validatePublicImage(publicUrl);
  return publicUrl;
}

async function prepareProductImages(product) {
  const sourceImages = Array.isArray(product.imagens)
    ? product.imagens.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 12)
    : [];
  const outcomes = await mapConcurrent(
    sourceImages,
    Math.min(3, IMAGE_CONCURRENCY),
    async (sourceUrl, imageIndex) => {
      try {
        return { ok: true, sourceUrl, publicUrl: await mirrorImage(product, sourceUrl, imageIndex) };
      } catch (error) {
        return { ok: false, sourceUrl, error: error.message };
      }
    },
  );
  const publicUrls = outcomes.filter((row) => row.ok).map((row) => row.publicUrl);
  if (publicUrls.length === 0) {
    return { ok: false, reason: 'nenhuma_imagem_publica_valida', outcomes };
  }

  if (JSON.stringify(publicUrls) !== JSON.stringify(sourceImages)) {
    const { error } = await supabase.from('produtos').update({ imagens: publicUrls }).eq('id', product.id);
    if (error) return { ok: false, reason: `falha_atualizar_imagens: ${error.message}`, outcomes };
  }
  return { ok: true, publicUrls, outcomes };
}

function pricingStrategy(cost) {
  if (cost <= 400) return { margin: 0.15, minProfit: 20 };
  if (cost <= 1000) return { margin: 0.2, minProfit: 60 };
  return { margin: 0.25, minProfit: 150 };
}

function suggestedPricePreview(product) {
  const cost = Number(product.custo || 0);
  const shipping = Number(product.ml_shipping || 0);
  const fee = Number(product.ml_fee || 0.15);
  const strategy = pricingStrategy(cost);
  const denominator = 1 - (0.04 + fee);
  return round2(Math.max(
    (cost + shipping + cost * strategy.margin) / denominator,
    (cost + shipping + strategy.minProfit) / denominator,
  ));
}

function manifestItem(product, auditRow, supportsEmptyGtinReason) {
  const correction = PUBLICATION_CORRECTIONS.get(String(product.sku)) || {};
  const withoutGtin = /sem GTIN/i.test(String(auditRow['Modalidade segura'] || ''));
  const preflight = {
    strictEvidence: true,
    validatedGtin: withoutGtin ? '' : digits(product.gtin),
    validatedNcm: digits(product.ncm),
    imagesOnVortekStorage: true,
    categoryAndConditionalAttributes: 'validated_in_audit_and_required_at_execution',
    traditionalOnly: true,
  };
  if (withoutGtin && supportsEmptyGtinReason) {
    preflight.omitGtin = true;
    preflight.emptyGtinReason = {
      value_id: '17055160',
      value_name: 'O produto não tem código cadastrado',
    };
  }

  return {
    produtoId: String(product.id),
    sku: String(product.sku),
    nome: String(product.nome),
    fornecedor: 'EVOLUSOM-PR',
    dsliteFornecedorId: SUPPLIER_ID,
    custo: round2(product.custo),
    estoque: Number(product.estoque || 0),
    mlFee: Number(product.ml_fee || 0.15),
    mlShipping: round2(product.ml_shipping),
    customPrice: product.custom_price == null ? null : round2(product.custom_price),
    suggestedPricePreview: suggestedPricePreview(product),
    priceSource: product.custom_price == null ? 'pricing_strategy_preview' : 'custom_price',
    pricingStrategy: pricingStrategy(Number(product.custo || 0)),
    categoryId: correction.categoryId || String(auditRow['Categoria ML'] || '').trim(),
    ...(Array.isArray(correction.attributes) ? { attributeOverrides: correction.attributes } : {}),
    catalogEvidence: {
      source: 'evolusom_audit_2026_08_04_traditional_only',
      categoryName: correction.categoryName || String(auditRow['Nome categoria'] || '').trim(),
      originalAuditMode: String(auditRow['Modalidade segura'] || '').trim(),
    },
    preflight,
  };
}

async function main() {
  const auditRows = readApprovedAuditRows();
  if (auditRows.length !== EXPECTED_COUNT) {
    throw new Error(`CSV contém ${auditRows.length} aptos; esperado ${EXPECTED_COUNT}.`);
  }

  const skus = auditRows.map((row) => String(row['SKU Vortek'] || '').trim());
  const products = await selectInChunks('produtos', '*', 'sku', skus);
  const productsBySku = new Map(products.map((product) => [String(product.sku), product]));
  const productIds = products.map((product) => String(product.id));
  const offers = await selectInChunks(
    'produto_fornecedor_ofertas',
    'id,produto_id,dslite_fornecedor_id,ativo,estoque,custo',
    'produto_id',
    productIds,
    (query) => query.eq('dslite_fornecedor_id', SUPPLIER_ID),
  );
  const listings = await selectInChunks(
    'anuncios_ml',
    'produto_id,ml_item_id,status,catalogo',
    'produto_id',
    productIds,
    (query) => query.not('ml_item_id', 'is', null),
  );
  const listedProductIds = new Set(
    listings.filter((row) => hasText(row.ml_item_id)).map((row) => String(row.produto_id)),
  );
  const categoriesWithEmptyGtinReason = new Set();
  const noGtinCategories = Array.from(new Set(
    auditRows
      .filter((row) => /sem GTIN/i.test(String(row['Modalidade segura'] || '')))
      .map((row) => String(row['Categoria ML'] || '').trim())
      .filter(Boolean),
  ));
  await mapConcurrent(noGtinCategories, IMAGE_CONCURRENCY, async (categoryId) => {
    const response = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}/attributes`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Categoria ${categoryId}: HTTP ${response.status}`);
    const attributes = await response.json();
    if (Array.isArray(attributes) && attributes.some((attribute) =>
      attribute?.id === 'EMPTY_GTIN_REASON' &&
      Array.isArray(attribute?.values) &&
      attribute.values.some((value) => String(value?.id) === '17055160'))) {
      categoriesWithEmptyGtinReason.add(categoryId);
    }
  });

  const blocked = [];
  const candidates = [];
  for (const auditRow of auditRows) {
    const sku = String(auditRow['SKU Vortek'] || '').trim();
    const product = productsBySku.get(sku);
    const offer = product && offers.find((row) =>
      String(row.produto_id) === String(product.id) && row.ativo && positive(row.estoque) && positive(row.custo));
    let reason = null;
    if (!product) reason = 'produto_ausente';
    else if (product.ativo === false) reason = 'produto_inativo';
    else if (hasText(product.ml_item_id) || listedProductIds.has(String(product.id))) reason = 'ja_anunciado';
    else if (!offer) reason = 'oferta_evolusom_inativa_ou_sem_estoque';
    else if (!positive(product.custo) || !positive(product.estoque)) reason = 'custo_ou_estoque_preferencial_invalido';
    else if (!hasText(auditRow['Categoria ML'])) reason = 'categoria_ml_ausente';
    if (reason) blocked.push({ sku, reason });
    else candidates.push({ product, auditRow });
  }

  const imageResults = await mapConcurrent(candidates, IMAGE_CONCURRENCY, async ({ product, auditRow }) => ({
    product,
    auditRow,
    imageResult: await prepareProductImages(product),
  }));

  const ready = [];
  for (const row of imageResults) {
    if (!row.imageResult.ok) {
      blocked.push({ sku: row.product.sku, reason: row.imageResult.reason, images: row.imageResult.outcomes });
      continue;
    }
    ready.push(manifestItem(
      { ...row.product, imagens: row.imageResult.publicUrls },
      row.auditRow,
      categoriesWithEmptyGtinReason.has(String(row.auditRow['Categoria ML'] || '').trim()),
    ));
  }

  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  for (const fileName of fs.readdirSync(MANIFEST_DIR)) {
    if (/^\d{3}-evolusom-remaining-\d{3}\.json$/.test(fileName)) {
      fs.unlinkSync(path.join(MANIFEST_DIR, fileName));
    }
  }
  chunks(ready, BATCH_SIZE).forEach((items, index) => {
    const batchNumber = index + 1;
    const fileName = `${String(batchNumber).padStart(3, '0')}-evolusom-remaining-${String(batchNumber).padStart(3, '0')}.json`;
    fs.writeFileSync(path.join(MANIFEST_DIR, fileName), JSON.stringify({
      batchNumber,
      batchId: `evolusom-audit-traditional-${String(batchNumber).padStart(3, '0')}`,
      strategy: 'strict_evidence_traditional_only',
      executionHints: {
        listingType: 'gold_pro',
        createSequentially: true,
        catalogListing: false,
        verifyAfterEachBatch: true,
      },
      items,
    }, null, 2));
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    auditCsv: AUDIT_CSV,
    expectedCount: EXPECTED_COUNT,
    auditApprovedCount: auditRows.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    batchSize: BATCH_SIZE,
    batchCount: Math.ceil(ready.length / BATCH_SIZE),
    traditionalOnly: true,
    catalogListingsRequested: 0,
    manifestDir: MANIFEST_DIR,
  };
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'blocked-items.json'), JSON.stringify(blocked, null, 2));
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'approved-items.json'), JSON.stringify(ready, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  if (blocked.length > 0 || ready.length !== EXPECTED_COUNT) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
