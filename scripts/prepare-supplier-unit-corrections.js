/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function argValue(name, fallback = null) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : fallback;
}

function parseCsvSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function mergeAttributes(current = [], incoming = []) {
  const byId = new Map(
    current.map((attribute) => [String(attribute.id), attribute]),
  );
  for (const attribute of incoming) {
    byId.set(String(attribute.id), {
      ...(byId.get(String(attribute.id)) || {}),
      ...attribute,
    });
  }
  return [...byId.values()];
}

async function fetchCategoryAttributes(categoryId) {
  const response = await fetch(
    `https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}/attributes`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) {
    throw new Error(`Categoria ${categoryId}: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function unitYieldAttribute(attributes) {
  return (
    attributes.find(
      (attribute) =>
        attribute.id === 'UNITS_PER_PACKAGE' &&
        attribute.tags?.unit_yield === true,
    ) ||
    attributes.find(
      (attribute) =>
        attribute.id === 'UNITS_PER_PACK' &&
        attribute.tags?.unit_yield === true,
    ) ||
    null
  );
}

async function main() {
  const input = path.resolve(argValue('--input'));
  const auditDir = path.resolve(
    argValue('--audit-dir', path.dirname(input)),
  );
  const output = path.resolve(
    argValue('--output', path.join(auditDir, 'quantidades-seguras.json')),
  );
  const excludedSkus = parseCsvSet(argValue('--exclude-skus', ''));

  if (!fs.existsSync(input)) throw new Error('--input inválido');
  if (!fs.existsSync(auditDir)) throw new Error('--audit-dir inválido');

  const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
  const candidates = (payload.items || []).filter(
    (row) =>
      row.catalog_listing === false &&
      Number(row.expected?.units) > 1 &&
      row.reasons?.some((reason) => reason.startsWith('attribute_units_')),
  );
  const categoryCache = new Map();
  const corrections = [];
  const blocked = [];

  for (const row of candidates) {
    const productUnits = Number(row.expected?.product_units) || null;
    const supplierUnits = Number(row.expected?.supplier_units) || null;
    const units = Number(row.expected?.units);

    if (excludedSkus.has(String(row.sku))) {
      blocked.push({ ...row, blocked_reason: 'manual_exclusion' });
      continue;
    }
    if (
      productUnits !== null &&
      supplierUnits !== null &&
      productUnits !== supplierUnits
    ) {
      blocked.push({ ...row, blocked_reason: 'source_quantity_conflict' });
      continue;
    }
    if (!row.category_id) {
      blocked.push({ ...row, blocked_reason: 'category_missing' });
      continue;
    }

    if (!categoryCache.has(row.category_id)) {
      categoryCache.set(
        row.category_id,
        fetchCategoryAttributes(row.category_id),
      );
    }

    let categoryAttributes;
    try {
      categoryAttributes = await categoryCache.get(row.category_id);
    } catch (error) {
      blocked.push({
        ...row,
        blocked_reason: 'category_contract_error',
        blocked_detail: error.message,
      });
      continue;
    }

    const unitAttribute = unitYieldAttribute(categoryAttributes);
    if (!unitAttribute) {
      blocked.push({
        ...row,
        blocked_reason: 'category_without_unit_yield_attribute',
      });
      continue;
    }

    const attributes = [
      {
        id: unitAttribute.id,
        value_name: String(units),
      },
    ];
    const saleFormat = categoryAttributes.find(
      (attribute) => attribute.id === 'SALE_FORMAT',
    );
    const kit = saleFormat?.values?.find(
      (value) => String(value.name).toLowerCase() === 'kit',
    );
    if (kit) {
      attributes.unshift({
        id: 'SALE_FORMAT',
        value_id: String(kit.id),
        value_name: String(kit.name),
      });
    }

    corrections.push({
      sequence: row.sequence,
      batch: row.batch,
      ml_item_id: row.ml_item_id,
      sku: row.sku,
      attributes,
      evidence: {
        category_id: row.category_id,
        expected_units: units,
        product_units: productUnits,
        supplier_units: supplierUnits,
        official_unit_attribute: unitAttribute.id,
      },
    });
  }

  const grouped = new Map();
  for (const correction of corrections) {
    if (!grouped.has(correction.batch)) grouped.set(correction.batch, []);
    grouped.get(correction.batch).push(correction);
  }

  const batchOutputs = [];
  for (const [batch, rows] of grouped) {
    const padded = String(batch).padStart(3, '0');
    const manualPath = path.join(auditDir, `lote-${padded}-overrides.json`);
    const manual = fs.existsSync(manualPath)
      ? JSON.parse(fs.readFileSync(manualPath, 'utf8')).corrections || []
      : [];
    const byItem = new Map(
      manual.map((row) => [String(row.ml_item_id), row]),
    );

    for (const correction of rows) {
      const current = byItem.get(String(correction.ml_item_id)) || {};
      byItem.set(String(correction.ml_item_id), {
        ...current,
        ...correction,
        attributes: mergeAttributes(
          current.attributes || [],
          correction.attributes || [],
        ),
      });
    }

    const batchOutput = path.join(
      auditDir,
      `lote-${padded}-overrides-completos.json`,
    );
    fs.writeFileSync(
      batchOutput,
      `${JSON.stringify(
        {
          batch,
          generated_at: new Date().toISOString(),
          corrections: [...byItem.values()].sort(
            (left, right) => left.sequence - right.sequence,
          ),
        },
        null,
        2,
      )}\n`,
    );
    batchOutputs.push(batchOutput);
  }

  const result = {
    generated_at: new Date().toISOString(),
    input,
    candidates: candidates.length,
    safe_corrections: corrections.length,
    blocked_count: blocked.length,
    blocked_reason_counts: blocked.reduce((counts, row) => {
      counts[row.blocked_reason] = (counts[row.blocked_reason] || 0) + 1;
      return counts;
    }, {}),
    batch_outputs: batchOutputs,
    corrections,
    blocked,
  };
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        output,
        candidates: result.candidates,
        safe_corrections: result.safe_corrections,
        blocked_count: result.blocked_count,
        blocked_reason_counts: result.blocked_reason_counts,
        batch_outputs: result.batch_outputs.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
