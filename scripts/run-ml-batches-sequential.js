const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local' });

const BASE_URL = process.env.BATCH_API_URL || 'https://app.vortek.shop';
const LOGIN_EMAIL = process.env.BATCH_LOGIN_EMAIL || '';
const LOGIN_PASSWORD = process.env.BATCH_LOGIN_PASSWORD || '';
const EXCLUDED_SUPPLIERS = new Set((process.env.BATCH_EXCLUDED_SUPPLIERS || 'SHOPPECAS').split(',').map((v) => String(v || '').trim().toUpperCase()).filter(Boolean));
const SOURCE_DIR = process.env.ML_BATCH_SOURCE_DIR || path.join(process.cwd(), 'reports', 'ml-anuncio-batches', '2026-07-11T00-56-02-136Z');
const RUN_DIR = path.join(SOURCE_DIR, 'run-results');
const HOST_HEADER = process.env.BATCH_HOST_HEADER || '';
const ONLY_FILES = new Set((process.env.BATCH_ONLY_FILES || '').split(',').map((v) => String(v || '').trim()).filter(Boolean));

if (!LOGIN_EMAIL || !LOGIN_PASSWORD) throw new Error('BATCH_LOGIN_EMAIL/BATCH_LOGIN_PASSWORD required');

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function listBatchFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /^\d{3}-ml-create-\d{3}\.json$/.test(name))
    .filter((name) => ONLY_FILES.size === 0 || ONLY_FILES.has(name))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function filterManifest(sourcePath) {
  const manifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const originalItems = Array.isArray(manifest.items) ? manifest.items : [];
  const filteredItems = originalItems.filter((item) => !EXCLUDED_SUPPLIERS.has(String(item.fornecedor || '').trim().toUpperCase()));
  return { manifest: { ...manifest, items: filteredItems }, excludedCount: originalItems.length - filteredItems.length, originalCount: originalItems.length };
}

async function validateBatch(items) {
  const ids = items.map((item) => String(item.produtoId || '')).filter(Boolean);
  if (ids.length === 0) {
    return { selected: 0, withMlItemId: 0, withLinkedAnuncio: 0, semAnuncioStill: 0 };
  }

  let withMlItemId = 0;
  let semAnuncioStill = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('produtos')
      .select('id, ml_item_id, ml_status')
      .in('id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      if (String(row.ml_item_id || '').trim()) withMlItemId += 1;
      if (String(row.ml_status || '') === 'sem_anuncio') semAnuncioStill += 1;
    }
  }

  let withLinkedAnuncio = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('anuncios_ml')
      .select('produto_id')
      .in('produto_id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    withLinkedAnuncio += (data || []).length;
  }

  return { selected: ids.length, withMlItemId, withLinkedAnuncio, semAnuncioStill };
}

(async () => {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const summary = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    sourceDir: SOURCE_DIR,
    excludedSuppliers: Array.from(EXCLUDED_SUPPLIERS),
    batches: [],
    totals: {
      sourceItems: 0,
      excludedItems: 0,
      executedItems: 0,
      createdItems: 0,
      failedItems: 0,
      withMlItemId: 0,
      withLinkedAnuncio: 0,
    },
  };

  for (const fileName of listBatchFiles(SOURCE_DIR)) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const { manifest, excludedCount, originalCount } = filterManifest(sourcePath);
    summary.totals.sourceItems += originalCount;
    summary.totals.excludedItems += excludedCount;
    if (!manifest.items.length) {
      summary.batches.push({ fileName, skipped: true, reason: 'all_items_excluded', originalCount, excludedCount });
      continue;
    }

    const tempManifestPath = path.join(RUN_DIR, `run-${fileName}`);
    const resultPath = path.join(RUN_DIR, `${fileName.replace(/\.json$/, '')}-result.json`);
    fs.writeFileSync(tempManifestPath, JSON.stringify(manifest, null, 2));

    console.log(`[batch] ${fileName} items=${manifest.items.length} excluded=${excludedCount}`);
    const exec = spawnSync('node', ['scripts/create-ml-batch-from-manifest.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BATCH_API_URL: BASE_URL,
        BATCH_LOGIN_EMAIL: LOGIN_EMAIL,
        BATCH_LOGIN_PASSWORD: LOGIN_PASSWORD,
        BATCH_HOST_HEADER: HOST_HEADER,
        ML_BATCH_MANIFEST: tempManifestPath,
        ML_BATCH_RESULT_FILE: resultPath,
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });

    if (exec.stdout) process.stdout.write(exec.stdout);
    if (exec.stderr) process.stderr.write(exec.stderr);

    const result = fs.existsSync(resultPath)
      ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
      : { created: [], failed: [], selected: manifest.items.length };

    const validation = await validateBatch(manifest.items);
    const batchSummary = {
      fileName,
      manifestPath: tempManifestPath,
      resultPath,
      exitCode: exec.status,
      originalCount,
      excludedCount,
      executedCount: manifest.items.length,
      createdCount: Array.isArray(result.created) ? result.created.length : 0,
      failedCount: Array.isArray(result.failed) ? result.failed.length : 0,
      validation,
    };
    summary.batches.push(batchSummary);
    summary.totals.executedItems += batchSummary.executedCount;
    summary.totals.createdItems += batchSummary.createdCount;
    summary.totals.failedItems += batchSummary.failedCount;
    summary.totals.withMlItemId += validation.withMlItemId;
    summary.totals.withLinkedAnuncio += validation.withLinkedAnuncio;

    fs.writeFileSync(path.join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  }

  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
