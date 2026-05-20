import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const fornecedorFilter = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const mlStatus = searchParams.get('ml_status') || '';
  const estoque = searchParams.get('estoque') || '';

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

  // Total
  let totalQuery = supabase.from('produtos').select('*', { count: 'exact', head: false }).range(0, 0);
  totalQuery = applyFilters(totalQuery);
  const { count: total } = await totalQuery;

  // Com Estoque
  let comEstoqueQuery = supabase.from('produtos').select('*', { count: 'exact', head: false }).range(0, 0);
  comEstoqueQuery = applyFilters(comEstoqueQuery);
  comEstoqueQuery = comEstoqueQuery.gt('estoque', 0);
  const { count: comEstoque } = await comEstoqueQuery;

  // Sem Anúncio
  let semAnuncioQuery = supabase.from('produtos').select('*', { count: 'exact', head: false }).range(0, 0);
  semAnuncioQuery = applyFilters(semAnuncioQuery);
  semAnuncioQuery = semAnuncioQuery.eq('ml_status', 'sem_anuncio');
  const { count: semAnuncio } = await semAnuncioQuery;

  // Receita Potencial e Lucro Médio (sum over filtered)
  let sumQuery = supabase.from('produtos').select('estoque, custo, ml_shipping, ml_fee, custom_price, ml_status');
  sumQuery = applyFilters(sumQuery);
  const { data: sumData } = await sumQuery;

  let receitaPotencial = 0;
  let lucroSum = 0;
  let lucroCount = 0;

  for (const item of sumData || []) {
    const estoque = item.estoque || 0;
    // Preço de exibição = custom_price ou suggestedPrice
    let displayPrice: number;
    try {
      const { calculateSuggestedPrice } = await import('@/services/pricing');
      const result = calculateSuggestedPrice({
        cost: item.custo || 0,
        shipping: item.ml_shipping || 0,
        mlFee: item.ml_fee || 0.15,
      });
      displayPrice = item.custom_price ?? result.suggestedPrice;
      if (item.ml_status !== 'sem_anuncio') {
        lucroSum += result.netProfit;
        lucroCount++;
      }
    } catch {
      displayPrice = item.custom_price ?? item.custo ?? 0;
    }
    receitaPotencial += displayPrice * estoque;
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
