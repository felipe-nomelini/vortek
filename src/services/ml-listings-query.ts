import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { classifyMlPublishEligibility } from '@/lib/ml/publish-eligibility.js';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { listBntD11VisualReview, type MlListingsFocus } from '@/lib/ml/listings-dashboard';
import { loadPricingRequestContext } from '@/services/pricing-context';
import { queryListingReadModel } from '@/services/ui-read-model-query';

const PAGE_SIZE = 100;
const FOCUS = new Set<MlListingsFocus>(['all', 'active', 'paused', 'sold', 'visited_unsold', 'quality_risk', 'price_review']);
const QUALITY = new Set(['all', 'risk', 'good', 'perfect', 'unavailable']);
const CATALOG = new Set(['all', 'standard', 'catalog', 'winning', 'competing', 'losing']);
const PROFITABILITY = new Set(['all', 'positive', 'negative', 'unknown']);
const SORT_FIELDS = new Set(['item', 'product', 'price', 'profit', 'sold', 'visits', 'quality', 'status', 'catalog']);

function finiteNumber(value: string | null) {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function enrichPublishEligibility(row: Record<string, any>) {
  const qualityInfo = row.qualityInfo && typeof row.qualityInfo === 'object' ? row.qualityInfo : null;
  return {
    ...row,
    qualityInfo,
    qualityScore: row.qualityAvailable ? row.qualityScore : null,
    qualityPrimaryIssue: row.qualityAvailable ? row.qualityPrimaryIssue : null,
    qualityUnavailableReason: row.qualityAvailable
      ? null
      : String(qualityInfo?.reason || '').trim() || null,
    publishEligibility: classifyMlPublishEligibility({
      observedStatus: row.observedStatus,
      blockReason: row.blockReason,
      blockedUntil: row.blockedUntil,
    }),
  };
}

export async function getMlListingResponse(request: Request, allRows = false) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = allRows ? 1 : Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const pageSize = allRows ? Number.MAX_SAFE_INTEGER : PAGE_SIZE;
  const search = String(searchParams.get('search') || '').trim();
  const focusParam = searchParams.get('focus') || 'all';
  const focus = FOCUS.has(focusParam as MlListingsFocus) ? focusParam as MlListingsFocus : 'all';
  const qualityParam = searchParams.get('quality') || 'all';
  const quality = QUALITY.has(qualityParam) ? qualityParam : 'all';
  const catalogParam = searchParams.get('catalog') || 'all';
  const catalog = CATALOG.has(catalogParam) ? catalogParam : 'all';
  const profitabilityParam = searchParams.get('profitability') || 'all';
  const profitability = PROFITABILITY.has(profitabilityParam) ? profitabilityParam : 'all';
  const priceMin = finiteNumber(searchParams.get('priceMin'));
  const priceMax = finiteNumber(searchParams.get('priceMax'));
  const sortByParam = searchParams.get('sortBy') || (focus === 'visited_unsold' ? 'visits' : 'product');
  const sortBy = SORT_FIELDS.has(sortByParam) ? sortByParam : 'product';
  const sortOrder = searchParams.has('sortOrder')
    ? (searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc')
    : (focus === 'visited_unsold' ? 'desc' : 'asc');
  const soldOnly = searchParams.get('soldOnly') === 'true' || focus === 'sold';

  const serviceClient = createServiceClient();
  try {
    const visualReview = await loadBntD07VisualReview();

    if (visualReview) {
      const requestContext = await loadPricingRequestContext(serviceClient);
      const { taxContext: pricingTaxContext, commercial: commercialPricing } = requestContext;
      const taxRate = pricingTaxContext.appliedRate;
      const result = listBntD11VisualReview({
        review: visualReview,
        taxRate, commercialPricing,
        page,
        pageSize,
        search,
        focus,
        quality,
        catalog,
        profitability,
        priceMin,
        priceMax,
        sortBy,
        sortOrder,
        soldOnly,
      });
      return NextResponse.json({
        ...result,
        data: result.data.map((row) => ({
          ...row,
          publishEligibility: {
            eligible: false,
            kind: 'terminally_blocked',
            reason: 'homologation_fixture_read_only',
            observedStatus: row.observedStatus,
            retryAt: null,
          },
        })),
        pricingTaxContext,
      });
    }

    const result = await queryListingReadModel(serviceClient as any, {
      p_page: page,
      p_page_size: allRows ? 500 : pageSize,
      p_search: search || null,
      p_focus: focus,
      p_quality: quality,
      p_catalog: catalog,
      p_profitability: profitability,
      p_price_min: priceMin,
      p_price_max: priceMax,
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
      p_sold_only: soldOnly,
    }, allRows);
    return NextResponse.json({
      data: (Array.isArray(result.data) ? result.data : []).map(enrichPublishEligibility),
      total: Number(result.total || 0),
      page: Number(result.page || page),
      pageSize: Number(result.pageSize || pageSize),
      metrics: result.metrics || {},
      queueCounts: result.queueCounts || {},
      lastSyncedAt: result.lastSyncedAt || null,
      pricingTaxContext: result.pricingTaxContext || null,
      freshness: result.freshness || null,
      visualReview: null,
    });
  } catch (error: any) {
    console.error('[api/anuncios] Falha ao consultar central de anúncios:', error?.message || error);
    return NextResponse.json(
      { erro: error?.message || 'Falha ao carregar anúncios do Mercado Livre' },
      { status: 500 },
    );
  }
}
