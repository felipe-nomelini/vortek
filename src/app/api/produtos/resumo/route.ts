import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
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
  const search = searchParams.get('search') || '';
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
  let supplierOptions: SupplierFilterOption[] = [];
  try {
    supplierOptions = await listActiveSupplierOptions(serviceClient);
  } catch (error: any) {
    console.error('[api/produtos/resumo] Falha ao carregar fornecedores:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao carregar fornecedores' }, { status: 500 });
  }

  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);
  const { data: rpcResult, error: rpcError } = await serviceClient.rpc('search_produtos_resumo', {
    p_search: search || null,
    p_supplier_dslite_ids: supplierFilterDsliteIds,
    p_product_active_status: productActiveStatus,
    p_ml_status: mlStatus || null,
    p_estoque: estoque || null,
    p_price_min: priceMin,
    p_price_max: priceMax,
    p_price_field: priceField,
  });

  if (rpcError) {
    console.error('[api/produtos/resumo] Falha na RPC search_produtos_resumo:', rpcError.message);
    return NextResponse.json({ erro: rpcError.message || 'Falha ao carregar resumo de produtos' }, { status: 500 });
  }

  const result = (rpcResult || {}) as Record<string, any>;

  return NextResponse.json({
    total: Number(result.total || 0),
    comEstoque: Number(result.comEstoque || 0),
    semAnuncio: Number(result.semAnuncio || 0),
    receitaPotencial: Number(result.receitaPotencial || 0),
    lucroMedio: Number(result.lucroMedio || 0),
  });
}
