import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { applyNoCatalogFilters, parseNoCatalogFilters, resolveCatalogDisplaySku } from '@/lib/catalogo/no-catalogo';
import { catalogOperationalPresentation, type CatalogOperationalView } from '@/lib/catalogo/dashboard';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { listBntD12CatalogVisualReview } from '@/lib/catalogo/visual-review';
import { notApplicableCatalogEconomy, unavailableCatalogEconomy } from '@/lib/catalogo/visible-economics';
import type { Database } from '@/types/database';

type SnapshotRow = Database['public']['Tables']['catalogo_ml_snapshot']['Row'];

function parseOperationalView(value: string | null): CatalogOperationalView {
  return value === 'healthy' || value === 'all' ? value : 'needs_action';
}

function applyOperationalView(query: any, view: CatalogOperationalView) {
  if (view === 'healthy') {
    return query.eq('status', 'active').not('produto_id', 'is', null)
      .in('buy_box_status', ['winning', 'sharing_first_place']);
  }
  if (view === 'needs_action') {
    return query.or('status.neq.active,status.is.null,produto_id.is.null,buy_box_status.is.null,buy_box_status.not.in.(winning,sharing_first_place)');
  }
  return query;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const service = createServiceClient();
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 100)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sellerIdParam = searchParams.get('sellerId');
  const sellerId = sellerIdParam !== null ? Number(sellerIdParam) : null;
  const filters = parseNoCatalogFilters(searchParams);
  const operationalView = parseOperationalView(searchParams.get('view'));
  const sortByParam = String(searchParams.get('sortBy') || 'ml_item_id');
  const sortBy = new Set(['ml_item_id', 'title', 'status', 'price', 'price_to_win', 'buy_box_status']).has(sortByParam)
    ? sortByParam
    : 'ml_item_id';
  const ascending = searchParams.get('sortOrder') === 'asc';

  const visualReview = await loadBntD07VisualReview();
  if (visualReview) {
    return NextResponse.json(listBntD12CatalogVisualReview({
      review: visualReview,
      operationalView,
      search: filters.search,
      statusMl: filters.statusMl,
      competition: filters.buyBox,
      priceMin: filters.priceMin,
      priceMax: filters.priceMax,
      page,
      pageSize,
    }));
  }

  let countQuery: any = service
    .from('catalogo_ml_snapshot')
    .select('id', { count: 'exact', head: false })
    .eq('catalog_listing', true);
  if (sellerId !== null && Number.isFinite(sellerId)) {
    countQuery = countQuery.eq('seller_id', sellerId);
  }
  countQuery = applyNoCatalogFilters(countQuery, filters);
  countQuery = applyOperationalView(countQuery, operationalView);
  const metricsFilters = { ...filters, buyBox: 'all' as const };
  const metricsQuery = (view: CatalogOperationalView = 'all') => {
    let query: any = service
      .from('catalogo_ml_snapshot')
      .select('id', { count: 'exact', head: false })
      .eq('catalog_listing', true);
    if (sellerId !== null && Number.isFinite(sellerId)) query = query.eq('seller_id', sellerId);
    query = applyNoCatalogFilters(query, metricsFilters);
    query = applyOperationalView(query, view);
    return query.range(0, 0);
  };
  const [countResult, totalMetric, needsActionMetric, healthyMetric] = await Promise.all([
    countQuery.range(0, 0),
    metricsQuery(),
    metricsQuery('needs_action'),
    metricsQuery('healthy'),
  ]);
  const { count, error: countError } = countResult;
  if (countError) {
    return NextResponse.json({ erro: countError.message }, { status: 500 });
  }
  const metricsError = totalMetric.error || needsActionMetric.error || healthyMetric.error;
  if (metricsError) return NextResponse.json({ erro: metricsError.message }, { status: 500 });

  let dataQuery: any = service
    .from('catalogo_ml_snapshot')
    .select('*')
    .eq('catalog_listing', true);
  if (sellerId !== null && Number.isFinite(sellerId)) {
    dataQuery = dataQuery.eq('seller_id', sellerId);
  }
  dataQuery = applyNoCatalogFilters(dataQuery, filters);
  dataQuery = applyOperationalView(dataQuery, operationalView);
  const { data, error } = await dataQuery
    .order(sortBy, { ascending, nullsFirst: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const snapshotRows = (data || []) as SnapshotRow[];
  const productIds = Array.from(new Set(snapshotRows.map((row) => row.produto_id).filter(Boolean))) as string[];
  const relatedIds = Array.from(new Set(snapshotRows.map((row) => row.related_item_id).filter(Boolean))) as string[];
  const [{ data: products }, { data: relatedListings }] = await Promise.all([
    productIds.length
      ? service.from('produtos').select('id,sku,nome,ativo,oferta_preferencial_id,fornecedor_preferencial_manual,ml_item_id,custom_price').in('id', productIds)
      : Promise.resolve({ data: [] }),
    relatedIds.length
      ? service.from('anuncios_ml').select('ml_item_id,status').in('ml_item_id', relatedIds)
      : Promise.resolve({ data: [] }),
  ]);
  const productsById = new Map((products || []).map((product: any) => [String(product.id), product]));
  const relatedById = new Map((relatedListings || []).map((listing: any) => [String(listing.ml_item_id), listing]));

  const rows = snapshotRows.map((row) => {
    const pendingReason = row.produto_id ? 'CALCULATION_PENDING' as const : 'PRODUCT_UNLINKED' as const;
    const pending = { current: unavailableCatalogEconomy(pendingReason),
      competitive: row.price_to_win == null ? notApplicableCatalogEconomy('REFERENCE_NOT_AVAILABLE')
        : unavailableCatalogEconomy(pendingReason) };
    const operational = catalogOperationalPresentation(row);
    return {
      anuncio_id: row.ml_item_id,
    ml_item_id: row.ml_item_id,
    relacionado_id: row.related_item_id,
    related_permalink: row.related_permalink,
    title: row.title || '',
    seller_sku: row.seller_sku,
    sku_local: resolveCatalogDisplaySku({ skuLocal: row.sku_local, sellerSku: row.seller_sku }),
    produto_id: row.produto_id,
    produto_nome: productsById.get(String(row.produto_id || ''))?.nome || row.title || '',
    related_status: relatedById.get(String(row.related_item_id || ''))?.status || null,
    catalog_product_id: row.catalog_product_id,
    status: row.status,
    buy_box_status: row.buy_box_status,
    price_to_win: row.price_to_win,
    price: Number(row.price || 0),
    permalink: row.permalink,
    thumbnail: row.thumbnail,
    category_id: row.category_id,
    domain_id: row.domain_id,
    catalog_listing: row.catalog_listing,
    item_relations: null,
    last_updated: row.last_updated_ml,
      snapshot_synced_at: row.synced_at,
      operational,
      economics: pending,
    };
  });

  console.log(JSON.stringify({
    event: 'catalog_no_catalogo_query',
    seller_id: sellerId,
    page,
    page_size: pageSize,
    total_filtered: count || 0,
    status_ml: filters.statusMl,
    buy_box: filters.buyBox,
    search: Boolean(filters.search),
    timestamp_utc: new Date().toISOString(),
  }));

  return NextResponse.json({
    data: rows,
    total: count || 0,
    page,
    pageSize,
    metrics: {
      total: totalMetric.count || 0,
      needsAction: needsActionMetric.count || 0,
      healthy: healthyMetric.count || 0,
    },
    lastSyncedAt: snapshotRows.map((row) => row.synced_at).filter(Boolean).sort().at(-1) || null,
    visualReview: null,
  });
}
