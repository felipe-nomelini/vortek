/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function argValue(name, fallback = null) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : fallback;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function attrById(item) {
  return new Map(
    (item?.attributes || []).map((attribute) => [
      String(attribute?.id || '').toUpperCase(),
      attribute,
    ]),
  );
}

function attrValue(attributes, id) {
  const attribute = attributes.get(id);
  return String(attribute?.value_name || attribute?.value_id || '').trim();
}

function voltage(value) {
  const text = normalize(value);
  if (
    /\bbivolt\b/.test(text) ||
    /\b(?:110|127)\s*\/\s*220\s*v?(?:ac)?\b/.test(text)
  ) {
    return '127/220V';
  }
  if (/\b(?:127|110)\s*v\b/.test(text)) return '127V';
  if (/\b220\s*v\b/.test(text)) return '220V';
  return null;
}

function centimeters(value) {
  const match = normalize(value).match(/\b(\d{2,3}(?:[.,]\d+)?)\s*cm\b/);
  return match ? number(match[1]) : null;
}

function watts(value) {
  const match = normalize(value).match(/\b(\d+(?:[.,]\d+)?)\s*w\b/);
  return match ? number(match[1]) : null;
}

function units(value) {
  const text = normalize(value);
  const match =
    text.match(/\(\s*c\/\s*(\d+)\s*(?:pilhas?|unidades?)?\s*\)/) ||
    text.match(/\b(?:kit|jogo|caixa|cartela|blister)\s+com\s+(\d+)\b/) ||
    text.match(/\b(?:car|pct|dez|tub|bli|par)\s*\/\s*(\d+)\b/) ||
    text.match(/\b(\d+)\s*(?:un|unid|unidades)\b/);
  return match ? Number(match[1]) : null;
}

const COLORS = [
  'amarelo',
  'azul',
  'bege',
  'branco',
  'bronze',
  'cinza',
  'dourado',
  'laranja',
  'marrom',
  'prata',
  'preto',
  'rosa',
  'roxo',
  'verde',
  'vermelho',
];

function colors(value) {
  const text = normalize(value);
  return COLORS.filter((color) => new RegExp(`\\b${color}\\b`).test(text));
}

function sameNumber(left, right, tolerance = 0.01) {
  return left !== null && right !== null && Math.abs(left - right) <= tolerance;
}

function main() {
  const auditDir = path.resolve(argValue('--audit-dir'));
  const output = path.resolve(
    argValue('--output', path.join(auditDir, 'conflitos-automaticos.json')),
  );
  if (!auditDir || !fs.existsSync(auditDir)) {
    throw new Error('--audit-dir é obrigatório');
  }

  const files = fs
    .readdirSync(auditDir)
    .filter((file) => /^lote-\d{3}\.json$/.test(file))
    .sort();
  const rows = files.flatMap((file) => {
    const payload = JSON.parse(fs.readFileSync(path.join(auditDir, file), 'utf8'));
    return payload.items || [];
  });
  const conflicts = [];

  for (const row of rows) {
    const attributes = attrById(row.ml_item);
    const productName = String(row.product?.nome || '');
    const offerName = String(row.preferred_offer?.nome || '');
    const sourceName = `${productName} ${offerName}`;
    const title = String(row.ml_item?.title || '');
    const reasons = [];
    const expected = {
      voltage: voltage(sourceName),
      diameter_cm: centimeters(sourceName),
      power_w: watts(sourceName),
      units: units(sourceName),
      product_units: units(productName),
      supplier_units: units(offerName),
      colors: colors(sourceName),
    };
    const actual = {
      voltage: voltage(attrValue(attributes, 'VOLTAGE')),
      diameter_cm: centimeters(attrValue(attributes, 'DIAMETER')),
      power_w: watts(attrValue(attributes, 'POWER')),
      units:
        number(attrValue(attributes, 'UNITS_PER_PACKAGE')) ??
        number(attrValue(attributes, 'UNITS_PER_PACK')),
      colors: [
        ...new Set(
          [
            attrValue(attributes, 'COLOR'),
            attrValue(attributes, 'STRUCTURE_COLOR'),
            attrValue(attributes, 'BLADES_COLOR'),
          ].flatMap(colors),
        ),
      ],
    };
    const titleFacts = {
      voltage: voltage(title),
      diameter_cm: centimeters(title),
      power_w: watts(title),
      units: units(title),
      colors: colors(title),
    };

    if (expected.voltage && actual.voltage && expected.voltage !== actual.voltage) {
      reasons.push('attribute_voltage_conflict');
    }
    if (
      expected.diameter_cm !== null &&
      actual.diameter_cm !== null &&
      !sameNumber(expected.diameter_cm, actual.diameter_cm)
    ) {
      reasons.push('attribute_diameter_conflict');
    }
    if (
      expected.power_w !== null &&
      actual.power_w !== null &&
      !sameNumber(expected.power_w, actual.power_w)
    ) {
      reasons.push('attribute_power_conflict');
    }
    if (
      expected.units !== null &&
      actual.units !== null &&
      expected.units !== actual.units
    ) {
      reasons.push('attribute_units_conflict');
    }
    if (expected.units !== null && actual.units === null) {
      reasons.push('attribute_units_missing');
    }
    if (
      expected.colors.length &&
      actual.colors.some((color) => !expected.colors.includes(color))
    ) {
      reasons.push('attribute_color_conflict');
    }
    if (
      expected.voltage &&
      titleFacts.voltage &&
      expected.voltage !== titleFacts.voltage
    ) {
      reasons.push('title_voltage_conflict');
    }
    if (
      expected.diameter_cm !== null &&
      titleFacts.diameter_cm !== null &&
      !sameNumber(expected.diameter_cm, titleFacts.diameter_cm)
    ) {
      reasons.push('title_diameter_conflict');
    }
    if (
      expected.power_w !== null &&
      titleFacts.power_w !== null &&
      !sameNumber(expected.power_w, titleFacts.power_w)
    ) {
      reasons.push('title_power_conflict');
    }
    if (
      expected.units !== null &&
      titleFacts.units !== null &&
      expected.units !== titleFacts.units
    ) {
      reasons.push('title_units_conflict');
    }
    if (
      expected.colors.length &&
      titleFacts.colors.some((color) => !expected.colors.includes(color))
    ) {
      reasons.push('title_color_conflict');
    }

    if (reasons.length) {
      conflicts.push({
        sequence: row.sequence,
        batch: row.batch,
        ml_item_id: row.ad?.ml_item_id,
        sku: row.ad?.sku,
        category_id: row.ml_item?.category_id || null,
        catalog_listing: row.editability?.catalog_listing === true,
        current_unit_attribute_id: attributes.has('UNITS_PER_PACK')
          ? 'UNITS_PER_PACK'
          : attributes.has('UNITS_PER_PACKAGE')
            ? 'UNITS_PER_PACKAGE'
            : null,
        product_name: productName,
        supplier_name: offerName,
        ml_title: title,
        reasons: [...new Set(reasons)],
        expected,
        actual,
        title_facts: titleFacts,
      });
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    audit_dir: auditDir,
    total_listings: rows.length,
    conflicts: conflicts.length,
    reason_counts: conflicts.reduce((counts, row) => {
      for (const reason of row.reasons) counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {}),
    items: conflicts,
  };
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, output, ...payload, items: undefined }, null, 2));
}

main();
