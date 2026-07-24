const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const SOURCE_DIR = path.resolve(process.env.ML_BATCH_SOURCE_DIR || '');
const START_BATCH = Math.max(1, Number(process.env.ML_BATCH_START || '1'));
const RESULT_DIR = path.join(path.dirname(SOURCE_DIR), 'run-results');
const POLL_MS = Math.max(5000, Number(process.env.ML_BATCH_VERIFY_POLL_MS || '15000'));
const MAX_POLLS = Math.max(1, Number(process.env.ML_BATCH_VERIFY_MAX_POLLS || '20'));

if (!process.env.ML_BATCH_SOURCE_DIR || !fs.existsSync(SOURCE_DIR)) {
  throw new Error('Defina ML_BATCH_SOURCE_DIR com os lotes aprovados.');
}

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function batchFiles() {
  return fs
    .readdirSync(SOURCE_DIR)
    .filter((name) => /^\d{3}-evolusom-remaining-\d{3}\.json$/.test(name))
    .filter((name) => Number(name.slice(0, 3)) >= START_BATCH)
    .sort();
}

async function getAccessToken() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) {
    throw new Error(`Token ML indisponível: ${error?.message || 'sem token'}`);
  }
  return data.access_token;
}

async function fetchMl(apiPath) {
  const token = await getAccessToken();
  const response = await fetch(`https://api.mercadolibre.com${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(
      `${apiPath} HTTP ${response.status}: ${data?.message || text.slice(0, 200)}`,
    );
  }
  return data;
}

async function filterAlreadyListed(manifest) {
  const ids = (manifest.items || []).map((item) => String(item.produtoId));
  const { data, error } = await supabase
    .from('produtos')
    .select('id,ml_item_id')
    .in('id', ids);
  if (error) throw new Error(error.message);
  const listed = new Set(
    (data || [])
      .filter((row) => String(row.ml_item_id || '').trim())
      .map((row) => String(row.id)),
  );
  return {
    ...manifest,
    items: (manifest.items || []).filter(
      (item) => !listed.has(String(item.produtoId)),
    ),
  };
}

async function verifyCreated(created) {
  const expectedById = new Map(
    created.map((row) => [
      String(row?.anuncio?.id || ''),
      {
        categoryId: String(row?.category?.id || ''),
        produtoId: String(row?.produtoId || ''),
      },
    ]),
  );
  let lastRows = [];

  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    const rows = [];
    for (const [itemId, expected] of expectedById.entries()) {
      const item = await fetchMl(`/items/${encodeURIComponent(itemId)}`);
      const description = await fetchMl(
        `/items/${encodeURIComponent(itemId)}/description`,
      ).catch(() => null);
      const subStatuses = Array.isArray(item?.sub_status) ? item.sub_status : [];
      rows.push({
        itemId,
        produtoId: expected.produtoId,
        categoryOk: String(item?.category_id || '') === expected.categoryId,
        status: String(item?.status || ''),
        subStatuses,
        pictureReady:
          Array.isArray(item?.pictures) &&
          item.pictures.length > 0 &&
          !String(item.pictures[0]?.secure_url || '').includes('processing-image'),
        richDescription:
          /VISÃO GERAL/.test(String(description?.plain_text || '')) &&
          /CARACTERÍSTICAS CONFIRMADAS/.test(
            String(description?.plain_text || ''),
          ),
        quantity: Number(item?.available_quantity),
        price: Number(item?.price),
      });
    }
    lastRows = rows;

    const fatal = rows.filter(
      (row) =>
        !row.categoryOk ||
        !row.richDescription ||
        !Number.isFinite(row.price) ||
        row.price <= 0 ||
        row.status === 'closed' ||
        row.status === 'under_review' ||
        row.subStatuses.includes('waiting_for_patch') ||
        row.subStatuses.includes('under_review'),
    );
    if (fatal.length > 0) {
      return { ok: false, reason: 'fatal_listing_validation', rows, fatal };
    }

    const ready = rows.filter(
      (row) =>
        row.status === 'active' &&
        row.pictureReady &&
        !row.subStatuses.includes('picture_download_pending'),
    );
    if (ready.length === rows.length) {
      const productIds = rows.map((row) => row.produtoId);
      const { data: products, error: productError } = await supabase
        .from('produtos')
        .select('id,ml_item_id,ml_status')
        .in('id', productIds);
      if (productError) throw new Error(productError.message);
      const { data: ads, error: adsError } = await supabase
        .from('anuncios_ml')
        .select('produto_id,ml_item_id')
        .in('produto_id', productIds);
      if (adsError) throw new Error(adsError.message);
      const productLinks = new Set(
        (products || []).map((row) => `${row.id}:${row.ml_item_id}`),
      );
      const adLinks = new Set(
        (ads || []).map((row) => `${row.produto_id}:${row.ml_item_id}`),
      );
      const missingLinks = rows.filter(
        (row) =>
          !productLinks.has(`${row.produtoId}:${row.itemId}`) ||
          !adLinks.has(`${row.produtoId}:${row.itemId}`),
      );
      if (missingLinks.length > 0) {
        return {
          ok: false,
          reason: 'database_link_missing',
          rows,
          missingLinks,
        };
      }
      return { ok: true, attempt, rows };
    }

    console.log(
      `[verify] attempt=${attempt}/${MAX_POLLS} ready=${ready.length}/${rows.length}`,
    );
    if (attempt < MAX_POLLS) await sleep(POLL_MS);
  }

  return {
    ok: false,
    reason: 'verification_timeout',
    rows: lastRows,
  };
}

async function main() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const summary = {
    startedAt: new Date().toISOString(),
    sourceDir: SOURCE_DIR,
    startBatch: START_BATCH,
    batches: [],
    totals: { selected: 0, created: 0, failed: 0, verified: 0 },
  };

  for (const fileName of batchFiles()) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const sourceManifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const manifest = await filterAlreadyListed(sourceManifest);
    if (manifest.items.length === 0) {
      summary.batches.push({ fileName, skipped: true, reason: 'already_listed' });
      continue;
    }

    const batchNumber = fileName.slice(0, 3);
    const runManifest = path.join(RESULT_DIR, `${batchNumber}-manifest.json`);
    const resultPath = path.join(RESULT_DIR, `${batchNumber}-result.json`);
    const logPath = path.join(RESULT_DIR, `${batchNumber}.log`);
    fs.writeFileSync(runManifest, JSON.stringify(manifest, null, 2));
    console.log(`[batch] ${fileName} items=${manifest.items.length}`);

    const execution = spawnSync(
      'node',
      ['scripts/create-ml-batch-from-manifest.js'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BATCH_API_URL: process.env.BATCH_API_URL || 'https://app.vortek.shop',
          BATCH_STRICT_EVIDENCE: '1',
          BATCH_DELAY_MS: process.env.BATCH_DELAY_MS || '1000',
          ML_BATCH_MANIFEST: runManifest,
          ML_BATCH_RESULT_FILE: resultPath,
        },
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 30,
      },
    );
    fs.writeFileSync(
      logPath,
      `${execution.stdout || ''}\n${execution.stderr || ''}`,
    );

    const result = fs.existsSync(resultPath)
      ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
      : { created: [], failed: manifest.items, selected: manifest.items.length };
    const created = Array.isArray(result.created) ? result.created : [];
    const failed = Array.isArray(result.failed) ? result.failed : [];
    summary.totals.selected += manifest.items.length;
    summary.totals.created += created.length;
    summary.totals.failed += failed.length;

    const batchSummary = {
      fileName,
      selected: manifest.items.length,
      created: created.length,
      failed: failed.length,
      exitCode: execution.status,
      failureReasons: failed.map((row) => ({
        sku: row.sku,
        error: row.error,
      })),
      verification: null,
    };

    if (failed.length >= 3) {
      batchSummary.verification = {
        ok: false,
        reason: 'three_or_more_creation_failures',
      };
      summary.batches.push(batchSummary);
      fs.writeFileSync(
        path.join(RESULT_DIR, 'summary.json'),
        JSON.stringify(summary, null, 2),
      );
      throw new Error(`${fileName}: ${failed.length} falhas; execução interrompida.`);
    }

    if (created.length > 0) {
      batchSummary.verification = await verifyCreated(created);
      if (!batchSummary.verification.ok) {
        summary.batches.push(batchSummary);
        fs.writeFileSync(
          path.join(RESULT_DIR, 'summary.json'),
          JSON.stringify(summary, null, 2),
        );
        throw new Error(
          `${fileName}: verificação falhou (${batchSummary.verification.reason}).`,
        );
      }
      summary.totals.verified += created.length;
    }

    summary.batches.push(batchSummary);
    fs.writeFileSync(
      path.join(RESULT_DIR, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    console.log(
      `[batch-ok] ${fileName} created=${created.length} failed=${failed.length} verified=${created.length}`,
    );
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
