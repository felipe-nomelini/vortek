const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const SUPPLIER_ID = '133';
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '10'));
const IMAGE_CONCURRENCY = Math.max(1, Number(process.env.ML_IMAGE_CONCURRENCY || '4'));
const APPLY_IMAGE_MIRROR = process.argv.includes('--mirror-images');
const BUCKET = 'product-images';
const VORTEK_IMAGE_PREFIX =
  'https://supabase.vortek.shop/storage/v1/object/public/product-images/';
const REPORT_ROOT = path.join(process.cwd(), 'reports', 'ml-anuncio-batches');

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

function imageList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validGtin(value) {
  const normalized = digits(value);
  if (![8, 12, 13, 14].includes(normalized.length)) return false;
  const body = normalized.slice(0, -1);
  const checkDigit = Number(normalized.at(-1));
  let sum = 0;
  for (let index = body.length - 1, weight = 3; index >= 0; index -= 1) {
    sum += Number(body[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

function validNcm(value) {
  return digits(value).length === 8;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function blockedBrand(product) {
  return /\bwahl\b/.test(normalizeText(`${product.marca || ''} ${product.nome || ''}`));
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
  if (!positive(cost) || denominator <= 0) return null;
  return round2(Math.max(
    (cost + shipping + cost * strategy.margin) / denominator,
    (cost + shipping + strategy.minProfit) / denominator,
  ));
}

async function fetchAll(loader, chunkSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += chunkSize) {
    const { data, error } = await loader(offset, offset + chunkSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < chunkSize) return rows;
  }
}

async function loadSupplierOffers() {
  return fetchAll((from, to) => supabase
    .from('produto_fornecedor_ofertas')
    .select('*,product:produtos!produto_fornecedor_ofertas_produto_id_fkey(*)')
    .eq('dslite_fornecedor_id', SUPPLIER_ID)
    .eq('ativo', true)
    .gt('estoque', 0)
    .order('produto_id', { ascending: true })
    .range(from, to));
}

async function loadListingProductIds(productIds) {
  const linked = new Set();
  for (let index = 0; index < productIds.length; index += 200) {
    const { data, error } = await supabase
      .from('anuncios_ml')
      .select('produto_id,ml_item_id')
      .in('produto_id', productIds.slice(index, index + 200));
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      if (hasText(row.ml_item_id)) linked.add(String(row.produto_id));
    }
  }
  return linked;
}

async function loadListedGtins() {
  const listedProductIds = new Set();
  const anuncios = await fetchAll((from, to) => supabase
    .from('anuncios_ml')
    .select('produto_id,ml_item_id')
    .not('ml_item_id', 'is', null)
    .range(from, to));
  for (const row of anuncios) {
    if (hasText(row.ml_item_id) && hasText(row.produto_id)) {
      listedProductIds.add(String(row.produto_id));
    }
  }

  const gtins = new Map();
  const ids = Array.from(listedProductIds);
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await supabase
      .from('produtos')
      .select('id,gtin,sku')
      .in('id', ids.slice(index, index + 200));
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const gtin = digits(row.gtin);
      if (gtin) gtins.set(gtin, { produtoId: String(row.id), sku: String(row.sku || '') });
    }
  }
  return gtins;
}

function localBlockReason(product, offer, linkedProductIds, listedGtins, duplicatedCandidateGtins) {
  const productId = String(product.id || '');
  if (product.ativo === false) return 'inactive_product';
  if (String(product.ml_status || '') !== 'sem_anuncio') return 'ml_status_not_sem_anuncio';
  if (hasText(product.ml_item_id) || linkedProductIds.has(productId)) return 'already_has_listing';
  if (String(product.oferta_preferencial_id || '') !== String(offer.id || '')) {
    return 'evolusom_not_preferred';
  }
  if (!hasText(product.sku)) return 'missing_sku';
  if (!hasText(product.nome)) return 'missing_name';
  if (!hasText(product.descricao)) return 'missing_description';
  if (imageList(product.imagens).length === 0) return 'missing_images';
  if (!positive(product.custo) || !positive(product.estoque)) return 'invalid_product_cost_or_stock';
  if (!hasText(product.marca)) return 'missing_brand';
  if (blockedBrand(product)) return 'blocked_brand_wahl';
  if (!validNcm(product.ncm)) return 'invalid_ncm';
  if (!hasText(product.gtin)) return 'missing_gtin';
  if (!validGtin(product.gtin)) return 'invalid_gtin';
  if (duplicatedCandidateGtins.has(digits(product.gtin))) return 'duplicate_candidate_gtin';
  const listedGtin = listedGtins.get(digits(product.gtin));
  if (listedGtin && listedGtin.produtoId !== productId) return 'gtin_already_used_by_listing';
  if (!(positive(product.peso_bruto) || positive(product.peso_liq))) return 'missing_weight';
  if (!positive(product.altura) || !positive(product.largura) || !positive(product.profundidade)) {
    return 'missing_dimensions';
  }
  return null;
}

function directEvolusomUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  if (parsed.hostname === 'evolusom.com.br') parsed.hostname = 'www.evolusom.com.br';
  return parsed.toString();
}

async function fetchImage(sourceUrl) {
  const response = await fetch(directEvolusomUrl(sourceUrl), {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Vortek/1.0 product-image-audit' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) throw new Error(`content-type ${contentType || 'ausente'}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    throw new Error(`tamanho inválido ${buffer.length}`);
  }
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('dimensões ausentes');
  if (metadata.width < 250 || metadata.height < 250 || Math.max(metadata.width, metadata.height) <= 500) {
    throw new Error(`dimensões insuficientes ${metadata.width}x${metadata.height}`);
  }
  const normalized = await sharp(buffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return { normalized, sourceContentType: contentType, width: metadata.width, height: metadata.height };
}

async function mirrorImage(product, sourceUrl, imageIndex) {
  if (sourceUrl.startsWith(VORTEK_IMAGE_PREFIX)) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok || !String(response.headers.get('content-type') || '').startsWith('image/')) {
      throw new Error(`imagem Vortek indisponível HTTP ${response.status}`);
    }
    return {
      sourceUrl,
      publicUrl: sourceUrl,
      reused: true,
      width: null,
      height: null,
    };
  }

  if (!APPLY_IMAGE_MIRROR) throw new Error('image_mirror_required');
  const fetched = await fetchImage(sourceUrl);
  const hash = crypto
    .createHash('sha256')
    .update(sourceUrl)
    .update(fetched.normalized)
    .digest('hex')
    .slice(0, 20);
  const objectPath = `catalog/evolusom/${product.sku}/${String(imageIndex + 1).padStart(2, '0')}-${hash}.jpg`;
  const upload = await supabase.storage.from(BUCKET).upload(objectPath, fetched.normalized, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (upload.error && !/already exists/i.test(upload.error.message || '')) {
    throw new Error(`upload: ${upload.error.message}`);
  }
  // O cliente usa endpoint interno do Supabase; anúncios precisam sempre da
  // URL pública estável, acessível pelo Mercado Livre.
  const publicUrl = `${VORTEK_IMAGE_PREFIX}${objectPath}`;
  const validation = await fetch(publicUrl, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (validation.status !== 200 || !String(validation.headers.get('content-type') || '').startsWith('image/')) {
    throw new Error(`URL pública inválida HTTP ${validation.status}`);
  }
  return {
    sourceUrl,
    publicUrl,
    reused: false,
    width: fetched.width,
    height: fetched.height,
    sourceContentType: fetched.sourceContentType,
  };
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

async function prepareImages(product) {
  const sourceImages = imageList(product.imagens);
  const results = await mapConcurrent(sourceImages, Math.min(3, IMAGE_CONCURRENCY), async (url, index) => {
    try {
      return { ok: true, ...(await mirrorImage(product, url, index)) };
    } catch (error) {
      return { ok: false, sourceUrl: url, error: error.message };
    }
  });
  const publicUrls = results.filter((result) => result.ok).map((result) => result.publicUrl);
  if (publicUrls.length === 0) {
    return { ok: false, reason: APPLY_IMAGE_MIRROR ? 'no_valid_images' : 'image_mirror_required', results };
  }

  if (APPLY_IMAGE_MIRROR && JSON.stringify(publicUrls) !== JSON.stringify(sourceImages)) {
    const { error } = await supabase.from('produtos').update({ imagens: publicUrls }).eq('id', product.id);
    if (error) return { ok: false, reason: `product_image_update_failed: ${error.message}`, results };
  }
  return { ok: true, publicUrls, results };
}

function manifestItem(product) {
  return {
    produtoId: String(product.id),
    sku: String(product.sku),
    nome: String(product.nome),
    fornecedor: String(product.fornecedor || 'EVOLUSOM-PR'),
    dsliteFornecedorId: SUPPLIER_ID,
    custo: round2(product.custo),
    estoque: Number(product.estoque || 0),
    mlFee: Number(product.ml_fee || 0.15),
    mlShipping: round2(product.ml_shipping),
    customPrice: product.custom_price == null ? null : round2(product.custom_price),
    suggestedPricePreview: suggestedPricePreview(product),
    priceSource: product.custom_price == null ? 'pricing_strategy_preview' : 'custom_price',
    pricingStrategy: pricingStrategy(Number(product.custo || 0)),
    preflight: {
      strictEvidence: true,
      validatedGtin: digits(product.gtin),
      validatedNcm: digits(product.ncm),
      imagesOnVortekStorage: true,
      categoryAndConditionalAttributes: 'required_at_execution',
    },
  };
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_ROOT, `evolusom-safe-${stamp}`);
  fs.mkdirSync(reportDir, { recursive: true });

  const offers = await loadSupplierOffers();
  const byProduct = new Map();
  for (const offer of offers) {
    const productId = String(offer.produto_id || '');
    const current = byProduct.get(productId);
    if (!current || String(offer.id) === String(offer.product?.oferta_preferencial_id)) {
      byProduct.set(productId, offer);
    }
  }
  const productIds = Array.from(byProduct.keys());
  const [linkedProductIds, listedGtins] = await Promise.all([
    loadListingProductIds(productIds),
    loadListedGtins(),
  ]);
  const universe = Array.from(byProduct.values()).filter((offer) => {
    const product = offer.product;
    return product
      && product.ativo !== false
      && String(product.ml_status || '') === 'sem_anuncio'
      && !hasText(product.ml_item_id)
      && !linkedProductIds.has(String(product.id || ''));
  });
  const candidateGtinCounts = new Map();
  for (const offer of universe) {
    const gtin = digits(offer.product?.gtin);
    if (gtin) candidateGtinCounts.set(gtin, Number(candidateGtinCounts.get(gtin) || 0) + 1);
  }
  const duplicatedCandidateGtins = new Set(
    Array.from(candidateGtinCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([gtin]) => gtin),
  );

  const locallyReady = [];
  const blocked = [];
  const reasonCounts = {};
  for (const offer of universe) {
    const product = offer.product;
    if (!product) continue;
    const reason = localBlockReason(
      product,
      offer,
      linkedProductIds,
      listedGtins,
      duplicatedCandidateGtins,
    );
    if (reason) {
      blocked.push({
        produtoId: String(product.id || ''),
        sku: String(product.sku || ''),
        nome: String(product.nome || ''),
        reason,
      });
      reasonCounts[reason] = Number(reasonCounts[reason] || 0) + 1;
    } else {
      locallyReady.push({ product, offer });
    }
  }

  const imageMigrations = [];
  const ready = [];
  await mapConcurrent(locallyReady, IMAGE_CONCURRENCY, async ({ product }) => {
    const imageResult = await prepareImages(product);
    imageMigrations.push({
      produtoId: String(product.id),
      sku: String(product.sku),
      oldImages: imageList(product.imagens),
      newImages: imageResult.publicUrls || [],
      ok: imageResult.ok,
      reason: imageResult.reason || null,
      details: imageResult.results,
    });
    if (!imageResult.ok) {
      const reason = imageResult.reason || 'image_preparation_failed';
      blocked.push({
        produtoId: String(product.id),
        sku: String(product.sku),
        nome: String(product.nome),
        reason,
      });
      reasonCounts[reason] = Number(reasonCounts[reason] || 0) + 1;
      return;
    }
    ready.push(manifestItem({ ...product, imagens: imageResult.publicUrls }));
  });

  ready.sort((left, right) => {
    const category = String(left.nome).split(/\s+/).slice(0, 2).join(' ');
    const otherCategory = String(right.nome).split(/\s+/).slice(0, 2).join(' ');
    const categoryComparison = category.localeCompare(otherCategory, 'pt-BR');
    if (categoryComparison !== 0) return categoryComparison;
    if (left.custo !== right.custo) return left.custo - right.custo;
    return left.sku.localeCompare(right.sku, 'pt-BR');
  });

  const batches = chunks(ready, BATCH_SIZE);
  batches.forEach((items, index) => {
    const batchNumber = index + 1;
    const batch = {
      batchNumber,
      batchId: `evolusom-ml-create-${String(batchNumber).padStart(3, '0')}`,
      strategy: 'strict_evidence_small_batch',
      executionHints: {
        delayMs: 2000,
        listingType: 'gold_pro',
        strictEvidence: true,
        dryRunFirst: true,
        createSequentially: true,
        stopAfterConsecutiveFailures: 3,
        requireVortekStorageImages: true,
        verifyListingAfterEachCreate: true,
      },
      items,
    };
    fs.writeFileSync(
      path.join(reportDir, `${String(batchNumber).padStart(3, '0')}-evolusom-ml-create-${String(batchNumber).padStart(3, '0')}.json`),
      JSON.stringify(batch, null, 2),
    );
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    supplier: { name: 'EVOLUSOM-PR', dsliteId: SUPPLIER_ID },
    mode: APPLY_IMAGE_MIRROR ? 'mirror_images_and_prepare' : 'audit_only',
    batchSize: BATCH_SIZE,
    activeOffersWithStock: offers.length,
    distinctProductsWithStock: byProduct.size,
    candidateUniverseCount: universe.length,
    locallyReadyCount: locallyReady.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    batchCount: batches.length,
    blockedReasonCounts: reasonCounts,
    safetyRules: [
      'produto e oferta ativos com estoque',
      'Evolusom como oferta preferencial',
      'nenhum ml_item_id ou vínculo em anuncios_ml',
      'GTIN válido e não usado por outro anúncio',
      'NCM, marca, descrição, dimensões e peso presentes',
      'imagem validada e servida pelo Storage Vortek',
      'categoria e atributos condicionais obrigatoriamente revalidados na execução',
      'execução sequencial após dry-run',
    ],
    files: {
      reportDir,
      blocked: path.join(reportDir, 'blocked-items.json'),
      ready: path.join(reportDir, 'ready-items.json'),
      imageMigrations: path.join(reportDir, 'image-migrations.json'),
    },
  };

  fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportDir, 'blocked-items.json'), JSON.stringify(blocked, null, 2));
  fs.writeFileSync(path.join(reportDir, 'ready-items.json'), JSON.stringify(ready, null, 2));
  fs.writeFileSync(path.join(reportDir, 'image-migrations.json'), JSON.stringify(imageMigrations, null, 2));
  fs.writeFileSync(path.join(REPORT_ROOT, 'evolusom-latest-path.txt'), `${reportDir}\n`);
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
