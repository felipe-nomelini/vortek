import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { classifyMlPublishEligibility } from '@/lib/ml/publish-eligibility.js';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { listBntD11VisualReview, type MlListingsFocus } from '@/lib/ml/listings-dashboard';
import { loadPricingTaxContext, requirePricingTaxRate } from '@/services/pricing-tax-context';

const PAGE_SIZE = 100;
const FOCUS = new Set<MlListingsFocus>(['all', 'active', 'paused', 'quality_risk', 'price_review']);
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
  return {
    ...row,
    publishEligibility: classifyMlPublishEligibility({
      observedStatus: row.observedStatus,
      blockReason: row.blockReason,
      blockedUntil: row.blockedUntil,
    }),
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
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
  const sortByParam = searchParams.get('sortBy') || 'product';
  const sortBy = SORT_FIELDS.has(sortByParam) ? sortByParam : 'product';
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';

  const serviceClient = createServiceClient();
  try {
    const pricingTaxContext = await loadPricingTaxContext(serviceClient);
    const taxRate = requirePricingTaxRate(pricingTaxContext);
    const visualReview = await loadBntD07VisualReview();

    if (visualReview) {
      const result = listBntD11VisualReview({
        review: visualReview,
        taxRate,
        page,
        pageSize: PAGE_SIZE,
        search,
        focus,
        quality,
        catalog,
        profitability,
        priceMin,
        priceMax,
        sortBy,
        sortOrder,
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

    const { data, error } = await (serviceClient as any).rpc('search_ml_listings_paginated', {
      p_tax_rate: taxRate,
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_search: search || null,
      p_focus: focus,
      p_quality: quality,
      p_catalog: catalog,
      p_profitability: profitability,
      p_price_min: priceMin,
      p_price_max: priceMax,
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
    });
    if (error) throw new Error(error.message);

    const result = (data || {}) as Record<string, any>;
    return NextResponse.json({
      data: (Array.isArray(result.data) ? result.data : []).map(enrichPublishEligibility),
      total: Number(result.total || 0),
      page: Number(result.page || page),
      pageSize: Number(result.pageSize || PAGE_SIZE),
      metrics: result.metrics || {},
      queueCounts: result.queueCounts || {},
      lastSyncedAt: result.lastSyncedAt || null,
      pricingTaxContext,
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
