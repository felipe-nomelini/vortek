import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  INTERNAL_SUPPLIER_FILTER_OPTION, includesInternalSupplierFilter, listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds, type SupplierFilterOption,
} from '@/lib/produto-filtering';
import { loadPricingRequestContext } from '@/services/pricing-context';
import { queryProductReadModel } from '@/services/ui-read-model-query';
import { listBntD07VisualReview, loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';

export async function getProductListResponse(request: Request, allRows = false) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(request.url);
  const parsedPage = Number(searchParams.get('page') || 1);
  const page = allRows ? 1 : Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const search = searchParams.get('search') || '';
  const pageSize = allRows ? Number.MAX_SAFE_INTEGER : 100;

  const fornecedorFilterIds = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const productActiveStatusParam = searchParams.get('ativo') || 'ativo';
  const productActiveStatus = productActiveStatusParam === 'inativo' || productActiveStatusParam === 'todos'
    ? productActiveStatusParam
    : 'ativo';
  const mlStatus = searchParams.get('ml_status') || '';
  const estoque = searchParams.get('estoque') || '';
  const priceFieldParam = searchParams.get('priceField') || 'cost';
  const priceField: 'cost' | 'suggestedPrice' | 'profit' =
    priceFieldParam === 'suggestedPrice' || priceFieldParam === 'profit'
      ? priceFieldParam
      : 'cost';
  const rawPriceMin = searchParams.get('priceMin');
  const rawPriceMax = searchParams.get('priceMax');
  const parsedPriceMin = rawPriceMin !== null ? Number(rawPriceMin) : null;
  const parsedPriceMax = rawPriceMax !== null ? Number(rawPriceMax) : null;
  const priceMin = parsedPriceMin !== null && Number.isFinite(parsedPriceMin) ? parsedPriceMin : null;
  const priceMax = parsedPriceMax !== null && Number.isFinite(parsedPriceMax) ? parsedPriceMax : null;
  const rawSortBy = searchParams.get('sortBy') || 'sku';
  const rawSortOrder = searchParams.get('sortOrder') || 'asc';
  const allowedSortBy = new Set([
    'sku',
    'nome',
    'fornecedor',
    'estoque',
    'custo',
    'ml_fee',
    'ml_shipping',
    'suggested_price',
    'profit',
    'ml_status',
  ]);
  const sortBy = allowedSortBy.has(rawSortBy) ? rawSortBy : 'sku';
  const sortOrder = rawSortOrder === 'desc' ? 'desc' : 'asc';

  let supplierOptions: SupplierFilterOption[] = [];
  let visualReview;
  try {
    visualReview = await loadBntD07VisualReview();
    supplierOptions = visualReview
      ? [INTERNAL_SUPPLIER_FILTER_OPTION, ...visualReview.suppliers]
      : await listActiveSupplierOptions(serviceClient);
  } catch (error: any) {
    console.error('[api/produtos] Falha ao carregar contexto da lista:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao carregar contexto da lista' }, { status: 500 });
  }

  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);
  if (visualReview) {
    const requestContext = await loadPricingRequestContext(serviceClient);
    const { taxContext: pricingTaxContext, commercial: commercialPricing } = requestContext;
    const taxRate = pricingTaxContext.appliedRate;
    const fixtureResult = listBntD07VisualReview({
      review: visualReview,
      filters: {
        search,
        supplierDsliteIds: supplierFilterDsliteIds,
        includeInternal: includesInternalSupplierFilter(fornecedorFilterIds),
        productActiveStatus,
        mlStatus,
        stockStatus: estoque,
        priceField,
        priceMin,
        priceMax,
        taxRate,
        commercialPricing,
      },
      page,
      pageSize,
      sortBy,
      sortOrder,
    });

    return NextResponse.json({
      ...fixtureResult,
      fornecedores: supplierOptions,
      pricingTaxContext,
      commercialPricing,
      visualReview: visualReview.metadata,
    });
  }

  let projected;
  try {
    projected = await queryProductReadModel(serviceClient as any, {
      p_search: search || null,
      p_supplier_dslite_ids: supplierFilterDsliteIds,
      p_include_internal: includesInternalSupplierFilter(fornecedorFilterIds),
      p_product_active_status: productActiveStatus,
      p_ml_status: mlStatus || null,
      p_estoque: estoque || null,
      p_price_field: priceField,
      p_price_min: priceMin,
      p_price_max: priceMax,
      p_page: page,
      p_page_size: allRows ? 500 : pageSize,
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
    }, allRows);
  } catch {
    return NextResponse.json({ erro: 'Falha ao carregar a memória econômica dos produtos' }, { status: 500 });
  }
  return NextResponse.json({
    ...projected,
    fornecedores: supplierOptions,
  });
}
