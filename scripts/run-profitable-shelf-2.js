const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const SOURCE_DIR = path.resolve('reports/ml-profitable-shelf-2-2026-08-10');
const MODE_DIR = path.join(SOURCE_DIR, APPLY ? 'apply-results' : 'preflight-results');
const BASE_URL = process.env.BATCH_API_URL || 'http://localhost:3000';
const ONLY_BATCH = String(process.env.BATCH_ONLY || '').trim();
const START_BATCH = Number(process.env.BATCH_START || 0);
const END_BATCH = Number(process.env.BATCH_END || 0);
const ONLY_SKU = String(process.env.BATCH_ONLY_SKU || '').trim();
const REQUIRE_GTIN = process.env.BATCH_REQUIRE_GTIN === '1';
const REQUIRE_MISSING_GTIN = process.env.BATCH_REQUIRE_MISSING_GTIN === '1';
const ALLOWED_CATEGORIES = new Set(
  String(process.env.BATCH_ALLOWED_CATEGORIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const RUN_ID = String(process.env.BATCH_RUN_ID || '').trim().replace(/[^a-z0-9_-]/gi, '');
const SUMMARY_FILE = RUN_ID ? `summary-${RUN_ID}.json` : 'summary.json';

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function batchFiles() {
  return fs.readdirSync(SOURCE_DIR)
    .filter((name) => /^\d{3}-profitable-shelf-2-create-\d{3}\.json$/.test(name))
    .filter((name) => !ONLY_BATCH || name.startsWith(`${ONLY_BATCH.padStart(3, '0')}-`))
    .filter((name) => !START_BATCH || Number(name.slice(0, 3)) >= START_BATCH)
    .filter((name) => !END_BATCH || Number(name.slice(0, 3)) <= END_BATCH)
    .sort();
}

async function filterStillEligible(items) {
  const ids = items.map((item) => String(item.produtoId));
  const eligible = new Set();
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await supabase
      .from('produtos')
      .select('id,ml_item_id,ml_status,estoque,ativo,gtin')
      .in('id', ids.slice(index, index + 200));
    if (error) throw new Error(error.message);
    for (const product of data || []) {
      if (
        !String(product.ml_item_id || '').trim() &&
        product.ml_status === 'sem_anuncio' &&
        product.ativo === true &&
        Number(product.estoque) > 0
        && (!REQUIRE_GTIN || String(product.gtin || '').trim().length > 0)
        && (!REQUIRE_MISSING_GTIN || String(product.gtin || '').trim().length === 0)
      ) {
        eligible.add(String(product.id));
      }
    }
  }
  return items.filter((item) => eligible.has(String(item.produtoId)));
}

function approvedSkus(fileName) {
  if (!APPLY) return null;
  const preflightPath = path.join(SOURCE_DIR, 'preflight-results', fileName.replace(/\.json$/, '-result.json'));
  if (!fs.existsSync(preflightPath)) throw new Error(`Pré-validação ausente: ${preflightPath}`);
  const result = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
  return new Set(
    (result.created || [])
      .filter(
        (row) =>
          ALLOWED_CATEGORIES.size === 0 ||
          ALLOWED_CATEGORIES.has(String(row.category?.id || '')),
      )
      .map((row) => String(row.sku)),
  );
}

async function main() {
  fs.mkdirSync(MODE_DIR, { recursive: true });
  const summary = {
    startedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'preflight',
    sourceDir: SOURCE_DIR,
    selected: 0,
    success: 0,
    failed: 0,
    skippedNoLongerEligible: 0,
    batches: [],
  };

  for (const fileName of batchFiles()) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    let items = Array.isArray(source.items) ? source.items : [];
    if (ONLY_SKU) items = items.filter((item) => String(item.sku) === ONLY_SKU);
    const approved = approvedSkus(fileName);
    if (approved) items = items.filter((item) => approved.has(String(item.sku)));
    const beforeEligibility = items.length;
    items = await filterStillEligible(items);
    summary.skippedNoLongerEligible += beforeEligibility - items.length;
    if (items.length === 0) {
      summary.batches.push({ fileName, selected: 0, skipped: true });
      continue;
    }

    const runSuffix = RUN_ID ? `-${RUN_ID}` : '';
    const runManifest = path.join(
      MODE_DIR,
      fileName.replace(/\.json$/, `${runSuffix}-manifest.json`),
    );
    const resultPath = path.join(
      MODE_DIR,
      fileName.replace(/\.json$/, `${runSuffix}-result.json`),
    );
    fs.writeFileSync(runManifest, JSON.stringify({ ...source, items }, null, 2));
    console.log(`[batch] ${fileName} mode=${summary.mode} items=${items.length}`);
    const run = spawnSync('node', ['scripts/create-ml-batch-from-manifest.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BATCH_API_URL: BASE_URL,
        ML_BATCH_MANIFEST: runManifest,
        ML_BATCH_RESULT_FILE: resultPath,
        DRY_RUN: APPLY ? '0' : '1',
        BATCH_STRICT_EVIDENCE: '1',
        BATCH_DELAY_MS: APPLY ? '1600' : '1200',
        BATCH_STOP_AFTER_CONSECUTIVE_FAILURES: APPLY ? '3' : '0',
      },
      encoding: 'utf8',
      maxBuffer: 30 * 1024 * 1024,
    });
    const result = fs.existsSync(resultPath)
      ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
      : { selected: items.length, created: [], failed: [{ error: run.stderr || 'resultado ausente' }] };
    const batch = {
      fileName,
      exitCode: run.status,
      selected: items.length,
      success: (result.created || []).length,
      failed: (result.failed || []).length,
      resultPath,
    };
    summary.selected += batch.selected;
    summary.success += batch.success;
    summary.failed += batch.failed;
    summary.batches.push(batch);
    fs.writeFileSync(path.join(MODE_DIR, SUMMARY_FILE), JSON.stringify(summary, null, 2));
    console.log(`[result] ${fileName} success=${batch.success} failed=${batch.failed}`);

    if (APPLY && (batch.failed >= 3 || batch.failed > Math.ceil(batch.selected * 0.5))) {
      summary.stopped = `Falhas demais no lote ${fileName}`;
      break;
    }
  }

  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(MODE_DIR, SUMMARY_FILE), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0 && summary.success === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
