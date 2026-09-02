import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { assertVortekSku } from '@/lib/product-master-sku';
import {
  loadProductFulfillmentCapacities,
  loadProductFulfillmentCapacity,
} from '@/lib/orders/fulfillment-capacity-loader';
import {
  INTERNAL_SUPPLIER_FILTER_OPTION,
  includesInternalSupplierFilter,
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  type SupplierFilterOption,
} from '@/lib/produto-filtering';
import { loadPricingTaxContext, requirePricingTaxRate } from '@/services/pricing-tax-context';
import {
  listBntD07VisualReview,
  loadBntD07VisualReview,
} from '@/lib/products/bnt-d07-visual-review';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();
  const pricingTaxContext = await loadPricingTaxContext(serviceClient);
  const taxRate = requirePricingTaxRate(pricingTaxContext);

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const search = searchParams.get('search') || '';
  const pageSize = 100;

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
  const hasPriceFilter = priceMin !== null || priceMax !== null;
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
      visualReview: visualReview.metadata,
    });
  }

  const { data: rpcResult, error: rpcError } = await serviceClient.rpc('search_produtos_paginated', {
    p_search: search || null,
    p_supplier_dslite_ids: supplierFilterDsliteIds,
    p_include_internal: includesInternalSupplierFilter(fornecedorFilterIds),
    p_product_active_status: productActiveStatus,
    p_ml_status: mlStatus || null,
    p_estoque: estoque || null,
    p_price_min: priceMin,
    p_price_max: priceMax,
    p_price_field: priceField,
    p_page: page,
    p_page_size: pageSize,
    p_sort_by: sortBy,
    p_sort_order: sortOrder,
    p_tax_rate: taxRate,
  });

  if (rpcError) {
    console.error('[api/produtos] Falha na RPC search_produtos_paginated:', rpcError.message);
    return NextResponse.json({ erro: rpcError.message || 'Falha ao carregar produtos' }, { status: 500 });
  }

  const result = (rpcResult || {}) as Record<string, any>;
  const rows = Array.isArray(result.data) ? result.data : [];
  const productIds = rows
    .map((item: any) => String(item?.product?.id || '').trim())
    .filter(Boolean);

  let fulfillmentCapacities;
  let kitProductIds = new Set<string>();
  try {
    const [capacities, kitsResult] = await Promise.all([
      loadProductFulfillmentCapacities(serviceClient, productIds),
      productIds.length > 0
        ? (serviceClient as any)
          .from('produto_kits')
          .select('produto_id')
          .in('produto_id', productIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (kitsResult.error) throw new Error(kitsResult.error.message);
    fulfillmentCapacities = capacities;
    kitProductIds = new Set((kitsResult.data || []).map((kit: any) => String(kit.produto_id)));
  } catch (error: any) {
    console.error('[api/produtos] Falha ao carregar capacidade operacional:', error?.message || error);
    return NextResponse.json(
      { erro: error?.message || 'Falha ao carregar capacidade operacional dos produtos' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: rows.map((item: any) => {
      const productId = String(item?.product?.id || '');
      return {
        ...item,
        fulfillmentCapacity: fulfillmentCapacities.get(productId) || { internal: 0, supplier: 0, safe: 0 },
        isKit: kitProductIds.has(productId),
      };
    }),
    total: Number(result.total || 0),
    page: Number(result.page || page),
    pageSize: Number(result.pageSize || pageSize),
    fornecedores: supplierOptions,
    pricingTaxContext,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const body = await request.json();
  let payload = { ...body } as Record<string, any>;
  if ('sku' in payload) {
    try {
      payload.sku = assertVortekSku(payload.sku);
    } catch (error: any) {
      return NextResponse.json({ erro: error?.message || 'SKU mestre inválido' }, { status: 422 });
    }
  } else {
    delete payload.sku;
  }
  if ('dslite_fornecedor_id' in payload) payload.dslite_fornecedor_id = String(payload.dslite_fornecedor_id || '').trim();
  if ('dslite_produto_id' in payload) payload.dslite_produto_id = String(payload.dslite_produto_id || '').trim();

  const { data, error } = await serviceClient.from('produtos').insert(payload).select().single();

  if (error) {
    const msg = error.message || '';
    const details = String((error as any).details || '');
    if (
      msg.includes('produtos_sku_upper_unique') ||
      msg.includes('produtos_sku_key') ||
      details.includes('produtos_sku_upper_unique') ||
      details.includes('produtos_sku_key')
    ) {
      return NextResponse.json({ erro: 'SKU já cadastrado' }, { status: 409 });
    }
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
  let warning: string | null = null;
  if (String((data as any)?.ml_item_id || '').trim()) {
    const capacity = await loadProductFulfillmentCapacity(
      serviceClient,
      String((data as any).id),
    );
    const outbox = await enqueueMlPublishOutbox(createServiceClient(), {
      produtoId: String((data as any).id),
      mlItemId: String((data as any).ml_item_id),
      desiredStatus: ((data as any).ml_status || null) as any,
      desiredPrice: typeof (data as any).custom_price === 'number' ? (data as any).custom_price : null,
      desiredQuantity: capacity.safe,
      source: 'produto_create',
      dedupePending: true,
      payload: {
        apply_price: typeof (data as any).custom_price === 'number',
        apply_quantity_pricing: false,
        apply_quantity: true,
        apply_status: Boolean((data as any).ml_status),
        origin: 'api/produtos POST',
        estoque_fornecedor: capacity.supplier,
        estoque_interno: capacity.internal,
        estoque_disponivel: capacity.safe,
      },
    });
    if (!outbox.ok) {
      warning = outbox.error;
    } else if (outbox.action === 'skipped_ineligible') {
      warning = `publicação ML não enfileirada: ${outbox.reason}`;
    }
  }

  return NextResponse.json(
    warning ? { data, warning: `Produto criado, mas falhou ao enfileirar publicação ML: ${warning}` } : data,
    { status: 201 },
  );
}
