const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local' });

const SOURCE_DIR = path.resolve(process.env.ML_BATCH_SOURCE_DIR || '');
const RESULT_DIR = path.join(SOURCE_DIR, 'run-results');
const START_SKU = String(process.env.ML_BATCH_START_SKU || '').trim();
const ONLY_SKUS = new Set(
  String(process.env.ML_BATCH_ONLY_SKUS || '')
    .split(',')
    .map((sku) => sku.trim())
    .filter(Boolean),
);
const POLL_MS = Math.max(2000, Number(process.env.ML_BATCH_VERIFY_POLL_MS || '5000'));
const MAX_POLLS = Math.max(1, Number(process.env.ML_BATCH_VERIFY_MAX_POLLS || '24'));
const SUPPLIER_ID = '108';

if (!process.env.ML_BATCH_SOURCE_DIR || !fs.existsSync(SOURCE_DIR)) {
  throw new Error('Defina ML_BATCH_SOURCE_DIR com os lotes BKR1 aprovados.');
}

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function batchFiles() {
  return fs.readdirSync(SOURCE_DIR)
    .filter((name) => /^\d{3}-bkr1-publish-\d{3}\.json$/.test(name))
    .sort();
}

function loadItems() {
  let items = batchFiles().flatMap((fileName) => {
    const manifest = readJson(path.join(SOURCE_DIR, fileName));
    return (manifest.items || []).map((item) => ({
      ...item,
      sourceBatch: fileName,
    }));
  });
  if (ONLY_SKUS.size > 0) {
    items = items.filter((item) => ONLY_SKUS.has(String(item.sku)));
    const found = new Set(items.map((item) => String(item.sku)));
    const missing = [...ONLY_SKUS].filter((sku) => !found.has(sku));
    if (missing.length > 0) {
      throw new Error(`SKUs selecionados não encontrados: ${missing.join(', ')}`);
    }
  }
  if (!START_SKU) return items;
  const index = items.findIndex((item) => String(item.sku) === START_SKU);
  if (index < 0) throw new Error(`SKU inicial não encontrado: ${START_SKU}`);
  return items.slice(index);
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
    'run-bkr1-approved-batches',
  );
  return {
    token: data.access_token,
    userId: String(account.userId),
    nickname: String(account.nickname || ''),
  };
}

async function fetchMl(account, apiPath, allowNotFound = false) {
  const response = await fetch(`https://api.mercadolibre.com${apiPath}`, {
    headers: { Authorization: `Bearer ${account.token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    throw new Error(
      `${apiPath} HTTP ${response.status}: ${data?.message || text.slice(0, 200)}`,
    );
  }
  return { status: response.status, data };
}

async function searchLiveSku(account, sku) {
  for (const field of ['sku', 'seller_sku']) {
    const result = await fetchMl(
      account,
      `/users/${account.userId}/items/search?${field}=${encodeURIComponent(sku)}&limit=100`,
    );
    const ids = Array.isArray(result.data?.results)
      ? result.data.results.map(String)
      : [];
    if (ids.length > 0) return ids;
  }
  return [];
}

async function preflightItem(account, item) {
  const { data: product, error: productError } = await supabase
    .from('produtos')
    .select('id,sku,ativo,estoque,ml_item_id,ml_status,oferta_preferencial_id,imagens')
    .eq('id', item.produtoId)
    .single();
  if (productError || !product) {
    throw new Error(`Produto ${item.sku} não encontrado: ${productError?.message || ''}`);
  }
  if (!product.ativo) throw new Error(`${item.sku}: produto inativo`);
  if (Number(product.estoque) <= 0) throw new Error(`${item.sku}: estoque local zerado`);
  if (hasText(product.ml_item_id) || String(product.ml_status) !== 'sem_anuncio') {
    throw new Error(`${item.sku}: produto já possui anúncio ${product.ml_item_id || product.ml_status}`);
  }
  if (!Array.isArray(product.imagens) || product.imagens.length === 0) {
    throw new Error(`${item.sku}: produto sem imagem`);
  }
  if (!product.imagens.every((url) =>
    String(url).startsWith(
      'https://supabase.vortek.shop/storage/v1/object/public/product-images/',
    ))) {
    throw new Error(`${item.sku}: imagem fora do Storage Vortek`);
  }

  const { data: offer, error: offerError } = await supabase
    .from('produto_fornecedor_ofertas')
    .select('id,dslite_fornecedor_id,ativo,estoque,custo')
    .eq('id', product.oferta_preferencial_id)
    .single();
  if (
    offerError ||
    !offer ||
    String(offer.dslite_fornecedor_id) !== SUPPLIER_ID ||
    !offer.ativo ||
    Number(offer.estoque) <= 0
  ) {
    throw new Error(`${item.sku}: oferta preferencial BKR1 indisponível`);
  }

  const { data: localListings, error: listingError } = await supabase
    .from('anuncios_ml')
    .select('ml_item_id,produto_id,sku,status')
    .or(`produto_id.eq.${product.id},sku.eq.${product.sku}`);
  if (listingError) throw new Error(listingError.message);
  if ((localListings || []).length > 0) {
    throw new Error(`${item.sku}: vínculo existente em anuncios_ml`);
  }

  const liveItems = await searchLiveSku(account, product.sku);
  if (liveItems.length > 0) {
    throw new Error(`${item.sku}: SKU já existe no ML (${liveItems.join(', ')})`);
  }

  return { product, offer };
}

async function pictureErrors(account, item) {
  const ids = Array.isArray(item?.pictures)
    ? item.pictures.map((picture) => String(picture?.id || '')).filter(Boolean)
    : [];
  const failures = [];
  for (const pictureId of ids) {
    const result = await fetchMl(
      account,
      `/pictures/${encodeURIComponent(pictureId)}/errors`,
      true,
    );
    if (result.status === 404) continue;
    const errors = Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.data?.errors)
        ? result.data.errors
        : [];
    if (errors.length > 0) failures.push({ pictureId, errors });
  }
  return failures;
}

async function verifyCreated(account, created, expectedItem) {
  const itemId = String(created?.anuncio?.id || '');
  if (!itemId) throw new Error(`${expectedItem.sku}: criação sem item_id`);
  let last = null;

  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    const [{ data: item }, { data: description }] = await Promise.all([
      fetchMl(
        account,
        `/items/${encodeURIComponent(itemId)}?include_internal_attributes=true`,
      ),
      fetchMl(account, `/items/${encodeURIComponent(itemId)}/description`),
    ]);
    const subStatuses = Array.isArray(item?.sub_status) ? item.sub_status : [];
    const attributes = Array.isArray(item?.attributes) ? item.attributes : [];
    const hasGtin = attributes.some(
      (attribute) =>
        String(attribute?.id) === 'GTIN' &&
        hasText(attribute?.value_name || attribute?.value_id),
    );
    const hasEmptyGtinReason = attributes.some(
      (attribute) =>
        String(attribute?.id) === 'EMPTY_GTIN_REASON' &&
        hasText(attribute?.value_name || attribute?.value_id),
    );
    const plainText = String(description?.plain_text || '');
    const pictureReady =
      Array.isArray(item?.pictures) &&
      item.pictures.length > 0 &&
      item.pictures.every(
        (picture) =>
          hasText(picture?.secure_url || picture?.url) &&
          !String(picture?.secure_url || picture?.url).includes('processing-image'),
      );
    last = {
      attempt,
      itemId,
      sku: expectedItem.sku,
      categoryOk: String(item?.category_id || '') === String(expectedItem.categoryId),
      status: String(item?.status || ''),
      subStatuses,
      pictureReady,
      richDescription:
        /VISÃO GERAL/.test(plainText) &&
        /CARACTERÍSTICAS CONFIRMADAS/.test(plainText) &&
        /IDENTIFICAÇÃO DO PRODUTO/.test(plainText),
      identifierOk: hasGtin || hasEmptyGtinReason,
      quantity: Number(item?.available_quantity),
      price: Number(item?.price),
    };

    const fatal =
      !last.categoryOk ||
      !last.richDescription ||
      !last.identifierOk ||
      !Number.isFinite(last.price) ||
      last.price <= 0 ||
      last.status === 'closed' ||
      last.status === 'under_review' ||
      subStatuses.includes('waiting_for_patch') ||
      subStatuses.includes('under_review');
    if (fatal) {
      return { ok: false, reason: 'fatal_listing_validation', row: last };
    }

    if (last.status === 'active' && pictureReady) {
      const diagnostics = await pictureErrors(account, item);
      if (diagnostics.length > 0) {
        return {
          ok: false,
          reason: 'picture_diagnostics_failed',
          row: last,
          diagnostics,
        };
      }

      const [{ error: productStatusError }, { error: listingStatusError }] =
        await Promise.all([
          supabase
            .from('produtos')
            .update({ ml_status: 'ativo' })
            .eq('id', expectedItem.produtoId)
            .eq('ml_item_id', itemId),
          supabase
            .from('anuncios_ml')
            .update({ status: 'ativo' })
            .eq('produto_id', expectedItem.produtoId)
            .eq('ml_item_id', itemId),
        ]);
      if (productStatusError || listingStatusError) {
        return {
          ok: false,
          reason: 'database_status_sync_failed',
          row: last,
          error: productStatusError?.message || listingStatusError?.message,
        };
      }

      const [{ data: product }, { data: ads }] = await Promise.all([
        supabase
          .from('produtos')
          .select('id,ml_item_id,ml_status')
          .eq('id', expectedItem.produtoId)
          .single(),
        supabase
          .from('anuncios_ml')
          .select('produto_id,ml_item_id,sku')
          .eq('produto_id', expectedItem.produtoId),
      ]);
      const linked =
        String(product?.ml_item_id || '') === itemId &&
        (ads || []).some(
          (ad) =>
            String(ad.ml_item_id) === itemId &&
            String(ad.sku) === String(expectedItem.sku),
        );
      if (!linked) {
        return { ok: false, reason: 'database_link_missing', row: last };
      }
      return { ok: true, row: last };
    }

    if (attempt < MAX_POLLS) await sleep(POLL_MS);
  }

  return { ok: false, reason: 'verification_timeout', row: last };
}

function executeOne(item, sequence) {
  const padded = String(sequence).padStart(3, '0');
  const manifestPath = path.join(RESULT_DIR, `${padded}-${item.sku}-manifest.json`);
  const resultPath = path.join(RESULT_DIR, `${padded}-${item.sku}-result.json`);
  const logPath = path.join(RESULT_DIR, `${padded}-${item.sku}.log`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      batchNumber: sequence,
      batchId: `bkr1-live-${padded}-${item.sku}`,
      strategy: 'one_item_then_verify',
      items: [item],
    }, null, 2),
  );
  const execution = spawnSync(
    'node',
    ['scripts/create-ml-batch-from-manifest.js'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BATCH_API_URL: process.env.BATCH_API_URL || 'https://app.vortek.shop',
        BATCH_STRICT_EVIDENCE: '1',
        BATCH_SKIP_SMART_FILL: '1',
        BATCH_ALLOW_EMPTY_GTIN_FOR_KITS: '1',
        BATCH_DELAY_MS: '0',
        ML_BATCH_MANIFEST: manifestPath,
        ML_BATCH_RESULT_FILE: resultPath,
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 30,
    },
  );
  fs.writeFileSync(logPath, `${execution.stdout || ''}\n${execution.stderr || ''}`);
  const result = fs.existsSync(resultPath)
    ? readJson(resultPath)
    : { created: [], failed: [{ sku: item.sku, error: 'resultado ausente' }] };
  return { execution, result, manifestPath, resultPath, logPath };
}

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const account = await getMlAccount();
  const items = loadItems();
  const summary = {
    startedAt: new Date().toISOString(),
    account: { userId: account.userId, nickname: account.nickname },
    sourceDir: SOURCE_DIR,
    selected: items.length,
    totals: { created: 0, verified: 0, failed: 0 },
    rows: [],
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const sequence = index + 1;
    console.log(`[preflight] ${sequence}/${items.length} ${item.sku}`);
    try {
      await preflightItem(account, item);
    } catch (error) {
      summary.totals.failed += 1;
      summary.rows.push({
        sequence,
        sku: item.sku,
        status: 'preflight_failed',
        error: error.message,
      });
      fs.writeFileSync(
        path.join(RESULT_DIR, 'summary.json'),
        JSON.stringify(summary, null, 2),
      );
      throw error;
    }

    const execution = executeOne(item, sequence);
    const created = Array.isArray(execution.result.created)
      ? execution.result.created
      : [];
    const failed = Array.isArray(execution.result.failed)
      ? execution.result.failed
      : [];
    if (created.length !== 1 || failed.length > 0 || execution.execution.status !== 0) {
      summary.totals.failed += 1;
      summary.rows.push({
        sequence,
        sku: item.sku,
        status: 'creation_failed',
        exitCode: execution.execution.status,
        error: failed[0]?.error || 'criação sem resultado único',
      });
      fs.writeFileSync(
        path.join(RESULT_DIR, 'summary.json'),
        JSON.stringify(summary, null, 2),
      );
      throw new Error(`${item.sku}: ${failed[0]?.error || 'criação falhou'}`);
    }
    summary.totals.created += 1;

    const verification = await verifyCreated(account, created[0], item);
    if (!verification.ok) {
      summary.totals.failed += 1;
      summary.rows.push({
        sequence,
        sku: item.sku,
        itemId: created[0]?.anuncio?.id || null,
        status: 'verification_failed',
        verification,
      });
      fs.writeFileSync(
        path.join(RESULT_DIR, 'summary.json'),
        JSON.stringify(summary, null, 2),
      );
      throw new Error(`${item.sku}: verificação falhou (${verification.reason})`);
    }

    summary.totals.verified += 1;
    summary.rows.push({
      sequence,
      sku: item.sku,
      itemId: created[0].anuncio.id,
      status: 'verified',
      verification: verification.row,
    });
    fs.writeFileSync(
      path.join(RESULT_DIR, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    console.log(`[verified] ${sequence}/${items.length} ${item.sku} ${created[0].anuncio.id}`);
  }

  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(RESULT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary.totals, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
