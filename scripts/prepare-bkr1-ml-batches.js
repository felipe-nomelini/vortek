const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local' });

const SUPPLIER_ID = '108';
const SUPPLIER_NAME = 'BKR1';
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '5'));
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
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function imageList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12);
}

function isExplicitMultipack(product) {
  return /\bkit\b|\bcombo\b|\bpack\b|\bcartela\b|\b\d+\s*(?:un|und|unid|unidade|unidades)\b/i
    .test(String(product?.nome || ''));
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

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function structuredSupplierDescription(value) {
  const text = decodeEntities(value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*p[^>]*>/gi, '')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+•\s*/g, '\n• ')
    .replace(/\b(Características(?: Principais)?|Especificações(?: Técnicas)?|Conteúdo da Embalagem|Destaques do Design|Aplicações|Descrição)\s*:\s*/gi, '\n\n$1\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text
    .split(/\n+/)
    .flatMap((line) => {
      const clean = line.trim();
      if (!clean || clean.startsWith('• ') || clean.length <= 280) return clean ? [clean] : [];
      const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
      const paragraphs = [];
      for (let index = 0; index < sentences.length; index += 2) {
        paragraphs.push(sentences.slice(index, index + 2).map((part) => part.trim()).join(' '));
      }
      return paragraphs;
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 3800);
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

async function loadListings() {
  return fetchAll((from, to) => supabase
    .from('anuncios_ml')
    .select('produto_id,sku,ml_item_id,status')
    .range(from, to));
}

async function loadListedGtins(listings) {
  const ids = Array.from(new Set(
    listings.map((row) => String(row.produto_id || '')).filter(Boolean),
  ));
  const gtins = new Map();
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase
      .from('produtos')
      .select('id,sku,gtin')
      .in('id', ids.slice(index, index + 100));
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const gtin = digits(row.gtin);
      if (gtin) gtins.set(gtin, { produtoId: String(row.id), sku: String(row.sku || '') });
    }
  }
  return gtins;
}

async function getMlAccount() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) {
    throw new Error(`Token ML indisponível: ${error?.message || 'sem token'}`);
  }
  const account = await assertAllowedMercadoLivreToken(
    data.access_token,
    'prepare-bkr1-ml-batches',
  );
  return { token: data.access_token, userId: account.userId };
}

async function findLiveMlItems(account, sku) {
  for (const field of ['sku', 'seller_sku']) {
    const response = await fetch(
      `https://api.mercadolibre.com/users/${account.userId}/items/search?${field}=${encodeURIComponent(sku)}&limit=100`,
      {
        headers: { Authorization: `Bearer ${account.token}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Busca ML ${field}/${sku} HTTP ${response.status}: ${payload?.message || 'erro'}`);
    }
    const ids = Array.isArray(payload?.results) ? payload.results.map(String) : [];
    if (ids.length > 0) return ids;
  }
  return [];
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

async function fetchImage(sourceUrl) {
  const response = await fetch(sourceUrl, {
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
  if (metadata.width < 250 || metadata.height < 250) {
    throw new Error(`dimensões insuficientes ${metadata.width}x${metadata.height}`);
  }
  let pipeline = sharp(buffer)
    .rotate()
    .flatten({ background: '#ffffff' });
  const upscaled = Math.max(metadata.width, metadata.height) <= 500;
  if (upscaled) {
    pipeline = pipeline.resize({
      width: 800,
      height: 800,
      fit: 'inside',
      withoutEnlargement: false,
    });
  }
  const normalized = await pipeline
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return {
    normalized,
    contentType,
    width: metadata.width,
    height: metadata.height,
    upscaled,
  };
}

async function mirrorImage(product, sourceUrl, imageIndex) {
  if (sourceUrl.startsWith(VORTEK_IMAGE_PREFIX)) {
    const response = await fetch(sourceUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 200 || !String(response.headers.get('content-type') || '').startsWith('image/')) {
      throw new Error(`imagem Vortek indisponível HTTP ${response.status}`);
    }
    return { sourceUrl, publicUrl: sourceUrl, reused: true };
  }
  if (!APPLY_IMAGE_MIRROR) throw new Error('image_mirror_required');

  const image = await fetchImage(sourceUrl);
  const hash = crypto
    .createHash('sha256')
    .update(sourceUrl)
    .update(image.normalized)
    .digest('hex')
    .slice(0, 20);
  const objectPath = `catalog/bkr1/${product.sku}/${String(imageIndex + 1).padStart(2, '0')}-${hash}.jpg`;
  const upload = await supabase.storage.from(BUCKET).upload(objectPath, image.normalized, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (upload.error && !/already exists/i.test(upload.error.message || '')) {
    throw new Error(`upload: ${upload.error.message}`);
  }
  const publicUrl = `${VORTEK_IMAGE_PREFIX}${objectPath}`;
  const validation = await fetch(publicUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  if (validation.status !== 200 || !String(validation.headers.get('content-type') || '').startsWith('image/')) {
    throw new Error(`URL pública inválida HTTP ${validation.status}`);
  }
  return {
    sourceUrl,
    publicUrl,
    reused: false,
    width: image.width,
    height: image.height,
    upscaled: image.upscaled,
    sourceContentType: image.contentType,
  };
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

function localBlockReason({
  product,
  offer,
  localListingProductIds,
  localListingSkus,
  listedGtins,
  duplicateNames,
}) {
  const productId = String(product.id || '');
  const gtin = digits(product.gtin);
  if (product.ativo === false) return 'inactive_product';
  if (String(product.ml_status || '') !== 'sem_anuncio') return 'ml_status_not_sem_anuncio';
  if (hasText(product.ml_item_id) || localListingProductIds.has(productId)) return 'already_has_listing';
  if (localListingSkus.has(String(product.sku || ''))) return 'sku_already_has_listing';
  if (String(product.oferta_preferencial_id || '') !== String(offer.id || '')) {
    return 'bkr1_not_preferred';
  }
  if (duplicateNames.has(normalizeText(product.nome))) return 'duplicate_candidate_product';
  if (!hasText(product.sku)) return 'missing_sku';
  if (!hasText(product.nome)) return 'missing_name';
  if (!hasText(product.descricao)) return 'missing_description';
  if (imageList(product.imagens).length === 0) return 'missing_images';
  if (!positive(product.custo) || !positive(product.estoque)) return 'invalid_product_cost_or_stock';
  if (!hasText(product.marca)) return 'missing_brand';
  if (blockedBrand(product)) return 'blocked_brand_wahl';
  if (!validNcm(product.ncm)) return 'invalid_ncm';
  if (gtin && !validGtin(gtin)) return 'invalid_gtin';
  if (!gtin && !isExplicitMultipack(product)) return 'missing_gtin_single_product';
  const listedGtin = listedGtins.get(gtin);
  if (gtin && listedGtin && listedGtin.produtoId !== productId) return 'gtin_already_used_by_listing';
  if (!(positive(product.peso_bruto) || positive(product.peso_liq))) return 'missing_weight';
  if (!positive(product.altura) || !positive(product.largura) || !positive(product.profundidade)) {
    return 'missing_dimensions';
  }
  return null;
}

function manifestItem(product, publicImages) {
  const gtin = digits(product.gtin);
  const explicitMultipack = isExplicitMultipack(product);
  return {
    produtoId: String(product.id),
    sku: String(product.sku),
    nome: String(product.nome),
    fornecedor: SUPPLIER_NAME,
    dsliteFornecedorId: SUPPLIER_ID,
    custo: round2(product.custo),
    estoque: Number(product.estoque || 0),
    mlFee: Number(product.ml_fee || 0.15),
    mlShipping: round2(product.ml_shipping),
    customPrice: product.custom_price == null ? null : round2(product.custom_price),
    suggestedPricePreview: suggestedPricePreview(product),
    priceSource: product.custom_price == null ? 'pricing_strategy_preview' : 'custom_price',
    pricingStrategy: pricingStrategy(Number(product.custo || 0)),
    description: structuredSupplierDescription(product.descricao),
    preflight: {
      strictEvidence: true,
      validatedGtin: gtin || null,
      emptyGtinReasonEvidence: !gtin && explicitMultipack ? 'explicit_multipack_name' : null,
      validatedNcm: digits(product.ncm),
      imagesOnVortekStorage: publicImages.every((url) => url.startsWith(VORTEK_IMAGE_PREFIX)),
      categoryAndConditionalAttributes: 'required_at_dry_run_and_execution',
      descriptionFormat: 'paragraphs_and_bullet_points',
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
  const reportDir = path.join(REPORT_ROOT, `bkr1-safe-${stamp}`);
  fs.mkdirSync(reportDir, { recursive: true });

  const [offers, listings, account] = await Promise.all([
    loadSupplierOffers(),
    loadListings(),
    getMlAccount(),
  ]);
  const localListingProductIds = new Set(
    listings.map((row) => String(row.produto_id || '')).filter(Boolean),
  );
  const localListingSkus = new Set(
    listings.map((row) => String(row.sku || '')).filter(Boolean),
  );
  const listedGtins = await loadListedGtins(listings);

  const byProduct = new Map();
  for (const offer of offers) {
    const productId = String(offer.produto_id || '');
    const current = byProduct.get(productId);
    if (!current || String(offer.id) === String(offer.product?.oferta_preferencial_id)) {
      byProduct.set(productId, offer);
    }
  }

  const universe = Array.from(byProduct.values()).filter((offer) => {
    const product = offer.product;
    return product
      && product.ativo !== false
      && positive(product.estoque)
      && String(product.ml_status || '') === 'sem_anuncio'
      && !hasText(product.ml_item_id)
      && String(product.oferta_preferencial_id || '') === String(offer.id || '');
  });
  const nameCounts = new Map();
  for (const offer of universe) {
    const name = normalizeText(offer.product?.nome);
    if (name) nameCounts.set(name, Number(nameCounts.get(name) || 0) + 1);
  }
  const duplicateNames = new Set(
    Array.from(nameCounts.entries()).filter(([, count]) => count > 1).map(([name]) => name),
  );

  const blocked = [];
  const locallyReady = [];
  const reasonCounts = {};
  for (const offer of universe) {
    const product = offer.product;
    const reason = localBlockReason({
      product,
      offer,
      localListingProductIds,
      localListingSkus,
      listedGtins,
      duplicateNames,
    });
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

  const liveChecks = await mapConcurrent(locallyReady, 4, async ({ product }) => ({
    product,
    itemIds: await findLiveMlItems(account, product.sku),
  }));
  const notLive = [];
  for (const check of liveChecks) {
    if (check.itemIds.length > 0) {
      blocked.push({
        produtoId: String(check.product.id),
        sku: String(check.product.sku),
        nome: String(check.product.nome),
        reason: 'sku_found_in_live_ml',
        details: { itemIds: check.itemIds },
      });
      reasonCounts.sku_found_in_live_ml = Number(reasonCounts.sku_found_in_live_ml || 0) + 1;
    } else {
      notLive.push(check.product);
    }
  }

  const imageMigrations = [];
  const ready = [];
  await mapConcurrent(notLive, IMAGE_CONCURRENCY, async (product) => {
    const result = await prepareImages(product);
    imageMigrations.push({
      produtoId: String(product.id),
      sku: String(product.sku),
      oldImages: imageList(product.imagens),
      newImages: result.publicUrls || [],
      ok: result.ok,
      reason: result.reason || null,
      details: result.results,
    });
    if (!result.ok) {
      const reason = result.reason || 'image_preparation_failed';
      blocked.push({
        produtoId: String(product.id),
        sku: String(product.sku),
        nome: String(product.nome),
        reason,
      });
      reasonCounts[reason] = Number(reasonCounts[reason] || 0) + 1;
      return;
    }
    ready.push(manifestItem({ ...product, imagens: result.publicUrls }, result.publicUrls));
  });

  ready.sort((left, right) => left.sku.localeCompare(right.sku, 'pt-BR'));
  const batches = chunks(ready, BATCH_SIZE);
  batches.forEach((items, index) => {
    const number = index + 1;
    const padded = String(number).padStart(3, '0');
    const batch = {
      batchNumber: number,
      batchId: `bkr1-ml-create-${padded}`,
      strategy: 'strict_evidence_small_batch',
      executionHints: {
        delayMs: 2000,
        listingType: 'gold_pro',
        strictEvidence: true,
        dryRunFirst: true,
        createSequentially: true,
        stopAfterConsecutiveFailures: 3,
        allowEmptyGtinOnlyForExplicitMultipacks: true,
        requireVortekStorageImages: true,
        verifyListingAfterEachCreate: true,
      },
      items,
    };
    fs.writeFileSync(
      path.join(reportDir, `${padded}-bkr1-ml-create-${padded}.json`),
      JSON.stringify(batch, null, 2),
    );
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    supplier: { name: SUPPLIER_NAME, dsliteId: SUPPLIER_ID },
    mode: APPLY_IMAGE_MIRROR ? 'mirror_images_and_prepare' : 'audit_only',
    batchSize: BATCH_SIZE,
    candidateUniverseCount: universe.length,
    locallyReadyCount: locallyReady.length,
    liveMlCheckedCount: locallyReady.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    batchCount: batches.length,
    blockedReasonCounts: reasonCounts,
    descriptionPolicy:
      'Texto factual do fornecedor reorganizado em parágrafos; publicação acrescenta características confirmadas, identificação e embalagem em bullet points.',
    safetyRules: [
      'produto e oferta ativos com estoque',
      'BKR1 como oferta preferencial',
      'nenhum ml_item_id ou vínculo local por produto/SKU',
      'SKU ausente também na conta ML ao vivo',
      'produtos duplicados bloqueados',
      'GTIN válido ou kit/multipack explícito sujeito ao motivo oficial da categoria',
      'produto unitário sem GTIN bloqueado',
      'NCM, marca, descrição, dimensões e peso presentes',
      'imagem validada e servida pelo Storage Vortek',
      'categoria e atributos condicionais revalidados no dry-run e na execução',
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
  fs.writeFileSync(path.join(REPORT_ROOT, 'bkr1-latest-path.txt'), `${reportDir}\n`);
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
