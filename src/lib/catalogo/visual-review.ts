import type { BntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { catalogCompetitionPresentation, classifyCatalogEligibility } from '@/lib/catalogo/dashboard';

function text(value: unknown) {
  return String(value || '').trim();
}

function normalizedStatus(value: unknown) {
  const status = text(value).toLowerCase();
  if (status === 'ativo') return 'active';
  if (status === 'pausado') return 'paused';
  return status || 'unknown';
}

function rawCompetitionStatus(listing: Record<string, any>) {
  const raw = text(listing.buyBoxStatus || listing.buy_box_status).toLowerCase();
  if (raw) return raw;
  const summarized = text(listing.catalogStatus || listing.catalog_status).toLowerCase();
  if (summarized === 'ganhando') return 'winning';
  if (summarized === 'competindo') return 'competing';
  if (summarized === 'perdendo') return 'not_listed';
  return null;
}

export function listBntD12CatalogVisualReview(params: {
  review: BntD07VisualReview;
  search: string;
  statusMl: string;
  competition: string;
  priceMin: number | null;
  priceMax: number | null;
  page: number;
  pageSize: number;
}) {
  const allRows: Array<Record<string, any>> = [];
  for (const item of params.review.items) {
    const product = item.product || {};
    const listings = Array.isArray(item.mlListings) ? item.mlListings : [];
    const standardListings = listings.filter((listing) => listing.type !== 'catalog' && listing.catalogo !== true);
    for (const listing of listings.filter((entry) => entry.type === 'catalog' || entry.catalogo === true)) {
      const mlItemId = text(listing.itemId || listing.ml_item_id).toUpperCase();
      if (!mlItemId) continue;
      const related = standardListings.find((entry) => (
        text(entry.itemId || entry.ml_item_id).toUpperCase() === text(listing.relatedItemId || listing.related_item_id).toUpperCase()
      )) || standardListings[0] || null;
      const buyBoxStatus = rawCompetitionStatus(listing);
      allRows.push({
        anuncio_id: mlItemId,
        ml_item_id: mlItemId,
        relacionado_id: text(listing.relatedItemId || listing.related_item_id || related?.itemId || related?.ml_item_id) || null,
        related_permalink: null,
        related_status: related ? normalizedStatus(related.status) : null,
        title: text(listing.title || listing.titulo || product.nome),
        seller_sku: text(listing.sku || product.sku) || null,
        sku_local: text(product.sku) || null,
        produto_id: text(product.id) || null,
        produto_nome: text(product.nome) || text(listing.title || listing.titulo),
        catalog_product_id: text(listing.catalogProductId || listing.catalog_product_id) || null,
        status: normalizedStatus(listing.status || product.ml_status),
        buy_box_status: buyBoxStatus,
        price_to_win: Number(listing.priceToWin ?? listing.price_to_win) || null,
        price: Number(listing.price ?? listing.preco_ml ?? product.custom_price ?? 0),
        permalink: null,
        thumbnail: text(listing.thumbnail || product.imagens?.[0]) || null,
        category_id: text(listing.category_id) || null,
        domain_id: text(listing.domain_id) || null,
        catalog_listing: true,
        item_relations: null,
        last_updated: text(listing.listingSyncedAt || listing.synced_at || product.updated_at) || null,
        isHomologationFixture: true,
      });
    }
  }

  const search = params.search.toLocaleLowerCase('pt-BR');
  const common = allRows.filter((row) => {
    if (search && ![
      row.ml_item_id,
      row.relacionado_id,
      row.produto_nome,
      row.sku_local,
      row.catalog_product_id,
    ].join(' ').toLocaleLowerCase('pt-BR').includes(search)) return false;
    if (params.statusMl !== 'all' && row.status !== params.statusMl) return false;
    if (params.priceMin !== null && row.price < params.priceMin) return false;
    if (params.priceMax !== null && row.price > params.priceMax) return false;
    return true;
  });
  const metrics = {
    total: common.length,
    winning: common.filter((row) => catalogCompetitionPresentation(row.buy_box_status).key === 'winning').length,
    sharingFirstPlace: common.filter((row) => catalogCompetitionPresentation(row.buy_box_status).key === 'sharing_first_place').length,
    competing: common.filter((row) => catalogCompetitionPresentation(row.buy_box_status).key === 'competing').length,
    outside: common.filter((row) => catalogCompetitionPresentation(row.buy_box_status).key === 'outside').length,
  };
  const filtered = params.competition === 'all'
    ? common
    : common.filter((row) => catalogCompetitionPresentation(row.buy_box_status).key === params.competition);
  const offset = (params.page - 1) * params.pageSize;

  return {
    data: filtered.slice(offset, offset + params.pageSize),
    total: filtered.length,
    page: params.page,
    pageSize: params.pageSize,
    metrics,
    lastSyncedAt: common.map((row) => row.last_updated).filter(Boolean).sort().at(-1) || null,
    visualReview: params.review.metadata,
  };
}

export function listBntD12EligibleVisualReview(params: {
  review: BntD07VisualReview;
  search: string;
  statusMl: string;
  actionState: string;
  priceMin: number | null;
  priceMax: number | null;
  page: number;
  pageSize: number;
}) {
  const allRows: Array<Record<string, any>> = [];
  let index = 0;
  for (const item of params.review.items) {
    const product = item.product || {};
    const listings = Array.isArray(item.mlListings) ? item.mlListings : [];
    const catalogSibling = listings.find((listing) => listing.type === 'catalog' || listing.catalogo === true);
    const catalogProductId = text(catalogSibling?.catalogProductId || catalogSibling?.catalog_product_id);
    for (const listing of listings.filter((entry) => entry.type !== 'catalog' && entry.catalogo !== true)) {
      const itemId = text(listing.itemId || listing.ml_item_id).toUpperCase();
      if (!itemId || !catalogProductId) continue;
      const variant = index % 4;
      const row: Record<string, any> = {
        ml_item_id: itemId,
        title: text(listing.title || listing.titulo || product.nome),
        seller_sku: text(listing.sku || product.sku) || null,
        local_product_id: variant === 3 ? null : text(product.id) || null,
        local_product_name: text(product.nome) || null,
        status: normalizedStatus(listing.status || product.ml_status),
        status_label: normalizedStatus(listing.status || product.ml_status) === 'active' ? 'Ativo' : 'Pausado',
        price: Number(listing.price ?? listing.preco_ml ?? product.custom_price ?? 0),
        permalink: null,
        thumbnail: text(listing.thumbnail || product.imagens?.[0]) || null,
        category_id: text(listing.category_id) || null,
        domain_id: text(listing.domain_id) || null,
        catalog_product_id: catalogProductId,
        catalog_product_name: text(catalogSibling?.title || catalogSibling?.titulo || product.nome),
        catalog_product_status: variant === 2 ? 'inactive' : 'active',
        eligibility_status: 'READY_FOR_OPTIN',
        eligibility_label: 'Pronto para catálogo',
        buy_box_eligible: true,
        eligibility_reason: null,
        variation_eligibility: [],
        catalog_product_warning: variant === 1 ? 'A correspondência de características precisa de revisão manual.' : null,
        last_updated: text(listing.listingSyncedAt || product.updated_at) || null,
        isHomologationFixture: true,
      };
      Object.assign(row, classifyCatalogEligibility(row));
      allRows.push(row);
      index += 1;
    }
  }

  const search = params.search.toLocaleLowerCase('pt-BR');
  const common = allRows.filter((row) => {
    if (search && ![row.ml_item_id, row.title, row.seller_sku, row.catalog_product_id, row.local_product_name]
      .join(' ').toLocaleLowerCase('pt-BR').includes(search)) return false;
    if (params.statusMl !== 'all' && row.status !== params.statusMl) return false;
    if (params.priceMin !== null && row.price < params.priceMin) return false;
    if (params.priceMax !== null && row.price > params.priceMax) return false;
    return true;
  });
  const metrics = {
    total: common.length,
    ready: common.filter((row) => row.state === 'ready').length,
    reviewRequired: common.filter((row) => row.state === 'review_required').length,
    catalogProductUnavailable: common.filter((row) => row.state === 'catalog_product_unavailable').length,
    localProductMissing: common.filter((row) => row.state === 'local_product_missing').length,
  };
  const filtered = params.actionState === 'all'
    ? common
    : common.filter((row) => row.state === params.actionState);
  const offset = (params.page - 1) * params.pageSize;

  return {
    data: filtered.slice(offset, offset + params.pageSize),
    total: filtered.length,
    page: params.page,
    pageSize: params.pageSize,
    metrics,
    visualReview: {
      ...params.review.metadata,
      simulatedEligibility: true,
    },
  };
}
