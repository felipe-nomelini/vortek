import type { BntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { isBlockedDropshippingDsliteSupplier } from '@/lib/dslite/supplier-policy';

export type SupplierOfferStatus =
  | 'historical'
  | 'offer_inactive'
  | 'product_inactive'
  | 'invalid_cost'
  | 'out_of_stock'
  | 'eligible';

export type SupplierOffersView = 'operational' | 'alternatives' | 'problems' | 'historical' | 'all';

export type SupplierOfferListRow = {
  offerId: string;
  productId: string;
  productSku: string;
  productName: string;
  offerName: string;
  supplierSku: string;
  supplierDsliteId: string;
  supplierName: string;
  paymentMode: string;
  stock: number;
  leadTimeDays: number | null;
  cost: number;
  lowestEligibleCost: number | null;
  costDeltaAmount: number | null;
  costDeltaPercent: number | null;
  status: SupplierOfferStatus;
  preferred: boolean;
  preferenceMode: 'manual' | 'automatic';
  eligibleOfferCount: number;
  lastSyncAt: string | null;
  isHomologationFixture?: boolean;
};

export type SupplierOfferMetrics = {
  totalLinked: number;
  eligible: number;
  problems: number;
  historical: number;
  productsWithAlternatives: number;
};

export type SupplierOfferQueueCounts = {
  operational: number;
  alternatives: number;
  problems: number;
  historical: number;
  all: number;
};

export type SupplierOfferOption = {
  id: string;
  label: string;
  dsliteId: string;
  active: boolean;
};

type ClassificationInput = {
  supplierActive: boolean;
  supplierDsliteId: string;
  paymentMode: string;
  offerActive: boolean;
  productActive: boolean;
  cost: number;
  stock: number;
};

export function classifySupplierOffer(input: ClassificationInput): SupplierOfferStatus {
  if (
    !input.supplierActive
    || input.paymentMode === 'balance_account'
    || isBlockedDropshippingDsliteSupplier(input.supplierDsliteId)
  ) return 'historical';
  if (!input.offerActive) return 'offer_inactive';
  if (!input.productActive) return 'product_inactive';
  if (!Number.isFinite(input.cost) || input.cost <= 0) return 'invalid_cost';
  if (!Number.isFinite(input.stock) || input.stock <= 0) return 'out_of_stock';
  return 'eligible';
}

export function supplierFallbackName(value: unknown, supplierDsliteId: string) {
  const raw = String(value || '').trim();
  if (!raw) return `Fornecedor DSLite ${supplierDsliteId}`;
  const withoutBranch = raw.replace(/[-_](?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i, '');
  return withoutBranch
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|\s)(\p{L})/gu, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('pt-BR')}`);
}

export function buildBntD09VisualReviewOfferId(
  item: BntD07VisualReview['items'][number],
  offer: Record<string, any>,
) {
  const offerIdParts = [
    item.product.id,
    offer.dslite_fornecedor_id,
    offer.dslite_produto_id,
    offer.sku_oferta,
  ].map((value) => String(value || '').replace(/[^a-z0-9-]/gi, '-')).filter(Boolean);

  return `bnt-d09-review-${offerIdParts.join('-')}`;
}

export function findBntD09VisualReviewOffer(
  review: BntD07VisualReview,
  offerId: string,
) {
  for (const item of review.items) {
    const offers = (item.supplierOffers || []).filter((offer) => (
      offer?.is_internal_stock !== true && offer?.is_kit_supplier !== true
    ));
    const offer = offers.find((candidate) => (
      buildBntD09VisualReviewOfferId(item, candidate) === offerId
    ));
    if (offer) return { item, offer };
  }
  return null;
}

function preferredOfferMatches(product: Record<string, any>, preferredOffer: Record<string, any> | null, offer: Record<string, any>) {
  const explicitPreferredId = String(product.oferta_preferencial_id || preferredOffer?.id || '').trim();
  const offerId = String(offer.id || '').trim();
  if (explicitPreferredId && offerId) return explicitPreferredId === offerId;
  return String(preferredOffer?.dslite_fornecedor_id || '').trim() === String(offer.dslite_fornecedor_id || '').trim()
    && String(preferredOffer?.dslite_produto_id || '').trim() === String(offer.dslite_produto_id || '').trim();
}

function matchesView(row: SupplierOfferListRow, view: SupplierOffersView) {
  if (view === 'operational') return row.status === 'eligible';
  if (view === 'alternatives') return row.status === 'eligible' && !row.preferred;
  if (view === 'problems') return !['eligible', 'historical'].includes(row.status);
  if (view === 'historical') return row.status === 'historical';
  return true;
}

function sortValue(row: SupplierOfferListRow, sortBy: string): string | number | null {
  if (sortBy === 'offer') return row.offerName;
  if (sortBy === 'product') return row.productName;
  if (sortBy === 'supplier') return row.supplierName;
  if (sortBy === 'stock') return row.stock;
  if (sortBy === 'cost') return row.cost;
  if (sortBy === 'status') return row.status;
  if (sortBy === 'last_sync') return row.lastSyncAt;
  return row.supplierSku;
}

export function listBntD09VisualReview(params: {
  review: BntD07VisualReview;
  page: number;
  pageSize: number;
  search: string;
  supplierDsliteIds: string[];
  view: SupplierOffersView;
  stockStatus: string;
  preference: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}) {
  const activeSupplierByDsliteId = new Map(
    params.review.suppliers.map((supplier) => [String(supplier.dsliteId), supplier]),
  );
  const baseRows: SupplierOfferListRow[] = [];

  for (const item of params.review.items) {
    const offers = (item.supplierOffers || []).filter((offer) => (
      offer?.is_internal_stock !== true && offer?.is_kit_supplier !== true
    ));
    for (const offer of offers) {
      const supplierDsliteId = String(offer.dslite_fornecedor_id || '').trim();
      const supplier = activeSupplierByDsliteId.get(supplierDsliteId);
      const paymentMode = String(offer.payment_mode || 'postpaid');
      const cost = Number(offer.custo || 0);
      const stock = Number(offer.estoque || 0);
      baseRows.push({
        offerId: buildBntD09VisualReviewOfferId(item, offer),
        productId: String(item.product.id || ''),
        productSku: String(item.product.sku || ''),
        productName: String(item.product.nome || ''),
        offerName: String(offer.nome || item.product.nome || ''),
        supplierSku: String(offer.sku_oferta || offer.sku_fornecedor || offer.dslite_produto_id || ''),
        supplierDsliteId,
        supplierName: supplier?.apelido || supplierFallbackName(offer.fornecedor_nome, supplierDsliteId),
        paymentMode,
        stock,
        leadTimeDays: offer.lead_time_dias == null ? null : Number(offer.lead_time_dias),
        cost,
        lowestEligibleCost: null,
        costDeltaAmount: null,
        costDeltaPercent: null,
        status: classifySupplierOffer({
          supplierActive: Boolean(supplier),
          supplierDsliteId,
          paymentMode,
          offerActive: offer.ativo !== false,
          productActive: item.product.ativo !== false,
          cost,
          stock,
        }),
        preferred: preferredOfferMatches(item.product, item.preferredOffer, offer),
        preferenceMode: item.product.fornecedor_preferencial_manual === true ? 'manual' : 'automatic',
        eligibleOfferCount: 0,
        lastSyncAt: offer.last_sync_at ? String(offer.last_sync_at) : null,
        isHomologationFixture: true,
      });
    }
  }

  const eligibleCostsByProduct = new Map<string, number[]>();
  for (const row of baseRows) {
    if (row.status !== 'eligible') continue;
    const costs = eligibleCostsByProduct.get(row.productId) || [];
    costs.push(row.cost);
    eligibleCostsByProduct.set(row.productId, costs);
  }
  for (const row of baseRows) {
    const eligibleCosts = eligibleCostsByProduct.get(row.productId) || [];
    row.eligibleOfferCount = eligibleCosts.length;
    if (eligibleCosts.length > 0) {
      row.lowestEligibleCost = Math.min(...eligibleCosts);
      row.costDeltaAmount = Math.round((row.cost - row.lowestEligibleCost) * 100) / 100;
      row.costDeltaPercent = row.lowestEligibleCost > 0
        ? Math.round(((row.cost - row.lowestEligibleCost) / row.lowestEligibleCost) * 10000) / 100
        : null;
    }
  }

  const search = params.search.trim().toLocaleLowerCase('pt-BR');
  const common = baseRows.filter((row) => {
    if (search) {
      const haystack = [row.offerName, row.supplierSku, row.productName, row.productSku, row.supplierName]
        .join(' ')
        .toLocaleLowerCase('pt-BR');
      if (!haystack.includes(search)) return false;
    }
    if (params.supplierDsliteIds.length > 0 && !params.supplierDsliteIds.includes(row.supplierDsliteId)) return false;
    if (params.stockStatus === 'com_estoque' && row.stock <= 0) return false;
    if (params.stockStatus === 'sem_estoque' && row.stock > 0) return false;
    if (params.preference === 'preferenciais' && !row.preferred) return false;
    if (params.preference === 'alternativas' && row.preferred) return false;
    return true;
  });

  const problems = common.filter((row) => !['eligible', 'historical'].includes(row.status)).length;
  const metrics: SupplierOfferMetrics = {
    totalLinked: common.length,
    eligible: common.filter((row) => row.status === 'eligible').length,
    problems,
    historical: common.filter((row) => row.status === 'historical').length,
    productsWithAlternatives: new Set(
      common.filter((row) => row.eligibleOfferCount > 1).map((row) => row.productId),
    ).size,
  };
  const queueCounts: SupplierOfferQueueCounts = {
    operational: metrics.eligible,
    alternatives: common.filter((row) => row.status === 'eligible' && !row.preferred).length,
    problems,
    historical: metrics.historical,
    all: common.length,
  };

  const direction = params.sortOrder === 'desc' ? -1 : 1;
  const filtered = common.filter((row) => matchesView(row, params.view));
  filtered.sort((left, right) => {
    const leftValue = sortValue(left, params.sortBy);
    const rightValue = sortValue(right, params.sortBy);
    if (leftValue === null) return rightValue === null ? left.offerId.localeCompare(right.offerId) : 1;
    if (rightValue === null) return -1;
    const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), 'pt-BR', { numeric: true });
    return comparison === 0 ? left.offerId.localeCompare(right.offerId) : comparison * direction;
  });

  const supplierOptions = Array.from(new Map(baseRows.map((row) => [row.supplierDsliteId, {
    id: row.supplierDsliteId,
    label: row.supplierName,
    dsliteId: row.supplierDsliteId,
    active: row.status !== 'historical',
  }])).values()).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  const offset = (params.page - 1) * params.pageSize;

  return {
    data: filtered.slice(offset, offset + params.pageSize),
    total: filtered.length,
    page: params.page,
    pageSize: params.pageSize,
    metrics,
    queueCounts,
    suppliers: supplierOptions,
  };
}
