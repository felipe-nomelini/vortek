const crypto = require('crypto');

const SENSITIVE_TERMS = [
  'bateria', 'pilha', 'fonte', 'carregador', 'eletric', 'automot', 'reposicao',
  'ferragem', 'instrumento', 'musical', 'compativ', 'voltag', 'tensao', 'conector',
];

const BLOCKED_HOSTS = [
  'mercadolivre.com', 'mercadolivre.com.br', 'amazon.com', 'amazon.com.br',
  'shopee.com.br', 'magazineluiza.com.br', 'americanas.com.br', 'casasbahia.com.br',
  'carrefour.com.br', 'kabum.com.br', 'aliexpress.com', 'ebay.com', 'facebook.com',
  'instagram.com', 'youtube.com', 'tiktok.com', 'pinterest.com', 'reddit.com',
];

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function plain(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stripHtml(value) {
  return text(String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&'));
}

function normalizeGtin(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return [8, 12, 13, 14].includes(digits.length) ? digits : '';
}

function isValidGtin(value) {
  const digits = normalizeGtin(value);
  if (!digits || /^0+$/.test(digits)) return false;
  const body = digits.slice(0, -1).split('').reverse();
  const sum = body.reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function isBlockedHost(host) {
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function brandTokens(brand) {
  const normalized = plain(brand).replace(/[^a-z0-9 ]/g, ' ');
  const words = normalized.split(/\s+/).filter((token) => token.length >= 3);
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  if (compact.length >= 2) words.push(compact);
  return [...new Set(words)];
}

function isManufacturerHost(url, brand) {
  const host = hostOf(url);
  if (!host || isBlockedHost(host)) return false;
  const compactHost = host.replace(/[^a-z0-9]/g, '');
  const tokens = brandTokens(brand);
  return tokens.length > 0 && tokens.some((token) => compactHost.includes(token));
}

function evidenceSnippet(content, needle, radius = 180) {
  const raw = text(content);
  const index = plain(raw).indexOf(plain(needle));
  if (index < 0) return '';
  return raw.slice(Math.max(0, index - radius), Math.min(raw.length, index + String(needle).length + radius));
}

function extractGtins(value) {
  const matches = text(value).match(/(?<!\d)\d{8,14}(?!\d)/g) || [];
  return [...new Set(matches.map(normalizeGtin).filter(isValidGtin))];
}

function extractLabeledGtins(value) {
  const matches = [];
  const raw = text(value);
  const pattern = /(?:gtin(?:-?1[234])?|ean(?:-?1[38])?|upc|jan|isbn(?:-?1[03])?|c[oó]digo\s+(?:universal|de\s+barras))\s*[:#-]?\s*(\d{8,14})/gi;
  for (const match of raw.matchAll(pattern)) matches.push(match[1]);
  return [...new Set(matches.map(normalizeGtin).filter(isValidGtin))];
}

function identityTokens(...values) {
  const tokens = values.flatMap((value) => text(value).split(/[\s/|,;()]+/));
  return [...new Set(tokens
    .map((token) => token.replace(/[^a-zA-Z0-9._-]/g, ''))
    .filter((token) => token.length >= 4 && /[a-zA-Z]/.test(token) && /\d/.test(token)))];
}

function containsExactIdentifier(content, identifier) {
  const haystack = plain(content);
  const needle = plain(identifier);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(haystack);
}

function reconcileOfficial({ brand, gtin, identifiers, sources }) {
  const normalizedGtin = normalizeGtin(gtin);
  const official = (sources || []).filter((source) => isManufacturerHost(source.url, brand));
  for (const source of official) {
    const content = text(`${source.title || ''} ${source.description || ''} ${source.content || ''}`);
    const exactIdentifiers = identifiers.filter((identifier) => containsExactIdentifier(content, identifier));
    const sourceGtins = extractLabeledGtins(content);
    const base = {
      source,
      exact_identifiers: exactIdentifiers,
      source_gtins: sourceGtins,
      gtin_evidence: normalizedGtin ? evidenceSnippet(content, normalizedGtin) : '',
      identifier_evidence: exactIdentifiers[0] ? evidenceSnippet(content, exactIdentifiers[0]) : '',
    };
    if (normalizedGtin && (sourceGtins.includes(normalizedGtin) || plain(content).includes(normalizedGtin))) {
      return { ...base, status: 'fabricante_confirmado', confidence: 'alta', gtin_match: true };
    }
    if (normalizedGtin && exactIdentifiers.length && sourceGtins.length && !sourceGtins.includes(normalizedGtin)) {
      return { ...base, status: 'checagem_manual_gtin', confidence: 'baixa', gtin_match: false };
    }
    if (exactIdentifiers.length >= 2) {
      return {
        ...base,
        status: normalizedGtin ? 'fabricante_sem_gtin' : 'identidade_sem_gtin_confirmada',
        confidence: 'media',
        gtin_match: null,
      };
    }
  }
  return {
    source: null,
    exact_identifiers: [],
    source_gtins: [],
    status: normalizedGtin ? 'fonte_oficial_nao_confirmada' : 'checagem_manual_identidade',
    confidence: 'baixa',
    gtin_match: null,
  };
}

function pricingStrategy(cost) {
  const value = Number(cost || 0);
  if (value <= 400) return { marginPercent: 15, minimumProfit: 20 };
  if (value <= 1000) return { marginPercent: 20, minimumProfit: 60 };
  return { marginPercent: 25, minimumProfit: 150 };
}

function calculatePrice({ cost, saleFeeRate, shippingCost }) {
  const strategy = pricingStrategy(cost);
  const taxRate = 0.05;
  const denominator = 1 - taxRate - Number(saleFeeRate || 0) - strategy.marginPercent / 100;
  if (denominator <= 0) throw new Error('pricing_denominator_invalid');
  const priceForMargin = (Number(cost) + Number(shippingCost || 0)) / denominator;
  const priceForMinimumProfit = (Number(cost) + Number(shippingCost || 0) + strategy.minimumProfit) /
    (1 - taxRate - Number(saleFeeRate || 0));
  const finalPrice = Math.ceil(Math.max(priceForMargin, priceForMinimumProfit) * 100) / 100;
  const commission = finalPrice * Number(saleFeeRate || 0);
  const tax = finalPrice * taxRate;
  const grossMargin = finalPrice - Number(cost) - Number(shippingCost || 0) - commission - tax;
  return {
    finalPrice,
    commission,
    tax,
    grossMargin,
    grossMarginPercent: finalPrice ? grossMargin / finalPrice * 100 : 0,
    targetMarginPercent: strategy.marginPercent,
    minimumProfit: strategy.minimumProfit,
  };
}

function isSensitive(product) {
  const corpus = plain(`${product.nome || ''} ${product.categoria || ''} ${product.descricao || ''}`);
  return SENSITIVE_TERMS.some((term) => corpus.includes(term));
}

function cleanTitle(value, maxLength = 60) {
  const cleaned = text(value).replace(/[|_]+/g, ' ').replace(/\s*[-–—]\s*/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength + 1).replace(/\s+\S*$/, '').trim();
}

function buildContent({ product, dslite, gtin, identifiers, confirmedFields, maxTitleLength = 60 }) {
  const brand = text(dslite.marca || product.marca);
  const model = text(dslite.modelo || dslite.part_number || identifiers[0]);
  const baseName = text(dslite.titulo || product.nome);
  const titleParts = [baseName, brand, model].filter(Boolean);
  const title = cleanTitle([...new Set(titleParts.map(plain))].length === titleParts.length
    ? titleParts.join(' ')
    : baseName, maxTitleLength);
  const specs = (confirmedFields || []).filter((field) => text(field.value));
  const lines = [
    `${baseName} é um produto ${brand ? `da marca ${brand}` : 'identificado tecnicamente'} para a aplicação descrita nas especificações abaixo.`,
    '',
    'Principais benefícios',
    '- Identidade e características conciliadas com as fontes registradas nesta auditoria.',
    '',
    'Especificações técnicas',
    ...specs.map((field) => `- ${field.label}: ${field.value}`),
    ...(gtin ? [`- GTIN: ${gtin}`] : []),
    '',
    'Conteúdo da embalagem',
    text(dslite.itens_inclusos) ? `- ${stripHtml(dslite.itens_inclusos)}` : '- Não confirmado pelo fabricante; consulte o conteúdo descrito na embalagem.',
    '',
    'Informações importantes',
    '- Confira modelo, medidas, tensão e compatibilidade antes da compra quando aplicável.',
  ];
  return { title, description: lines.join('\n').trim() };
}

function scoreAudit(facts) {
  let score = 0;
  if (facts.officialStatus === 'fabricante_confirmado') score += 50;
  else if (['fabricante_sem_gtin', 'identidade_sem_gtin_confirmada'].includes(facts.officialStatus)) score += 40;
  else if (facts.level1Identity) score += 20;
  if (facts.imageApproved) score += 15;
  if (facts.categoryValidated) score += 10;
  if (facts.requiredAttributesComplete) score += 10;
  if (facts.pricingApproved) score += 10;
  if (facts.duplicateChecked) score += 5;
  if (facts.technicalDivergence) score -= 30;
  if (facts.sensitive && facts.anyDivergence) score -= 20;
  return Math.max(0, Math.min(100, score));
}

module.exports = {
  buildContent,
  calculatePrice,
  cleanTitle,
  evidenceSnippet,
  extractGtins,
  extractLabeledGtins,
  hostOf,
  identityTokens,
  isBlockedHost,
  isManufacturerHost,
  isSensitive,
  isValidGtin,
  normalizeGtin,
  plain,
  pricingStrategy,
  reconcileOfficial,
  scoreAudit,
  sha256,
  stripHtml,
  text,
};
