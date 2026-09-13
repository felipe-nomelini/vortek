import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { applyNoCatalogFilters, parseNoCatalogFilters, resolveCatalogDisplaySku } from '@/lib/catalogo/no-catalogo';
import { catalogOperationalPresentation, type CatalogOperationalView } from '@/lib/catalogo/dashboard';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { listBntD12CatalogVisualReview } from '@/lib/catalogo/visual-review';
import { evaluateProductPricing, loadProductPricing, loadPricingRequestContext, type ProductPricing } from '@/services/pricing-context';
import { pricingView } from '@/lib/pricing-view';
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

function economicSummary(memory: any, source: 'live_saved' | 'estimated' | 'unavailable', calculatedAt?: string | null) {
  if (!memory || !Number.isFinite(Number(memory.resultCents)) || !Number.isFinite(Number(memory.margin))) {
    return { profit: null, marginPercent: null, source: 'unavailable' as const, calculatedAt: calculatedAt || null };
  }
  return {
    profit: Number(memory.resultCents) / 100,
    marginPercent: Number(memory.margin) * 100,
    source,
    calculatedAt: calculatedAt || memory.evaluatedAt || null,
  };
}

function latestSavedEconomics(evaluations: any[], row: SnapshotRow) {
  const currentPriceCents = Math.round(Number(row.price || 0) * 100);
  const competitivePriceCents = row.price_to_win == null ? null : Math.round(Number(row.price_to_win) * 100);
  for (const evaluation of evaluations) {
    const assessment = evaluation?.result?.competitiveAssessment;
    const evidence = assessment?.evidence;
    if (!assessment || evidence?.itemId !== row.ml_item_id) continue;
    if (Number(evidence.currentPriceCents) !== currentPriceCents) continue;
    if ((evidence.priceCents == null ? null : Number(evidence.priceCents)) !== competitivePriceCents) continue;
    return {
      current: economicSummary(assessment.current?.memory, 'live_saved', evaluation.created_at),
      competitive: economicSummary(assessment.competitive?.memory, 'live_saved', evaluation.created_at),
    };
  }
  return null;
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
  const [{ data: products }, { data: relatedListings }, { data: evaluations }, requestContext] = await Promise.all([
    productIds.length
      ? service.from('produtos').select('id,sku,nome,ativo,oferta_preferencial_id,fornecedor_preferencial_manual,ml_item_id,custom_price').in('id', productIds)
      : Promise.resolve({ data: [] }),
    relatedIds.length
      ? service.from('anuncios_ml').select('ml_item_id,status').in('ml_item_id', relatedIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? service.from('pricing_evaluations').select('produto_id,result,created_at').in('produto_id', productIds)
        .order('created_at', { ascending: false }).limit(Math.min(1000, productIds.length * 10))
      : Promise.resolve({ data: [] }),
    productIds.length ? loadPricingRequestContext(service).catch(() => null) : Promise.resolve(null),
  ]);
  const productsById = new Map((products || []).map((product: any) => [String(product.id), product]));
  const relatedById = new Map((relatedListings || []).map((listing: any) => [String(listing.ml_item_id), listing]));

  const pricingByListing = new Map<string, ProductPricing>();
  const pendingPricingRows = requestContext ? [...snapshotRows] : [];
  while (pendingPricingRows.length) {
    const batch: SnapshotRow[] = [];
    const seenProducts = new Set<string>();
    for (let index = 0; index < pendingPricingRows.length && batch.length < 100;) {
      const row = pendingPricingRows[index];
      if (!row.produto_id || !productsById.has(row.produto_id)) {
        pendingPricingRows.splice(index, 1);
        continue;
      }
      if (seenProducts.has(row.produto_id)) {
        index += 1;
        continue;
      }
      seenProducts.add(row.produto_id);
      batch.push(row);
      pendingPricingRows.splice(index, 1);
    }
    if (!batch.length) break;
    const evidence = new Map(batch.map((row) => [row.produto_id!, {
      mlItemId: row.ml_item_id,
      currentPriceCents: Math.round(Number(row.price || 0) * 100),
      marketContextKey: `listing:${row.ml_item_id}:catalog-list`,
    }]));
    const competitivePrices = new Map(batch.map((row) => [row.produto_id!, row.price_to_win == null
      ? null : Math.round(Number(row.price_to_win) * 100)]));
    try {
      const pricing = await loadProductPricing(service, batch.map((row) => productsById.get(row.produto_id!)!), {
        requestContext: requestContext!,
        evidence,
        evaluate: (base, currentPriceCents, feeRate, observedFee) => {
          const current = evaluateProductPricing(base, currentPriceCents, feeRate, observedFee);
          const competitivePriceCents = competitivePrices.get(base.context.productId || '') ?? null;
          if (competitivePriceCents === null) return current;
          const competitive = evaluateProductPricing(base, competitivePriceCents, feeRate).current;
          return { ...current, comparisons: { ...(current.comparisons || {}), competitive } };
        },
      });
      for (const row of batch) {
        const economic = pricing.get(row.produto_id!);
        if (economic) pricingByListing.set(row.ml_item_id, economic);
      }
    } catch {
      // A lista continua disponível; apenas o resultado econômico fica inconclusivo.
    }
  }

  const rows = snapshotRows.map((row) => {
    const pricing = pricingByListing.get(row.ml_item_id);
    const currentView = pricingView(pricing);
    const saved = latestSavedEconomics((evaluations || []).filter((entry: any) => entry.produto_id === row.produto_id), row);
    const estimated = {
      current: currentView.profit == null || currentView.margin == null
        ? economicSummary(null, 'unavailable')
        : { profit: currentView.profit, marginPercent: currentView.margin, source: 'estimated' as const,
          calculatedAt: requestContext?.evaluatedAt || null },
      competitive: economicSummary(pricing?.comparisons?.competitive?.memory, 'estimated', requestContext?.evaluatedAt),
    };
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
      operational,
      economics: saved || estimated,
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
