import { calculateNetProfitAtPrice } from '../../services/pricing-core.js';

export type ListingEconomics = {
  price: number;
  cost: number;
  shipping: number;
  mlFee: number;
  taxRate: number;
};

export type ReactivationInput = {
  localStatus: string;
  liveStatus: string;
  liveSubStatus: string[];
  soldQuantity: number;
  profit: number | null;
  stock: number;
  hasPictures: boolean;
  hasVariations: boolean;
  blocked: boolean;
};

export type SeoInput = {
  localStatus: string;
  liveStatus: string;
  soldQuantity: number;
  visits: number | null;
  profit: number | null;
  catalogListing: boolean;
  blocked: boolean;
};

export type SupplierOfferCandidate = {
  id: string;
  active: boolean;
  stock: number;
  cost: number;
  priority: number;
};

export type SeoTitleInput = {
  productName: string;
  currentTitle: string;
  brand?: string | null;
  model?: string | null;
  maxLength?: number | null;
  allowOriginal?: boolean;
};

const BLOCKED_REACTIVATION_SUBSTATUS = new Set([
  'deleted',
  'forbidden',
  'held',
  'picture_download_pending',
  'suspended',
  'waiting_for_patch',
]);

const BLOCKED_TITLE_PHRASES = [
  /\bpronta\s+entrega\b/giu,
  /\bcom\s+nf\b/giu,
  /\bestoque\b/giu,
  /\boferta\b/giu,
  /\bpromo[cç][aã]o\b/giu,
];

const REPEATED_TECHNICAL_WORDS = new Set(['p2', 'p10', 'rca', 'xlr']);

export function calculateSeoReactivationProfit(input: ListingEconomics): number | null {
  const price = Number(input.price);
  const cost = Number(input.cost);
  const shipping = Number(input.shipping);
  const mlFee = Number(input.mlFee);
  const taxRate = Number(input.taxRate);
  if (
    !Number.isFinite(price) || price <= 0
    || !Number.isFinite(cost) || cost < 0
    || !Number.isFinite(shipping) || shipping < 0
    || !Number.isFinite(mlFee) || mlFee < 0
    || !Number.isFinite(taxRate) || taxRate < 0
  ) return null;

  return calculateNetProfitAtPrice({ price, cost, shipping, mlFee, taxRate });
}

export function evaluateReactivationCandidate(input: ReactivationInput) {
  const localStatus = String(input.localStatus || '').trim().toLowerCase();
  const liveStatus = String(input.liveStatus || '').trim().toLowerCase();
  const subStatuses = input.liveSubStatus.map((value) => String(value || '').trim().toLowerCase());

  if (input.blocked) return { eligible: false, reason: 'manual_blocklist' } as const;
  if (localStatus !== 'pausado') return { eligible: false, reason: 'local_status_not_paused' } as const;
  if (liveStatus !== 'paused') return { eligible: false, reason: 'live_status_not_paused' } as const;
  if (subStatuses.some((value) => BLOCKED_REACTIVATION_SUBSTATUS.has(value))) {
    return { eligible: false, reason: 'live_sub_status_blocked' } as const;
  }
  if (!Number.isFinite(input.soldQuantity) || input.soldQuantity <= 0) {
    return { eligible: false, reason: 'without_sales_history' } as const;
  }
  if (input.profit === null || input.profit < 15) {
    return { eligible: false, reason: 'profit_below_15' } as const;
  }
  if (!Number.isFinite(input.stock) || input.stock <= 0) {
    return { eligible: false, reason: 'supplier_without_stock' } as const;
  }
  if (!input.hasPictures) return { eligible: false, reason: 'listing_without_pictures' } as const;
  if (input.hasVariations) return { eligible: false, reason: 'variation_stock_not_supported' } as const;
  return { eligible: true, reason: 'eligible' } as const;
}

export function evaluateSeoCandidate(input: SeoInput) {
  const localStatus = String(input.localStatus || '').trim().toLowerCase();
  const liveStatus = String(input.liveStatus || '').trim().toLowerCase();

  if (input.blocked) return { eligible: false, reason: 'manual_blocklist' } as const;
  if (localStatus !== 'ativo') return { eligible: false, reason: 'local_status_not_active' } as const;
  if (liveStatus !== 'active') return { eligible: false, reason: 'live_status_not_active' } as const;
  if (input.catalogListing) return { eligible: false, reason: 'catalog_title_managed' } as const;
  if (!Number.isFinite(input.soldQuantity) || input.soldQuantity !== 0) {
    return { eligible: false, reason: 'has_sales' } as const;
  }
  if (input.visits === null || input.visits <= 0) {
    return { eligible: false, reason: 'without_visits' } as const;
  }
  if (input.profit === null || input.profit <= 10) {
    return { eligible: false, reason: 'profit_not_above_10' } as const;
  }
  return { eligible: true, reason: 'eligible' } as const;
}

export function normalizeSeoTitleForComparison(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const comparable = normalizeSeoTitleForComparison;

function containsPhrase(source: string, phrase: string): boolean {
  const sourceComparable = comparable(source);
  const phraseComparable = comparable(phrase);
  if (!phraseComparable) return false;
  if (sourceComparable.replace(/\s+/g, '').includes(phraseComparable.replace(/\s+/g, ''))) return true;
  const sourceWords = new Set(sourceComparable.split(' ').filter(Boolean));
  const phraseWords = phraseComparable.split(' ').filter(Boolean);
  return phraseWords.every((word) => sourceWords.has(word));
}

export function sanitizeSeoTitle(value: string, allowOriginal = false): string {
  let result = String(value || '').normalize('NFC');
  for (const expression of BLOCKED_TITLE_PHRASES) result = result.replace(expression, ' ');
  if (!allowOriginal) result = result.replace(/\boriginal\b/giu, ' ');
  result = result
    .replace(/[-|/+]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = result.split(' ').filter(Boolean);
  return words.filter((word, index) => {
    if (index === 0) return true;
    const normalized = comparable(word);
    const previous = comparable(words[index - 1]);
    return /\d/.test(normalized)
      || REPEATED_TECHNICAL_WORDS.has(normalized)
      || normalized !== previous;
  }).join(' ');
}

function isModelIdentifier(value: string): boolean {
  return (/^[a-z0-9]{3,}$/i.test(value) && /[a-z]/i.test(value) && /[1-9]/.test(value))
    || /^\d{4,}$/.test(value);
}

function wordAppearsInEvidence(word: string, evidence: string): boolean {
  const normalized = comparable(word);
  if (!normalized) return false;
  const evidenceWords = new Set(comparable(evidence).split(' ').filter(Boolean));
  if (isModelIdentifier(normalized)) {
    return comparable(evidence).replace(/\s+/g, '').includes(normalized);
  }
  return evidenceWords.has(normalized);
}

function buildBrandComplement(title: string, brand: string, productName: string): string {
  if (!brand || !containsPhrase(productName, brand)) return '';
  const titleWords = new Set(comparable(title).split(' ').filter(Boolean));
  return brand.split(' ').filter((word) => {
    const normalized = comparable(word);
    return normalized.length > 1 && !titleWords.has(normalized);
  }).join(' ');
}

function buildModelComplement(title: string, model: string, productName: string): string {
  const titleWords = new Set(comparable(title).split(' ').filter(Boolean));
  const compactTitle = comparable(title).replace(/\s+/g, '');
  const modelWords = model.split(' ').filter(Boolean);
  const missing = modelWords.filter((word) => {
    const normalized = comparable(word);
    if (!normalized || normalized.length === 1 || /^\d{1,3}$/.test(normalized)) return false;
    return isModelIdentifier(normalized)
      ? !compactTitle.includes(normalized)
      : !titleWords.has(normalized);
  }).filter((word) => wordAppearsInEvidence(word, productName));
  if (!missing.some((word) => (
    isModelIdentifier(comparable(word)) && wordAppearsInEvidence(word, productName)
  ))) return '';
  return missing.join(' ');
}

function fitTitle(value: string, maxLength: number, protectedPhrases: string[]): string {
  const words = value.split(' ').filter(Boolean);
  const protectedWords = new Set(
    protectedPhrases.flatMap((phrase) => comparable(phrase).split(' ').filter(Boolean)),
  );
  while (words.join(' ').length > maxLength && words.length > 1) {
    let removableIndex = -1;
    for (let index = words.length - 1; index > 0; index -= 1) {
      if (!protectedWords.has(comparable(words[index]))) {
        removableIndex = index;
        break;
      }
    }
    if (removableIndex < 0) removableIndex = words.length - 1;
    words.splice(removableIndex, 1);
  }
  return words.join(' ').slice(0, maxLength).trim();
}

export function buildSeoTitle(input: SeoTitleInput): string {
  const maxLength = Math.max(20, Math.min(60, Math.trunc(Number(input.maxLength) || 60)));
  const allowOriginal = input.allowOriginal === true;
  let title = sanitizeSeoTitle(input.currentTitle || input.productName, allowOriginal);
  const productName = sanitizeSeoTitle(input.productName, allowOriginal);
  const brand = sanitizeSeoTitle(input.brand || '', allowOriginal);
  const model = sanitizeSeoTitle(input.model || '', allowOriginal);
  const protectedPhrases: string[] = [];
  const brandComplement = buildBrandComplement(title, brand, productName);
  const modelComplement = buildModelComplement(title, model, productName);

  for (const phrase of [brandComplement, modelComplement]) {
    if (!phrase) continue;
    protectedPhrases.push(phrase);
    const expanded = `${title} ${phrase}`.trim();
    if (!containsPhrase(title, phrase) && [...expanded].length <= maxLength) title = expanded;
  }

  title = sanitizeSeoTitle(title, allowOriginal);
  return fitTitle(title, maxLength, protectedPhrases);
}

export function validateSeoTitle(
  title: string,
  options: { maxLength?: number | null; allowOriginal?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const maxLength = Math.max(20, Math.min(60, Math.trunc(Number(options.maxLength) || 60)));
  const value = String(title || '').trim();
  if (!value) return { ok: false, reason: 'title_empty' };
  if ([...value].length > maxLength) return { ok: false, reason: 'title_too_long' };
  if (/[-|/+]/.test(value)) return { ok: false, reason: 'title_forbidden_character' };
  if (/[^\p{L}\p{N}\s]/u.test(value)) return { ok: false, reason: 'title_special_character' };
  if (BLOCKED_TITLE_PHRASES.some((expression) => {
    expression.lastIndex = 0;
    return expression.test(value);
  })) return { ok: false, reason: 'title_forbidden_claim' };
  if (!options.allowOriginal && /\boriginal\b/iu.test(value)) {
    return { ok: false, reason: 'title_original_without_evidence' };
  }
  const words = value.split(/\s+/).map(comparable).filter(Boolean);
  if (words.some((word, index) => index > 0 && word === words[index - 1])) {
    return { ok: false, reason: 'title_repeated_word' };
  }
  return { ok: true };
}

export function chooseReactivationOffer<T extends SupplierOfferCandidate>(
  offers: T[],
  preferredOfferId: string | null | undefined,
  manualPreference: boolean,
): T | null {
  const available = offers.filter((offer) => (
    offer.active && Number(offer.stock) > 0 && Number(offer.cost) > 0
  ));
  if (manualPreference) {
    const preferredId = String(preferredOfferId || '').trim();
    return available.find((offer) => String(offer.id) === preferredId) || null;
  }
  return [...available].sort((left, right) => (
    Number(left.cost) - Number(right.cost)
    || Number(left.priority) - Number(right.priority)
    || Number(right.stock) - Number(left.stock)
    || String(left.id).localeCompare(String(right.id))
  ))[0] || null;
}
