import { getSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';
import { simulateProductPricing } from '@/services/pricing-context';
import { pricingView } from '@/lib/pricing-view';
import type { SupplierFilterOption } from '@/lib/produto-filtering';
import type { CommercialPricingConfiguration } from '@/lib/commercial-pricing';
import { resolveMlFee } from '@/lib/commercial-pricing';
import { canUseHomologationFixtures } from '@/lib/homologation-fixture';

const ENABLED_KEY = 'bnt_d07_visual_review_enabled';
const PRODUCTS_KEY = 'bnt_d07_visual_review_products';
const EXPECTED_SOURCE = 'production-read-only';
const EXPECTED_VERSION = 1;

export type VisualReviewItem = {
  product: Record<string, any>;
  mlListings?: Array<Record<string, any>>;
  preferredOffer: Record<string, any> | null;
  supplierOffers?: Array<Record<string, any>>;
  offersCount: number;
  fulfillmentCapacity: {
    internal: number;
    supplier: number;
    safe: number;
  };
  isKit: boolean;
  isHomologationFixture: true;
  supplierDsliteIds?: string[];
  searchText?: string;
};

type VisualReviewPayload = {
  version: number;
  source: string;
  capturedAt: string;
  expiresAt: string;
  suppliers: SupplierFilterOption[];
  items: VisualReviewItem[];
};

export type BntD07VisualReviewMetadata = {
  enabled: true;
  source: 'production-read-only';
  capturedAt: string;
  expiresAt: string;
  itemCount: number;
};

export type BntD07VisualReview = {
  metadata: BntD07VisualReviewMetadata;
  suppliers: SupplierFilterOption[];
  items: VisualReviewItem[];
};

export type BntD07VisualReviewFilters = {
  search: string;
  supplierDsliteIds: string[];
  includeInternal: boolean;
  productActiveStatus: 'ativo' | 'inativo' | 'todos';
  mlStatus: string;
  stockStatus: string;
  priceField: 'cost' | 'suggestedPrice' | 'profit';
  priceMin: number | null;
  priceMax: number | null;
  taxRate: number | null;
  commercialPricing: CommercialPricingConfiguration;
};

function isEnabled(raw: string | null) {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === '"true"';
}

function isValidIsoDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSafeFixtureItem(value: unknown): value is VisualReviewItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as VisualReviewItem;
  return item.isHomologationFixture === true
    && Boolean(item.product && typeof item.product === 'object')
    && String(item.product.id || '').startsWith('bnt-d07-review-')
    && Boolean(String(item.product.sku || '').trim())
    && Boolean(String(item.product.nome || '').trim())
    && Number.isFinite(Number(item.fulfillmentCapacity?.safe));
}

export async function loadBntD07VisualReview(): Promise<BntD07VisualReview | null> {
  if (!canUseHomologationFixtures()) return null;

  const enabled = await getSyncRuntimeConfigValue(ENABLED_KEY);
  if (!isEnabled(enabled)) return null;

  const raw = await getSyncRuntimeConfigValue(PRODUCTS_KEY);
  if (!raw) return null;

  let payload: VisualReviewPayload;
  try {
    payload = JSON.parse(raw) as VisualReviewPayload;
  } catch {
    return null;
  }

  if (
    payload.version !== EXPECTED_VERSION
    || payload.source !== EXPECTED_SOURCE
    || !isValidIsoDate(payload.capturedAt)
    || !isValidIsoDate(payload.expiresAt)
    || Date.parse(payload.expiresAt) <= Date.now()
    || !Array.isArray(payload.items)
    || payload.items.length === 0
    || !payload.items.every(isSafeFixtureItem)
  ) {
    return null;
  }

  const suppliers = Array.isArray(payload.suppliers)
    ? payload.suppliers.filter((supplier) => (
      Boolean(String(supplier?.id || '').trim())
      && Boolean(String(supplier?.label || '').trim())
      && Boolean(String(supplier?.dsliteId || '').trim())
    ))
    : [];

  return {
    metadata: {
      enabled: true,
      source: EXPECTED_SOURCE,
      capturedAt: payload.capturedAt,
      expiresAt: payload.expiresAt,
      itemCount: payload.items.length,
    },
    suppliers,
    items: payload.items,
  };
}

export function findBntD07VisualReviewItem(
  review: BntD07VisualReview,
  productId: string,
) {
  return review.items.find((item) => String(item.product.id || '') === productId) || null;
}

export function pricingFor(
  item: VisualReviewItem,
  taxRate: number | null,
  commercialPricing: CommercialPricingConfiguration,
  evaluatedAt = new Date().toISOString(),
) {
  const product = item.product;
  const toCents = (value: unknown) => value == null || value === '' ? null : Math.round(Number(value) * 100);
  const pricing = simulateProductPricing({
    costCents: toCents(item.preferredOffer?.custo ?? product.custo),
    shippingCents: toCents(product.ml_shipping), priceCents: toCents(product.custom_price),
    feeRate: resolveMlFee(product.ml_fee, commercialPricing.mlFeeFallbackRate), evaluatedAt,
    // Amostra protegida: parâmetros hipotéticos, nunca confirmação fiscal/operacional.
    taxContext: { appliedRate: taxRate, estimatedRate: taxRate, confirmedRate: null,
      rbt12: null, bracket: null, source: taxRate === null ? 'unavailable' : 'estimated',
      referenceMonth: evaluatedAt.slice(0, 7), manualRequired: false, warning: 'Simulação de homologação' },
  });
  return { ...pricingView(pricing), pricing };
}

function matchesFilters(item: VisualReviewItem, filters: BntD07VisualReviewFilters, pricing = pricingFor(item, filters.taxRate, filters.commercialPricing)) {
  const product = item.product;
  const search = filters.search.trim().toLocaleLowerCase('pt-BR');
  if (search) {
    const haystack = [
      item.searchText,
      product.nome,
      product.sku,
      product.gtin,
      product.marca,
      product.fornecedor,
      product.ml_item_id,
      item.preferredOffer?.fornecedor_nome,
      item.preferredOffer?.sku_oferta,
      item.preferredOffer?.sku_fornecedor,
    ].map((value) => String(value || '').toLocaleLowerCase('pt-BR')).join(' ');
    if (!haystack.includes(search)) return false;
  }

  if (filters.supplierDsliteIds.length > 0 || filters.includeInternal) {
    const itemSupplierIds = new Set([
      ...item.supplierDsliteIds || [],
      String(product.dslite_fornecedor_id || ''),
      String(item.preferredOffer?.dslite_fornecedor_id || ''),
    ].filter(Boolean));
    const matchesExternal = filters.supplierDsliteIds.some((id) => itemSupplierIds.has(id));
    const matchesInternal = filters.includeInternal && item.fulfillmentCapacity.internal > 0;
    if (!matchesExternal && !matchesInternal) return false;
  }
  if (filters.productActiveStatus === 'ativo' && product.ativo === false) return false;
  if (filters.productActiveStatus === 'inativo' && product.ativo !== false) return false;
  if (filters.mlStatus && String(product.ml_status || '') !== filters.mlStatus) return false;
  if (filters.stockStatus === 'com_estoque' && item.fulfillmentCapacity.safe <= 0) return false;
  if (filters.stockStatus === 'sem_estoque' && item.fulfillmentCapacity.safe !== 0) return false;

  const priceValue = filters.priceField === 'cost'
    ? pricing.cost
    : filters.priceField === 'suggestedPrice'
      ? pricing.suggestedPrice
      : pricing.profit;
  if (filters.priceMin !== null && (priceValue === null || priceValue < filters.priceMin)) return false;
  if (filters.priceMax !== null && (priceValue === null || priceValue > filters.priceMax)) return false;

  return true;
}

export function filterBntD07VisualReviewItems(
  review: BntD07VisualReview,
  filters: BntD07VisualReviewFilters,
) {
  return review.items.filter((item) => matchesFilters(item, filters));
}

function sortValue(
  item: VisualReviewItem,
  sortBy: string,
  taxRate: number | null,
  commercialPricing: CommercialPricingConfiguration,
  pricing = pricingFor(item, taxRate, commercialPricing),
): string | number | null {
  if (sortBy === 'nome') return String(item.product.nome || '');
  if (sortBy === 'fornecedor') return String(item.product.fornecedor || '');
  if (sortBy === 'estoque') return item.fulfillmentCapacity.safe;
  if (sortBy === 'custo') return pricing.cost;
  if (sortBy === 'ml_fee') return Number(item.product.ml_fee || 0);
  if (sortBy === 'ml_shipping') return Number(item.product.ml_shipping || 0);
  if (sortBy === 'suggested_price') return pricing.suggestedPrice;
  if (sortBy === 'profit') return pricing.profit;
  if (sortBy === 'ml_status') return String(item.product.ml_status || '');
  return String(item.product.sku || '');
}

export function listBntD07VisualReview(params: {
  review: BntD07VisualReview;
  filters: BntD07VisualReviewFilters;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}) {
  const evaluatedAt = new Date().toISOString();
  const economics = new Map(params.review.items.map(item => [item, pricingFor(item, params.filters.taxRate, params.filters.commercialPricing, evaluatedAt)]));
  const filtered = params.review.items.filter(item => matchesFilters(item, params.filters, economics.get(item)!));
  const direction = params.sortOrder === 'desc' ? -1 : 1;
  const sorted = [...filtered].sort((left, right) => {
    const leftValue = sortValue(left, params.sortBy, params.filters.taxRate, params.filters.commercialPricing, economics.get(left)!);
    const rightValue = sortValue(right, params.sortBy, params.filters.taxRate, params.filters.commercialPricing, economics.get(right)!);
    if (leftValue === null) return rightValue === null ? 0 : 1;
    if (rightValue === null) return -1;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * direction;
    }
    return String(leftValue).localeCompare(String(rightValue), 'pt-BR', { numeric: true }) * direction;
  });
  const offset = (params.page - 1) * params.pageSize;

  return {
    data: sorted.slice(offset, offset + params.pageSize).map((item) => ({
      product: { ...item.product, pricing: economics.get(item)!.pricing },
      preferredOffer: item.preferredOffer,
      offersCount: item.offersCount,
      fulfillmentCapacity: item.fulfillmentCapacity,
      mlListings: Array.isArray(item.mlListings) ? item.mlListings : [],
      isKit: item.isKit,
      isHomologationFixture: item.isHomologationFixture,
    })),
    total: sorted.length,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export function summarizeBntD07VisualReview(
  review: BntD07VisualReview,
  filters: BntD07VisualReviewFilters,
) {
  const evaluatedAt = new Date().toISOString();
  const economics = new Map(review.items.map(item => [item, pricingFor(item, filters.taxRate, filters.commercialPricing, evaluatedAt)]));
  const items = review.items.filter(item => matchesFilters(item, filters, economics.get(item)!));
  let revenuePotential = 0;
  let incomplete = 0;
  const profits: number[] = [];

  for (const item of items) {
    const pricing = economics.get(item)!;
    if (pricing.suggestedPrice !== null) revenuePotential += Math.round(pricing.suggestedPrice * 100) * item.fulfillmentCapacity.safe;
    else incomplete++;
    if (pricing.profit !== null) profits.push(pricing.profit);
  }

  return {
    total: items.length,
    comEstoque: items.filter((item) => item.fulfillmentCapacity.safe > 0).length,
    semAnuncio: items.filter((item) => item.product.ml_status === 'sem_anuncio').length,
    receitaPotencial: incomplete ? null : revenuePotential / 100,
    lucroMedio: profits.length > 0
      ? Math.round((profits.reduce((sum, value) => sum + value, 0) / profits.length) * 100) / 100
      : null,
    pricingInconclusive: incomplete,
    profitSampleCount: profits.length,
  };
}
