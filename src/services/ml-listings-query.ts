import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { classifyMlPublishEligibility } from '@/lib/ml/publish-eligibility.js';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { listBntD11VisualReview, selectMlListingRows, type MlListingDashboardRow, type MlListingsFocus } from '@/lib/ml/listings-dashboard';
import { loadPricingRequestContext, loadProductPricing } from '@/services/pricing-context';
import { pricingView } from '@/lib/pricing-view';

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
  const sortByParam = searchParams.get('sortBy') || 'product';
  const sortBy = SORT_FIELDS.has(sortByParam) ? sortByParam : 'product';
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';

  const serviceClient = createServiceClient();
  try {
    const requestContext = await loadPricingRequestContext(serviceClient);
    const { taxContext: pricingTaxContext, commercial: commercialPricing } = requestContext;
    const taxRate = pricingTaxContext.appliedRate;
    const visualReview = await loadBntD07VisualReview();

    if (visualReview) {
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

    const rows: MlListingDashboardRow[] = [];
    const seenItems = new Set<string>();
    for (let rawPage = 1; ; rawPage++) {
      const { data, error } = await (serviceClient as any).rpc('search_ml_listings_paginated', {
        p_tax_rate: null, p_page: rawPage, p_page_size: PAGE_SIZE,
        p_search: search || null, p_focus: 'all', p_quality: quality, p_catalog: catalog,
        p_profitability: 'all', p_price_min: priceMin, p_price_max: priceMax, p_sort_by: 'item', p_sort_order: 'asc',
      });
      if (error) throw new Error(error.message);
      const batch: MlListingDashboardRow[] = data?.data || [];
      if (!batch.length) break;
      for (const row of batch) {
        if (seenItems.has(row.itemId)) throw new Error('A lista mudou durante a leitura; atualize os filtros');
        seenItems.add(row.itemId);
      }
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    const productIds = [...new Set(rows.flatMap(row => row.productId ? [row.productId] : []))];
    const products = new Map<string, any>();
    for (let offset = 0; offset < productIds.length; offset += 100) {
      const { data, error } = await serviceClient.from('produtos').select('*').in('id', productIds.slice(offset, offset + 100));
      if (error) throw new Error('Falha ao carregar fontes econômicas dos anúncios');
      for (const product of data || []) products.set(product.id, product);
    }
    const pending = [...rows];
    while (pending.length) {
      const batch: MlListingDashboardRow[] = []; const ids = new Set<string>();
      for (let i = 0; i < pending.length && batch.length < 100;) {
        const row = pending[i];
        if (!row.productId || !products.has(row.productId)) { row.profit = null; row.marginPercent = null; pending.splice(i, 1); continue; }
        if (ids.has(row.productId)) { i++; continue; }
        ids.add(row.productId); batch.push(row); pending.splice(i, 1);
      }
      if (!batch.length) break;
      const evidence = new Map(batch.map(row => [row.productId!, { mlItemId: row.itemId,
        currentPriceCents: row.price > 0 ? Math.round(row.price * 100) : null, marketContextKey: `listing:${row.itemId}:unquoted` }]));
      const pricing = await loadProductPricing(serviceClient, batch.map(row => products.get(row.productId!)), { requestContext, evidence });
      for (const row of batch) {
        const view = pricingView(pricing.get(row.productId!));
        row.profit = view.profit; row.marginPercent = view.margin;
      }
    }
    const result = selectMlListingRows(rows, { page, pageSize, search, focus, quality, catalog,
      profitability, priceMin, priceMax, sortBy, sortOrder });
    return NextResponse.json({
      data: (Array.isArray(result.data) ? result.data : []).map(enrichPublishEligibility),
      total: Number(result.total || 0),
      page: Number(result.page || page),
      pageSize: Number(result.pageSize || pageSize),
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
