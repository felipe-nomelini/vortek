import type { BntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { calculateNetProfitAtPrice } from '@/services/pricing';

export type MlListingsFocus = 'all' | 'active' | 'paused' | 'quality_risk' | 'price_review';
export type MlCatalogStatus = 'ganhando' | 'competindo' | 'perdendo' | 'sem_catalogo';

export type MlListingDashboardRow = {
  itemId: string;
  productId: string | null;
  productSku: string;
  productName: string;
  listingTitle: string;
  thumbnail: string | null;
  permalink: string | null;
  listingType: 'standard' | 'catalog';
  catalogProductId: string | null;
  relatedItemId: string | null;
  price: number;
  profit: number | null;
  marginPercent: number | null;
  sold: number;
  visits: number;
  qualityScore: number | null;
  qualityAvailable: boolean;
  qualityPrimaryIssue: string | null;
  qualityInfo: Record<string, unknown> | null;
  observedStatus: string;
  localStatus: string;
  blockReason: string | null;
  blockedUntil: string | null;
  lastError: string | null;
  catalogStatus: MlCatalogStatus;
  priceToWin: number | null;
  catalogSyncedAt: string | null;
  listingSyncedAt: string | null;
  isOperational: boolean;
  latestPublish: {
    id: string;
    status: string;
    desiredStatus: string | null;
    desiredPrice: number | null;
    error: string | null;
    createdAt: string | null;
  } | null;
  isHomologationFixture?: boolean;
};

export type MlListingMetrics = {
  total: number;
  active: number;
  paused: number;
  qualityRisk: number;
  priceReview: number;
};

export type MlListingQueueCounts = MlListingMetrics;

type VisualReviewParams = {
  review: BntD07VisualReview;
  taxRate: number;
  page: number;
  pageSize: number;
  search: string;
  focus: MlListingsFocus;
  quality: string;
  catalog: string;
  profitability: string;
  priceMin: number | null;
  priceMax: number | null;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
};

function normalizeObservedStatus(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ativo') return 'active';
  if (normalized === 'pausado') return 'paused';
  return normalized || 'unknown';
}

function qualityDetails(listing: Record<string, any>) {
  const qualityInfo = listing.qualityInfo || listing.qualidade_info || null;
  const qualityAvailable = qualityInfo?.source === 'mercado_livre_performance';
  const scoreValue = listing.qualityScore ?? listing.qualidade;
  const score = Number(scoreValue);
  const issue = Array.isArray(qualityInfo?.itens)
    ? qualityInfo.itens.find((item: any) => item?.ok === false)?.nome
    : null;
  return {
    qualityInfo: qualityAvailable ? qualityInfo : null,
    qualityAvailable,
    qualityScore: qualityAvailable && Number.isFinite(score) ? score : null,
    qualityPrimaryIssue: qualityAvailable
      ? String(qualityInfo?.dica || issue || '').trim() || null
      : null,
  };
}

function visualRows(review: BntD07VisualReview, taxRate: number): MlListingDashboardRow[] {
  const rows: MlListingDashboardRow[] = [];
  for (const item of review.items) {
    const product = item.product || {};
    const listings = Array.isArray(item.mlListings) ? item.mlListings : [];
    for (const rawListing of listings) {
      const listing = rawListing || {};
      const itemId = String(listing.itemId || listing.ml_item_id || '').trim().toUpperCase();
      if (!itemId) continue;
      const listingType = listing.type === 'catalog' || listing.catalogo === true ? 'catalog' : 'standard';
      const price = Number(listing.price ?? listing.preco_ml ?? product.custom_price ?? 0);
      const cost = Number(item.preferredOffer?.custo ?? product.custo ?? 0);
      const shipping = Number(product.ml_shipping || 0);
      const mlFee = Number(product.ml_fee || 0);
      const profit = price > 0 && Number.isFinite(cost)
        ? calculateNetProfitAtPrice({ price, cost, shipping, mlFee, taxRate })
        : null;
      const catalogStatus = listingType === 'catalog'
        ? (listing.catalogStatus || listing.catalog_status || 'perdendo') as MlCatalogStatus
        : 'sem_catalogo';
      const priceToWinValue = listing.priceToWin ?? listing.price_to_win;
      const priceToWin = Number(priceToWinValue);
      const quality = qualityDetails(listing);

      rows.push({
        itemId,
        productId: String(product.id || '') || null,
        productSku: String(product.sku || listing.sku || ''),
        productName: String(product.nome || listing.title || listing.titulo || itemId),
        listingTitle: String(listing.title || listing.titulo || product.nome || itemId),
        thumbnail: String(listing.thumbnail || product.imagens?.[0] || '').trim() || null,
        permalink: String(listing.permalink || '').trim() || null,
        listingType,
        catalogProductId: String(listing.catalogProductId || listing.catalog_product_id || '').trim() || null,
        relatedItemId: String(listing.relatedItemId || listing.related_item_id || '').trim() || null,
        price,
        profit,
        marginPercent: profit === null || price <= 0 ? null : Math.round((profit / price) * 10000) / 100,
        sold: Number(listing.sold ?? listing.vendidos ?? 0),
        visits: Number(listing.visits ?? listing.visitas ?? 0),
        ...quality,
        observedStatus: normalizeObservedStatus(listing.status || product.ml_status),
        localStatus: String(product.ml_status || listing.status || ''),
        blockReason: null,
        blockedUntil: null,
        lastError: null,
        catalogStatus,
        priceToWin: Number.isFinite(priceToWin) && priceToWin > 0 ? priceToWin : null,
        catalogSyncedAt: String(listing.catalogSyncedAt || listing.synced_at || '').trim() || null,
        listingSyncedAt: String(listing.listingSyncedAt || product.updated_at || '').trim() || null,
        isOperational: itemId === String(product.ml_item_id || '').trim().toUpperCase(),
        latestPublish: null,
        isHomologationFixture: true,
      });
    }
  }
  return rows;
}

function isPriceReview(row: MlListingDashboardRow) {
  return row.listingType === 'catalog'
    && row.catalogStatus !== 'ganhando'
    && row.priceToWin !== null
    && row.priceToWin > 0;
}

function matchesCommonFilters(row: MlListingDashboardRow, params: VisualReviewParams) {
  const search = params.search.trim().toLocaleLowerCase('pt-BR');
  if (search && ![row.itemId, row.productSku, row.productName, row.listingTitle]
    .join(' ').toLocaleLowerCase('pt-BR').includes(search)) return false;
  if (params.priceMin !== null && row.price < params.priceMin) return false;
  if (params.priceMax !== null && row.price > params.priceMax) return false;
  if (params.quality === 'risk' && !(row.qualityAvailable && Number(row.qualityScore) < 80)) return false;
  if (params.quality === 'good' && !(row.qualityAvailable && Number(row.qualityScore) >= 80 && Number(row.qualityScore) < 100)) return false;
  if (params.quality === 'perfect' && !(row.qualityAvailable && Number(row.qualityScore) >= 100)) return false;
  if (params.quality === 'unavailable' && row.qualityAvailable) return false;
  if (params.catalog === 'standard' && row.listingType !== 'standard') return false;
  if (params.catalog === 'catalog' && row.listingType !== 'catalog') return false;
  if (params.catalog === 'winning' && row.catalogStatus !== 'ganhando') return false;
  if (params.catalog === 'competing' && row.catalogStatus !== 'competindo') return false;
  if (params.catalog === 'losing' && row.catalogStatus !== 'perdendo') return false;
  if (params.profitability === 'positive' && !(row.profit !== null && row.profit >= 0)) return false;
  if (params.profitability === 'negative' && !(row.profit !== null && row.profit < 0)) return false;
  if (params.profitability === 'unknown' && row.profit !== null) return false;
  return true;
}

function matchesFocus(row: MlListingDashboardRow, focus: MlListingsFocus) {
  if (focus === 'active') return row.observedStatus === 'active';
  if (focus === 'paused') return row.observedStatus === 'paused';
  if (focus === 'quality_risk') return row.qualityAvailable && Number(row.qualityScore) < 80;
  if (focus === 'price_review') return isPriceReview(row);
  return true;
}

function sortValue(row: MlListingDashboardRow, sortBy: string): string | number | null {
  if (sortBy === 'item') return row.itemId;
  if (sortBy === 'price') return row.price;
  if (sortBy === 'profit') return row.profit;
  if (sortBy === 'sold') return row.sold;
  if (sortBy === 'visits') return row.visits;
  if (sortBy === 'quality') return row.qualityScore;
  if (sortBy === 'status') return row.observedStatus;
  if (sortBy === 'catalog') return row.catalogStatus;
  return row.productName;
}

export function listBntD11VisualReview(params: VisualReviewParams) {
  const common = visualRows(params.review, params.taxRate).filter((row) => matchesCommonFilters(row, params));
  const metrics: MlListingMetrics = {
    total: common.length,
    active: common.filter((row) => row.observedStatus === 'active').length,
    paused: common.filter((row) => row.observedStatus === 'paused').length,
    qualityRisk: common.filter((row) => row.qualityAvailable && Number(row.qualityScore) < 80).length,
    priceReview: common.filter(isPriceReview).length,
  };
  const focused = common.filter((row) => matchesFocus(row, params.focus));
  const direction = params.sortOrder === 'desc' ? -1 : 1;
  focused.sort((left, right) => {
    const a = sortValue(left, params.sortBy);
    const b = sortValue(right, params.sortBy);
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
    return String(a).localeCompare(String(b), 'pt-BR', { numeric: true }) * direction;
  });
  const offset = (params.page - 1) * params.pageSize;
  return {
    data: focused.slice(offset, offset + params.pageSize),
    total: focused.length,
    page: params.page,
    pageSize: params.pageSize,
    metrics,
    queueCounts: metrics,
    lastSyncedAt: common.map((row) => row.listingSyncedAt).filter(Boolean).sort().at(-1) || null,
    visualReview: params.review.metadata,
  };
}
