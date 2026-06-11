import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { assertVortekSku } from '@/lib/product-master-sku';
import {
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  type SupplierFilterOption,
} from '@/lib/produto-filtering';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

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
  try {
    supplierOptions = await listActiveSupplierOptions(serviceClient);
  } catch (error: any) {
    console.error('[api/produtos] Falha ao carregar fornecedores:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao carregar fornecedores' }, { status: 500 });
  }

  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);
  const { data: rpcResult, error: rpcError } = await serviceClient.rpc('search_produtos_paginated', {
    p_search: search || null,
    p_supplier_dslite_ids: supplierFilterDsliteIds,
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
  });

  if (rpcError) {
    console.error('[api/produtos] Falha na RPC search_produtos_paginated:', rpcError.message);
    return NextResponse.json({ erro: rpcError.message || 'Falha ao carregar produtos' }, { status: 500 });
  }

  const result = (rpcResult || {}) as Record<string, any>;

  return NextResponse.json({
    data: result.data || [],
    total: Number(result.total || 0),
    page: Number(result.page || page),
    pageSize: Number(result.pageSize || pageSize),
    fornecedores: supplierOptions,
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
    const outbox = await enqueueMlPublishOutbox(createServiceClient(), {
      produtoId: String((data as any).id),
      mlItemId: String((data as any).ml_item_id),
      desiredStatus: ((data as any).ml_status || null) as any,
      desiredPrice: typeof (data as any).custom_price === 'number' ? (data as any).custom_price : null,
      desiredQuantity: typeof (data as any).estoque === 'number' ? (data as any).estoque : null,
      source: 'produto_create',
      payload: { origin: 'api/produtos POST' },
    });
    if (!outbox.ok) {
      warning = outbox.error;
    }
  }

  return NextResponse.json(
    warning ? { data, warning: `Produto criado, mas falhou ao enfileirar publicação ML: ${warning}` } : data,
    { status: 201 },
  );
}
