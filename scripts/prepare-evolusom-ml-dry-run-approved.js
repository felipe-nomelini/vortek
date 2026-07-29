const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SOURCE_DIR = path.resolve(process.env.ML_BATCH_SOURCE_DIR || '');
const OUTPUT_DIR = path.resolve(process.env.ML_BATCH_APPROVED_DIR || '');
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '10'));
const BASE_URL = process.env.BATCH_API_URL || 'https://app.vortek.shop';
const ATTRIBUTE_OVERRIDES_FILE = String(
  process.env.ML_BATCH_ATTRIBUTE_OVERRIDES_FILE || '',
).trim();

if (!process.env.ML_BATCH_SOURCE_DIR || !fs.existsSync(SOURCE_DIR)) {
  throw new Error('Defina ML_BATCH_SOURCE_DIR com os lotes auditados.');
}
if (!process.env.ML_BATCH_APPROVED_DIR) {
  throw new Error('Defina ML_BATCH_APPROVED_DIR para os lotes aprovados.');
}

function loadVerifiedAttributeOverrides() {
  if (!ATTRIBUTE_OVERRIDES_FILE) return new Map();
  const filePath = path.resolve(ATTRIBUTE_OVERRIDES_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo de atributos verificados não encontrado: ${filePath}`);
  }
  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(rows)) {
    throw new Error('O arquivo de atributos verificados deve conter uma lista.');
  }
  return new Map(
    rows.map((row) => [
      String(row.sku || '').trim(),
      {
        ...row,
        attributes: Array.isArray(row.attributes) ? row.attributes : [],
      },
    ]),
  );
}

function mergeAttributeOverrides(current, verified) {
  const merged = new Map();
  for (const attribute of [...(current || []), ...(verified || [])]) {
    const id = String(attribute?.id || '').trim();
    if (id) merged.set(id, attribute);
  }
  return Array.from(merged.values());
}

function sourceFiles() {
  return fs
    .readdirSync(SOURCE_DIR)
    .filter((name) => /^\d{3}-evolusom-catalog-create-\d{3}\.json$/.test(name))
    .sort();
}

function writeManifest(filePath, batchNumber, items) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        batchNumber,
        batchId: `evolusom-domain-approved-${String(batchNumber).padStart(3, '0')}`,
        strategy: 'exact_gtin_catalog_and_domain_discovery_dry_run',
        executionHints: {
          dryRunFirst: true,
          createSequentially: true,
          strictEvidence: true,
          stopAfterConsecutiveFailures: 3,
        },
        items,
      },
      null,
      2,
    ),
  );
}

function main() {
  const dryRunDir = path.join(OUTPUT_DIR, 'dry-run-results');
  const remainingDir = path.join(OUTPUT_DIR, 'remaining');
  fs.mkdirSync(dryRunDir, { recursive: true });
  fs.mkdirSync(remainingDir, { recursive: true });

  const approved = [];
  const blocked = [];
  const verifiedOverridesBySku = loadVerifiedAttributeOverrides();
  for (const fileName of sourceFiles()) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const manifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const items = (manifest.items || []).map((item) => {
      const verified = verifiedOverridesBySku.get(String(item.sku || '').trim());
      if (!verified) return item;
      const categoryId = String(verified.categoryId || item.categoryId || '').trim();
      return {
        ...item,
        ...(categoryId ? { categoryId } : {}),
        attributeOverrides: mergeAttributeOverrides(
          item.attributeOverrides,
          verified.attributes,
        ),
        catalogEvidence: {
          ...(item.catalogEvidence || {}),
          ...(verified.categoryName
            ? { categoryName: String(verified.categoryName) }
            : {}),
          ...(verified.catalogDomainId
            ? { catalogDomainId: String(verified.catalogDomainId) }
            : {}),
        },
        preflight: {
          ...(item.preflight || {}),
          verifiedRequiredAttributes: verified.attributes.map(
            (attribute) => attribute.id,
          ),
        },
      };
    });
    const dryRunManifest = { ...manifest, items };
    const dryRunManifestPath = path.join(
      dryRunDir,
      fileName.replace('.json', '-manifest.json'),
    );
    fs.writeFileSync(
      dryRunManifestPath,
      JSON.stringify(dryRunManifest, null, 2),
    );
    const resultPath = path.join(dryRunDir, fileName.replace('.json', '-result.json'));
    const execution = spawnSync(
      'node',
      ['scripts/create-ml-batch-from-manifest.js'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DRY_RUN: '1',
          BATCH_API_URL: BASE_URL,
          BATCH_STRICT_EVIDENCE: '1',
          ML_BATCH_MANIFEST: dryRunManifestPath,
          ML_BATCH_RESULT_FILE: resultPath,
        },
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 30,
      },
    );
    if (!fs.existsSync(resultPath)) {
      throw new Error(`${fileName}: dry-run não gerou resultado (${execution.stderr})`);
    }
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    const createdIds = new Set(
      (result.created || []).map((row) => String(row.produtoId)),
    );
    approved.push(
      ...items.filter((item) =>
        createdIds.has(String(item.produtoId)),
      ),
    );
    blocked.push(
      ...(result.failed || []).map((row) => ({
        produtoId: row.produtoId,
        sku: row.sku,
        nome: row.nome,
        reason: 'dry_run_failed',
        error: row.error,
      })),
    );
    console.log(
      `[dry-run] ${fileName} approved=${createdIds.size} blocked=${(result.failed || []).length}`,
    );
  }

  for (let index = 0; index < approved.length; index += BATCH_SIZE) {
    const batchNumber = Math.floor(index / BATCH_SIZE) + 1;
    writeManifest(
      path.join(
        remainingDir,
        `${String(batchNumber).padStart(3, '0')}-evolusom-remaining-${String(
          batchNumber,
        ).padStart(3, '0')}.json`,
      ),
      batchNumber,
      approved.slice(index, index + BATCH_SIZE),
    );
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    selected: approved.length + blocked.length,
    approved: approved.length,
    blocked: blocked.length,
    batchSize: BATCH_SIZE,
    batchCount: Math.ceil(approved.length / BATCH_SIZE),
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'approved-items.json'),
    JSON.stringify(approved, null, 2),
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'blocked-items.json'),
    JSON.stringify(blocked, null, 2),
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main();
