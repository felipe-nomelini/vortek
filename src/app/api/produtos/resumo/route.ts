import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const fornecedorFilter = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
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

  function computeDerived(item: any): { displayPrice: number; profit: number | null } {
    try {
      const result = calculateSuggestedPrice({
        cost: item.custo || 0,
        shipping: item.ml_shipping || 0,
        mlFee: item.ml_fee || 0.15,
      });
      const displayPrice = Math.round((item.custom_price ?? result.suggestedPrice) * 100) / 100;

      if (item.ml_status === 'sem_anuncio') {
        return { displayPrice, profit: null };
      }

      const tax = displayPrice * 0.04;
      const mlFeeAmount = displayPrice * (item.ml_fee || 0.15);
      const netProfit = displayPrice - (item.custo || 0) - (item.ml_shipping || 0) - tax - mlFeeAmount;
      return { displayPrice, profit: Math.round(netProfit * 100) / 100 };
    } catch {
      return {
        displayPrice: Math.round(((item.custom_price ?? item.custo) || 0) * 100) / 100,
        profit: null,
      };
    }
  }

  function matchesPriceFilter(item: any): boolean {
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

  // Build base query with direct filters
  function applyFilters(query: any) {
    if (search) {
      query = query.or(`nome.ilike.%${search}%,sku.ilike.%${search}%`);
    }
    if (fornecedorFilter.length > 0) {
      query = query.in('fornecedor', fornecedorFilter);
    }
    if (mlStatus) {
      query = query.eq('ml_status', mlStatus);
    }
    if (estoque === 'com_estoque') {
      query = query.gt('estoque', 0);
    } else if (estoque === 'sem_estoque') {
      query = query.eq('estoque', 0);
    }
    return query;
  }

  const chunkSize = 1000;
  const allRows: any[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from('produtos').select('estoque, custo, ml_shipping, ml_fee, custom_price, ml_status');
    query = applyFilters(query);
    const { data, error } = await query
      .order('sku', { ascending: true })
      .range(offset, offset + chunkSize - 1);
    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }
    const rows = data || [];
    allRows.push(...rows);
    if (rows.length < chunkSize) break;
    offset += chunkSize;
  }

  const filteredRows = hasPriceFilter ? allRows.filter(matchesPriceFilter) : allRows;

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
