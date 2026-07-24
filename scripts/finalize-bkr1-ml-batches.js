const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(process.env.ML_BATCH_SOURCE_DIR || '');
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '5'));

if (!process.env.ML_BATCH_SOURCE_DIR || !fs.existsSync(SOURCE_DIR)) {
  throw new Error('Defina ML_BATCH_SOURCE_DIR com o diretório BKR1 auditado.');
}

const CORRECTIONS = {
  VTK012022: {
    categoryId: 'MLB420707',
    attributes: [{ id: 'MODEL', value_name: 'WC 330' }],
    evidence: 'modelo explícito no nome e descrição do fornecedor',
  },
  VTK012148: {
    categoryId: 'MLB195961',
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788227', value_name: 'XLR' }],
    evidence: 'conexão XLR explícita; valor oficial da categoria',
  },
  VTK012267: {
    categoryId: 'MLB195961',
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788227', value_name: 'XLR' }],
    evidence: 'conexão XLR explícita; valor oficial da categoria',
  },
  VTK012297: {
    categoryId: 'MLB420707',
    attributes: [{ id: 'MODEL', value_name: 'WC 4050' }],
    evidence: 'modelo explícito no nome e descrição do fornecedor',
  },
  VTK012327: {
    categoryId: 'MLB420707',
    attributes: [{ id: 'MODEL', value_name: 'WC 4046' }],
    evidence: 'modelo explícito no nome e descrição do fornecedor',
  },
  VTK012369: {
    categoryId: 'MLB195961',
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788227', value_name: 'XLR' }],
    evidence: 'conexão XLR explícita; valor oficial da categoria',
  },
  VTK012523: {
    categoryId: 'MLB72751',
    attributes: [
      { id: 'BRAND', value_id: '4070810', value_name: 'Andaluz' },
      { id: 'MODEL', value_id: '24371997', value_name: 'Knob KP Preto' },
      { id: 'UNITS_PER_PACK', value_name: '4' },
      { id: 'RECOMMENDED_INSTRUMENTS', value_id: '2106570', value_name: 'Guitarra' },
      { id: 'GTIN', value_name: '7898905159670' },
    ],
    evidence: 'produto MLB27113636 por GTIN exato; categoria Knobs MLB72751',
  },
  VTK012547: {
    categoryId: 'MLB434825',
    attributes: [
      { id: 'BRAND', value_id: '5240871', value_name: "D'Addario" },
      { id: 'MODEL', value_name: 'VR300' },
      { id: 'GTIN', value_name: '019954160050' },
    ],
    evidence: 'produto MLB22230956 por GTIN exato; categoria semântica Resinas para Arcos',
  },
  VTK012611: {
    categoryId: 'MLB434825',
    attributes: [
      { id: 'BRAND', value_id: '5240871', value_name: "D'Addario" },
      { id: 'MODEL', value_name: 'VR200' },
      { id: 'GTIN', value_name: '019954160043' },
    ],
    evidence: 'produto MLB27901860 por GTIN exato; categoria semântica Resinas para Arcos',
  },
  VTK012765: {
    categoryId: 'MLB195961',
    attributes: [{ id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788227', value_name: 'XLR' }],
    evidence: 'conexão XLR explícita; valor oficial da categoria',
  },
  VTK012907: {
    categoryId: 'MLB38279',
    attributes: [
      { id: 'BRAND', value_id: '13660752', value_name: 'Wireconex' },
      { id: 'CABLE_AND_ADAPTER_TYPE', value_id: '13788227', value_name: 'XLR' },
      { id: 'GTIN', value_name: '7898640363585' },
    ],
    evidence: 'produto MLB29324141 por GTIN exato; categoria usada por cinco anúncios do produto',
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resultFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('-result.json'))
    .sort()
    .map((name) => path.join(directory, name));
}

function coherentDryRunCategory(item, result) {
  const name = String(item.nome || '').toLowerCase();
  const categoryId = String(result?.category?.id || '');
  if (/palheta/.test(name)) return categoryId === 'MLB45712';
  if (/conector|adaptador/.test(name)) {
    return ['MLB38172', 'MLB420707', 'MLB195961'].includes(categoryId);
  }
  return false;
}

function chunks(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function writeBatch(directory, number, items) {
  const padded = String(number).padStart(3, '0');
  const manifest = {
    batchNumber: number,
    batchId: `bkr1-publish-approved-${padded}`,
    strategy: 'dry_run_and_category_evidence_approved',
    executionHints: {
      delayMs: 2000,
      listingType: 'gold_pro',
      strictEvidence: true,
      dryRunFirst: false,
      createSequentially: true,
      stopAfterConsecutiveFailures: 3,
      allowEmptyGtinOnlyForExplicitMultipacks: true,
      requireVortekStorageImages: true,
      verifyListingAfterEachCreate: true,
    },
    items,
  };
  fs.writeFileSync(
    path.join(directory, `${padded}-bkr1-publish-${padded}.json`),
    JSON.stringify(manifest, null, 2),
  );
}

function main() {
  const ready = readJson(path.join(SOURCE_DIR, 'ready-items.json'));
  const initialBlocked = readJson(path.join(SOURCE_DIR, 'blocked-items.json'));
  const readyBySku = new Map(ready.map((item) => [String(item.sku), item]));
  const approvedBySku = new Map();
  const dryRunFailures = [];

  for (const filePath of resultFiles(path.join(SOURCE_DIR, 'dry-run-results'))) {
    const result = readJson(filePath);
    for (const row of result.created || []) {
      const item = readyBySku.get(String(row.sku));
      if (!item || !coherentDryRunCategory(item, row)) continue;
      approvedBySku.set(String(item.sku), {
        ...item,
        categoryId: String(row.category.id),
        categoryEvidence: {
          source: 'strict_evidence_dry_run',
          categoryId: String(row.category.id),
          categoryName: String(row.category.nome || ''),
          domainName: String(row.category.dominio || ''),
        },
      });
    }
    dryRunFailures.push(...(result.failed || []));
  }

  const correctionsDir = path.join(SOURCE_DIR, 'corrections');
  fs.mkdirSync(correctionsDir, { recursive: true });
  const correctionItems = Object.entries(CORRECTIONS)
    .map(([sku, correction]) => {
      const item = readyBySku.get(sku);
      if (!item) return null;
      return {
        ...item,
        categoryId: correction.categoryId,
        attributeOverrides: correction.attributes,
        categoryEvidence: {
          source: 'official_category_and_product_evidence',
          categoryId: correction.categoryId,
          details: correction.evidence,
        },
      };
    })
    .filter(Boolean);
  fs.writeFileSync(
    path.join(correctionsDir, '001-bkr1-corrections.json'),
    JSON.stringify({
      batchNumber: 1,
      batchId: 'bkr1-corrections-001',
      strategy: 'official_category_and_attribute_corrections',
      executionHints: {
        dryRunFirst: true,
        strictEvidence: true,
        createSequentially: true,
        allowEmptyGtinOnlyForExplicitMultipacks: true,
      },
      items: correctionItems,
    }, null, 2),
  );

  const correctionResultPath = path.join(correctionsDir, '001-bkr1-corrections-result.json');
  const correctionFailures = [];
  if (fs.existsSync(correctionResultPath)) {
    const result = readJson(correctionResultPath);
    for (const row of result.created || []) {
      const item = correctionItems.find((candidate) => String(candidate.sku) === String(row.sku));
      const expected = CORRECTIONS[String(row.sku)];
      if (!item || !expected || String(row.category?.id) !== expected.categoryId) continue;
      approvedBySku.set(String(item.sku), item);
    }
    correctionFailures.push(...(result.failed || []));
  }

  const approved = Array.from(approvedBySku.values())
    .sort((left, right) => left.sku.localeCompare(right.sku, 'pt-BR'));
  const approvedSkus = new Set(approved.map((item) => String(item.sku)));
  const pending = ready
    .filter((item) => !approvedSkus.has(String(item.sku)))
    .map((item) => {
      const correctionFailure = correctionFailures.find((row) => String(row.sku) === String(item.sku));
      const initialFailure = dryRunFailures.find((row) => String(row.sku) === String(item.sku));
      return {
        produtoId: item.produtoId,
        sku: item.sku,
        nome: item.nome,
        reason: correctionFailure
          ? 'corrected_dry_run_failed'
          : CORRECTIONS[String(item.sku)] && !fs.existsSync(correctionResultPath)
            ? 'correction_dry_run_pending'
            : initialFailure
              ? 'initial_dry_run_failed'
              : 'category_mismatch_or_unvalidated',
        error: correctionFailure?.error || initialFailure?.error || null,
      };
    });

  const outputDir = path.join(SOURCE_DIR, 'publish-approved');
  fs.mkdirSync(outputDir, { recursive: true });
  for (const fileName of fs.readdirSync(outputDir)) {
    if (/^\d{3}-bkr1-publish-\d{3}\.json$/.test(fileName)) {
      fs.unlinkSync(path.join(outputDir, fileName));
    }
  }
  chunks(approved, BATCH_SIZE).forEach((items, index) => {
    writeBatch(outputDir, index + 1, items);
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    selected: ready.length,
    approved: approved.length,
    pending: pending.length,
    initiallyBlocked: initialBlocked.length,
    batchSize: BATCH_SIZE,
    batchCount: Math.ceil(approved.length / BATCH_SIZE),
    correctionDryRunComplete: fs.existsSync(correctionResultPath),
    descriptionFormat: 'parágrafos e bullet points com fatos do fornecedor e atributos oficiais',
  };
  fs.writeFileSync(path.join(outputDir, 'approved-items.json'), JSON.stringify(approved, null, 2));
  fs.writeFileSync(path.join(outputDir, 'pending-items.json'), JSON.stringify(pending, null, 2));
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
