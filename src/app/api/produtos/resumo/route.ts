import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';
import {
  buildOffersByProductId,
  fetchAllTableRows,
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  matchesProductMasterFilters,
  type ProdutoFilterOfferRow,
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
  const hasPriceFilter = priceMin !== null || priceMax !== null;

  function computeDerived(item: Record<string, any>): { displayPrice: number; profit: number | null } {
    try {
      const result = calculateSuggestedPrice({
        cost: Number(item.custo || 0),
        shipping: Number(item.ml_shipping || 0),
        mlFee: Number(item.ml_fee || 0.15),
      });
      const displayPrice = Math.round(((item.custom_price ?? result.suggestedPrice) || 0) * 100) / 100;

      if (item.ml_status === 'sem_anuncio') {
        return { displayPrice, profit: null };
      }

      const tax = displayPrice * 0.04;
      const mlFeeAmount = displayPrice * Number(item.ml_fee || 0.15);
      const netProfit = displayPrice - Number(item.custo || 0) - Number(item.ml_shipping || 0) - tax - mlFeeAmount;
      return { displayPrice, profit: Math.round(netProfit * 100) / 100 };
    } catch {
      return {
        displayPrice: Math.round(((item.custom_price ?? item.custo) || 0) * 100) / 100,
        profit: null,
      };
    }
  }

  function matchesFilters(item: Record<string, any>, offers: ProdutoFilterOfferRow[]): boolean {
    if (!matchesProductMasterFilters({
      product: item,
      offers,
      search,
      supplierFilterIds: supplierFilterDsliteIds,
      productActiveStatus,
      mlStatus,
      estoque,
    })) {
      return false;
    }

    if (!hasPriceFilter) return true;
    const { displayPrice, profit } = computeDerived(item);
    let value = 0;
    if (priceField === 'cost') {
      value = Number(item.custo || 0);
    } else if (priceField === 'suggestedPrice') {
      value = displayPrice;
    } else {
      if (profit === null) return false;
      value = profit;
    }
    if (priceMin !== null && value < priceMin) return false;
    if (priceMax !== null && value > priceMax) return false;
    return true;
  }

  let rows: Array<Record<string, any>> = [];
  let allOffers: ProdutoFilterOfferRow[] = [];
  let supplierOptions: SupplierFilterOption[] = [];
  try {
    [rows, allOffers, supplierOptions] = await Promise.all([
      fetchAllTableRows<Record<string, any>>(serviceClient, 'produtos', '*', [{ column: 'created_at', ascending: false }]),
      fetchAllTableRows<ProdutoFilterOfferRow>(
        serviceClient,
        'produto_fornecedor_ofertas',
        'id,produto_id,dslite_fornecedor_id,fornecedor_nome,sku_oferta,sku_fornecedor,nome',
        [
          { column: 'produto_id', ascending: true },
          { column: 'id', ascending: true },
        ],
      ),
      listActiveSupplierOptions(serviceClient),
    ]);
  } catch (error: any) {
    console.error('[api/produtos/resumo] Falha ao carregar produtos mestres:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao carregar produtos' }, { status: 500 });
  }

  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);
  const offersByProductId = buildOffersByProductId(allOffers);
  const filteredRows = rows.filter((item) => (
    matchesFilters(item, offersByProductId.get(String(item.id || '').trim()) || [])
  ));

  let total = filteredRows.length;
  let comEstoque = 0;
  let semAnuncio = 0;
  let receitaPotencial = 0;
  let lucroSum = 0;
  let lucroCount = 0;

  for (const item of filteredRows) {
    const estoqueAtual = Number(item.estoque || 0);
    if (estoqueAtual > 0) comEstoque++;
    if (item.ml_status === 'sem_anuncio') semAnuncio++;

    const { displayPrice, profit } = computeDerived(item);
    receitaPotencial += displayPrice * estoqueAtual;
    if (profit !== null) {
      lucroSum += profit;
      lucroCount++;
    }
  }

  const lucroMedio = lucroCount > 0 ? lucroSum / lucroCount : 0;

  return NextResponse.json({
    total: total || 0,
    comEstoque: comEstoque || 0,
    semAnuncio: semAnuncio || 0,
    receitaPotencial: Math.round(receitaPotencial * 100) / 100,
    lucroMedio: Math.round(lucroMedio * 100) / 100,
  });
}
