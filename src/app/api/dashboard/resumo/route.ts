import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { saoPauloDateParamToUtcIso, saoPauloDayLabel } from '@/lib/timezone';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  function applyDateFilter(query: any) {
    const startIso = dateFrom ? saoPauloDateParamToUtcIso(dateFrom, 'start') : null;
    const endIso = dateTo ? saoPauloDateParamToUtcIso(dateTo, 'end') : null;
    if (startIso) query = query.gte('data', startIso);
    if (endIso) query = query.lte('data', endIso);
    return query;
  }

  // 1. Total de pedidos no período
  let countQuery = serviceClient.from('pedidos').select('*', { count: 'exact', head: false }).range(0, 0);
  countQuery = applyDateFilter(countQuery);
  const { count: totalPedidos } = await countQuery;

  // 2. Faturamento e lucro no período
  let sumQuery = serviceClient.from('pedidos').select('total, lucro');
  sumQuery = applyDateFilter(sumQuery);
  const { data: sumData } = await sumQuery;

  let faturamento = 0;
  let lucro = 0;
  for (const row of sumData || []) {
    faturamento += row.total || 0;
    lucro += row.lucro || 0;
  }

  // 3. Vendas diárias
  let dailyQuery = serviceClient.from('pedidos').select('data, total');
  dailyQuery = applyDateFilter(dailyQuery);
  const { data: dailyData } = await dailyQuery;

  const vendasDiariasMap: Record<string, number> = {};
  for (const row of dailyData || []) {
    const key = saoPauloDayLabel(row.data);
    if (!key) continue;
    vendasDiariasMap[key] = (vendasDiariasMap[key] || 0) + (row.total || 0);
  }
  const vendasDiarias = Object.entries(vendasDiariasMap)
    .sort((a, b) => {
      const [da, ma] = a[0].split('/').map(Number);
      const [db, mb] = b[0].split('/').map(Number);
      return ma === mb ? da - db : ma - mb;
    })
    .map(([dia, receita]) => ({ dia, receita: Math.round(receita * 100) / 100 }));

  // 4. Status dos pedidos no período
  let statusQuery = serviceClient.from('pedidos').select('situacao');
  statusQuery = applyDateFilter(statusQuery);
  const { data: statusData } = await statusQuery;

  const statusCounts: Record<string, number> = {};
  for (const row of statusData || []) {
    const s = row.situacao || 'aberto';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  // 5. Pedidos recentes (últimos 5)
  let recentQuery = serviceClient.from('pedidos').select('*');
  recentQuery = applyDateFilter(recentQuery);
  const { data: recentData } = await recentQuery
    .order('data', { ascending: false })
    .limit(5);

  const pedidosRecentes = (recentData || []).map((p: any) => ({
    numero: p.numero,
    cliente: p.contato_nome,
    total: p.total,
    situacao: p.situacao,
    data: p.data,
  }));

  // 6. Top produtos: usa anuncios_ml.vendidos agregado por produto
  const { data: anunciosData } = await serviceClient
    .from('anuncios_ml')
    .select('titulo, vendidos, preco_ml')
    .order('vendidos', { ascending: false })
    .limit(5);

  const topProdutos = (anunciosData || [])
    .filter((a: any) => a.vendidos > 0)
    .map((a: any) => ({
      nome: a.titulo,
      vendas: a.vendidos,
      receita: Math.round((a.vendidos * a.preco_ml) * 100) / 100,
    }))
    .slice(0, 5);

  // 7. Produtos ativos (independente de período)
  const { count: produtosAtivos } = await serviceClient
    .from('produtos')
    .select('*', { count: 'exact', head: false })
    .range(0, 0)
    .eq('ml_status', 'ativo');

  const { count: totalProdutos } = await serviceClient
    .from('produtos')
    .select('*', { count: 'exact', head: false })
    .range(0, 0);

  const ticketMedio = (totalPedidos || 0) > 0 ? faturamento / (totalPedidos || 1) : 0;

  return NextResponse.json({
    faturamento: Math.round(faturamento * 100) / 100,
    lucro: Math.round(lucro * 100) / 100,
    totalPedidos: totalPedidos || 0,
    ticketMedio: Math.round(ticketMedio * 100) / 100,
    vendasDiarias,
    statusCounts,
    pedidosRecentes,
    topProdutos,
    produtosAtivos: produtosAtivos || 0,
    totalProdutos: totalProdutos || 0,
  });
}
