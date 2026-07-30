/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function argValue(name, fallback = null) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : fallback;
}

function cleanText(value) {
  const decodeNumericEntity = (code, radix) => {
    const numericCode = Number.parseInt(code, radix);
    if (
      !Number.isFinite(numericCode) ||
      numericCode < 0 ||
      numericCode > 0xffff ||
      (numericCode >= 0xd800 && numericCode <= 0xdfff)
    ) {
      return ' ';
    }
    return String.fromCodePoint(numericCode);
  };

  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      decodeNumericEntity(code, 16),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      decodeNumericEntity(code, 10),
    )
    .replace(/&plusmn;/gi, '±')
    .replace(/&le;/gi, '<=')
    .replace(/&ge;/gi, '>=')
    .replace(/&deg;/gi, '°')
    .replace(/&reg;/gi, '®')
    .replace(/&copy;/gi, '©')
    .replace(/&trade;/gi, '™')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[→↔]/g, ' para ')
    .replace(/×/g, 'x')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (digit) =>
      String('₀₁₂₃₄₅₆₇₈₉'.indexOf(digit)),
    )
    .replace(/½/g, '1/2')
    .replace(/⅓/g, '1/3')
    .replace(/⅔/g, '2/3')
    .replace(/¼/g, '1/4')
    .replace(/¾/g, '3/4')
    .replace(/⅛/g, '1/8')
    .replace(/&ndash;|&#8211;/gi, '-')
    .replace(/&mdash;|&#8212;/gi, '-')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z][a-z0-9]+;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*+\s*imagens?\s+meramente\s+ilustrativas?\.?/gi, '')
    .replace(/\bPesquisa\s*:[^\n]*/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function sourceSections(value) {
  const text = cleanText(value)
    .replace(
      /\s*\b(Especificações Técnicas|Características(?: do Produto)?|Conteúdo da Embalagem|Aplicação e Uso|Identificação do Produto)\s*:\s*/gi,
      '\n$1:\n',
    )
    .replace(
      /\s+(?=(?:Marca|Modelo|Código|Referência|Aplicação|Instrumento|Tensão|Voltagem|Material|Revestimento|Acabamento|Cor|Tipo|Diâmetro|Potência|Capacidade|Comprimento|Quantidade|Hélice|Velocidades?|Oscilação)\s*:)/gi,
      '\n',
    );
  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const intro = [];
  const facts = [];
  const packageItems = [];
  let section = 'intro';

  for (const line of lines) {
    if (/^(?:Especificações Técnicas|Características(?: do Produto)?):?$/i.test(line)) {
      section = 'facts';
      continue;
    }
    if (/^Conteúdo da Embalagem:?$/i.test(line)) {
      section = 'package';
      continue;
    }
    if (/^(?:Aplicação e Uso|Identificação do Produto):?$/i.test(line)) {
      section = 'facts';
      continue;
    }
    const parts = line
      .split(/\s*[•]\s*|\s+-\s+(?=[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ0-9])/)
      .map(cleanText)
      .filter(Boolean);
    for (const part of parts) {
      if (section === 'package') {
        packageItems.push(part);
      } else if (
        section === 'facts' ||
        /^[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][^:]{1,45}:\s*\S/i.test(part)
      ) {
        facts.push(part);
      } else {
        intro.push(part);
      }
    }
  }

  return {
    intro: intro.join(' ').replace(/\s+/g, ' ').trim(),
    facts,
    packageItems,
  };
}

function packageQuantity(productName) {
  const name = String(productName || '');
  const match =
    name.match(/\(\s*c\/\s*(\d+)\s*(?:pilhas?|unidades?)?\s*\)/i) ||
    name.match(/\b(?:car|pct|dez|tub|bli)\s*\/\s*(\d+)\b/i) ||
    name.match(/\b(\d+)\s*(?:un|unid|unidades)\b/i);
  return match ? Number(match[1]) : 1;
}

function normalizeExistingDescription(description) {
  const lines = cleanText(description)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const output = [];

  for (const [index, line] of lines.entries()) {
    const isBullet = /^-\s+\S/.test(line);
    const isHeading =
      !isBullet &&
      line.length <= 80 &&
      /^[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ0-9][A-ZÁÉÍÓÚÀÂÊÔÃÕÇ0-9 /&().:+-]+:?$/.test(
        line,
      );
    const previous = output.at(-1);

    if (
      index > 0 &&
      (isHeading || (isBullet && previous && !/^-\s+\S/.test(previous)))
    ) {
      if (previous !== '') output.push('');
      if (isBullet) output.push('CARACTERÍSTICAS');
    }
    output.push(line);
  }

  if (output.length > 1 && output[1] !== '') output.splice(1, 0, '');
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildDescription(row) {
  const current = String(row.ml_description?.plain_text || '').trim();
  const currentBullets = current
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s+\S/.test(line)).length;
  if (current && currentBullets >= 3) {
    return normalizeExistingDescription(current);
  }

  const product = row.product || {};
  const offer = row.preferred_offer || {};
  const productSource = cleanText(product.descricao || '');
  const offerSource = cleanText(offer.descricao || '');
  const source = productSource || offerSource;
  const sections = sourceSections(source);
  const fallbackIntro = `Produto ${cleanText(
    product.nome || offer.nome,
  )}, com informações técnicas confirmadas abaixo para facilitar a conferência antes da compra.`;
  const intro = (
    sections.intro.length >= 80
      ? sections.intro
      : fallbackIntro
  )
    .slice(0, 1800)
    .trim();
  const extracted = sections.facts
    .map((part) => part.replace(/\s+/g, ' ').slice(0, 260).trim())
    .filter(Boolean)
    .slice(0, 10);
  const dimensions = [product.altura, product.largura, product.profundidade]
    .map(Number)
    .every((value) => Number.isFinite(value) && value > 0)
    ? `${product.altura} x ${product.largura} x ${product.profundidade} cm`
    : null;
  const facts = [
    product.marca ? `Marca: ${cleanText(product.marca)}` : null,
    product.gtin ? `Código universal (GTIN): ${cleanText(product.gtin)}` : null,
    ...extracted,
    dimensions ? `Dimensões da embalagem: ${dimensions}` : null,
    Number(product.peso_bruto) > 0
      ? `Peso bruto da embalagem: ${product.peso_bruto} kg`
      : null,
  ].filter(Boolean);
  while (facts.length < 3) {
    facts.push(`Identificação do produto: ${cleanText(product.sku)}`);
  }
  const quantity = packageQuantity(product.nome || offer.nome);
  const packageItems = sections.packageItems.length
    ? sections.packageItems
        .flatMap((item) =>
          item
            .split(/\s+(?=0?1\s+[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ])/)
            .map((part) => part.replace(/^0?1\s*/i, '').trim()),
        )
        .filter(Boolean)
        .slice(0, 8)
    : [
        `${quantity} ${
          quantity === 1 ? 'unidade' : 'unidades'
        } do produto descrito no título`,
      ];

  return [
    cleanText(product.nome || offer.nome).toUpperCase(),
    '',
    'VISÃO GERAL',
    intro,
    '',
    'CARACTERÍSTICAS CONFIRMADAS',
    ...facts.map((fact) => `- ${fact}`),
    '',
    'CONTEÚDO DA EMBALAGEM',
    ...packageItems.map((item) => `- ${item}`),
    '',
    'IDENTIFICAÇÃO DO PRODUTO',
    `SKU: ${cleanText(product.sku)}`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function main() {
  const input = path.resolve(
    argValue('--input', 'reports/auditoria-anuncios-evolusom/lote-001.json'),
  );
  const output = path.resolve(
    argValue(
      '--output',
      path.join(path.dirname(input), `${path.basename(input, '.json')}-correcoes.json`),
    ),
  );
  const overridesPath = argValue('--overrides', '');
  const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
  const overrides = overridesPath
    ? JSON.parse(fs.readFileSync(path.resolve(overridesPath), 'utf8')).corrections ||
      []
    : [];
  const byItem = new Map();

  for (const row of payload.items || []) {
    if (row.editability?.catalog_listing) continue;
    const needsDescription = row.automated_flags?.some((flag) =>
      [
        'description_empty',
        'description_without_paragraphs',
        'description_without_enough_bullets',
      ].includes(flag),
    );
    if (!needsDescription) continue;
    byItem.set(row.ad.ml_item_id, {
      sequence: row.sequence,
      ml_item_id: row.ad.ml_item_id,
      sku: row.ad.sku,
      description: buildDescription(row),
      attributes: [],
    });
  }

  for (const override of overrides) {
    const current = byItem.get(override.ml_item_id) || {
      sequence: override.sequence,
      ml_item_id: override.ml_item_id,
      sku: override.sku,
      attributes: [],
    };
    byItem.set(override.ml_item_id, { ...current, ...override });
  }

  const corrections = [...byItem.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  fs.writeFileSync(
    output,
    `${JSON.stringify(
      {
        batch: payload.batch,
        generated_at: new Date().toISOString(),
        source: input,
        corrections,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        input,
        output,
        corrections: corrections.length,
        descriptions: corrections.filter((row) => row.description).length,
        overrides: overrides.length,
      },
      null,
      2,
    ),
  );
}

main();
