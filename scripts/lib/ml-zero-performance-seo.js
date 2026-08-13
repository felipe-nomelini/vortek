const TITLE_PATTERN = /^[a-zA-Z0-9 ]+$/;

const FORBIDDEN_TITLE_TERMS = [
  'frete gratis', 'promocao', 'original', 'novo', 'nova', 'lancamento',
  'oferta', 'kit', 'brinde', 'pronta entrega', 'melhor preco', 'garantia',
  'premium', 'qualidade', 'nf',
];

const COMMON_SEARCH_SYNONYMS = new Map([
  ['aa', new Set(['pilha', 'pequena'])],
  ['aaa', new Set(['pilha', 'palito'])],
  ['cr2032', new Set(['bateria', 'moeda', 'pilha'])],
  ['cr2025', new Set(['bateria', 'moeda', 'pilha'])],
  ['cr2016', new Set(['bateria', 'moeda', 'pilha'])],
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTitle(value) {
  let result = normalize(value);
  for (const term of FORBIDDEN_TITLE_TERMS) {
    result = result.replace(new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`, 'gi'), ' ');
  }
  return result.replace(/\s+/g, ' ').trim().split(' ')
    .map((word) => word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function evidenceVocabulary(evidence) {
  const normalized = normalize(evidence);
  const words = new Set(normalized.split(' ').filter(Boolean));
  for (const word of [...words]) {
    if (word.length > 3 && word.endsWith('s')) words.add(word.slice(0, -1));
    if (/^0+\d+$/.test(word)) words.add(String(Number(word)));
  }
  if ([...words].some((word) => /^\d+$/.test(word))) {
    words.add('unidade');
    words.add('unidades');
  }
  for (const [trigger, synonyms] of COMMON_SEARCH_SYNONYMS) {
    if (!words.has(trigger)) continue;
    for (const synonym of synonyms) words.add(synonym);
  }
  return words;
}

function validateEvidenceTitle(title, evidence, maxLength = 60) {
  const value = String(title || '').trim();
  if (!value) return { ok: false, reason: 'title_empty' };
  if ([...value].length > Math.min(60, Number(maxLength) || 60)) return { ok: false, reason: 'title_too_long' };
  if (!TITLE_PATTERN.test(value)) return { ok: false, reason: 'title_invalid_characters' };
  const comparable = normalize(value);
  const comparablePadded = ` ${comparable} `;
  if (FORBIDDEN_TITLE_TERMS.some((term) => comparablePadded.includes(` ${term} `))) {
    return { ok: false, reason: 'title_forbidden_term' };
  }
  const allowed = evidenceVocabulary(evidence);
  const unsupported = comparable.split(' ').filter((word) => word && !allowed.has(word));
  if (unsupported.length) return { ok: false, reason: 'title_without_evidence', unsupported };
  return { ok: true };
}

function factualAttributes(item, product) {
  const rows = [];
  const existing = new Map((item?.attributes || []).map((row) => [String(row.id || '').toUpperCase(), row]));
  const add = (id, valueName) => {
    const value = String(valueName || '').trim();
    if (!value || existing.has(id)) return;
    rows.push({ id, value_name: value });
  };
  add('BRAND', product?.marca);
  const gtin = String(product?.gtin || '').replace(/\D/g, '');
  if (/^\d{8,14}$/.test(gtin)) add('GTIN', gtin);
  return rows;
}

function buildPlainTextDescription({ productName, sku, attributes }) {
  const name = String(productName || '').trim();
  const lines = (attributes || [])
    .filter((row) => row?.value_name && row?.value_id !== '-1')
    .filter((row) => ![
      'HAZMAT_TRANSPORTABILITY', 'IS_HIGHLIGHTED_BRAND', 'IS_TOM_BRAND',
      'ITEM_CONDITION', 'SELLER_SKU',
    ].includes(String(row.id || '').toUpperCase()))
    .filter((row) => !String(row.id || '').toUpperCase().startsWith('PACKAGE_'))
    .filter((row) => !(
      String(row.id || '').toUpperCase() === 'PART_NUMBER'
      && normalize(row.value_name) === normalize(sku)
    ))
    .slice(0, 14)
    .map((row) => `- ${String(row.name || row.id).trim()}: ${String(row.value_name).trim()}`);
  return [
    name.toUpperCase(),
    '',
    name,
    '',
    'CARACTERISTICAS',
    ...(lines.length ? lines : ['- Consulte os dados do produto no anuncio']),
    '',
    `SKU: ${sku}`,
  ].join('\n').trim();
}

function descriptionNeedsOptimization(value) {
  const description = String(value || '').trim();
  if (!description) return true;
  if (/<[^>]+>/.test(description)) return true;
  const paragraphs = description.split(/\r?\n\s*\r?\n/).filter((part) => part.trim()).length;
  const bullets = description.split(/\r?\n/).filter((line) => /^\s*(?:[-•●▪◦])\s+\S/.test(line)).length;
  return paragraphs < 2 || bullets < 3;
}

function sanitizeGeneratedDescription(value, sku) {
  const lines = String(value || '').split(/\r?\n/).filter((line) => {
    if (/^- (?:É marca destacada|É marca TOM|Transportabilidade Hazmat|Condição do item):/i.test(line)) return false;
    if (/^- (?:Altura|Comprimento|Peso|Largura) da embalagem do vendor:/i.test(line)) return false;
    if (new RegExp(`^- (?:SKU|Número de peça):\\s*${String(sku).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(line)) return false;
    return true;
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildStructuredOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      optimized_title: { type: 'string' },
      primary_keywords: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 6,
      },
      rationale: { type: 'string' },
    },
    required: ['optimized_title', 'primary_keywords', 'rationale'],
  };
}

module.exports = {
  FORBIDDEN_TITLE_TERMS,
  TITLE_PATTERN,
  buildPlainTextDescription,
  buildStructuredOutputSchema,
  descriptionNeedsOptimization,
  factualAttributes,
  normalize,
  sanitizeTitle,
  sanitizeGeneratedDescription,
  validateEvidenceTitle,
};
