import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

function hasApprovedPayment(pagamentoResumo: unknown): { approved: boolean; hasValidData: boolean } {
  if (!Array.isArray(pagamentoResumo) || pagamentoResumo.length === 0) {
    return { approved: false, hasValidData: false };
  }

  let hasValidData = false;
  for (const payment of pagamentoResumo) {
    if (!payment || typeof payment !== 'object') continue;
    const status = String((payment as { status?: unknown }).status || '').toLowerCase();
    if (!status) continue;
    hasValidData = true;
    if (status === 'approved') return { approved: true, hasValidData: true };
  }

  return { approved: false, hasValidData };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;

  // Build base query
  function applyFilters(query: any) {
    if (search) {
      query = query.or(`numero.ilike.%${search}%,contato_nome.ilike.%${search}%,ml_order_id.ilike.%${search}%,ml_pack_id.ilike.%${search}%`);
    }
    if (status) {
      query = query.eq('situacao', status);
    }
    if (dateFrom) {
      query = query.gte('data', dateFrom);
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      query = query.lte('data', end.toISOString());
    }
    if (priceMin !== null) {
      query = query.gte('total', priceMin);
    }
    if (priceMax !== null) {
      query = query.lte('total', priceMax);
    }
    return query;
  }

  // Count total
  let countQuery = supabase.from('pedidos').select('*', { count: 'exact', head: false }).range(0, 0);
  countQuery = applyFilters(countQuery);
  const { count } = await countQuery;

  // Sum total e lucro + métrica compatível ML (pagamento aprovado)
  let sumQuery = supabase.from('pedidos').select('total, lucro, pagamento_resumo');
  sumQuery = applyFilters(sumQuery);
  const { data: sumData } = await sumQuery;

  let totalSum = 0;
  let lucroSum = 0;
  let mlCompatibleCount = 0;
  let mlCompatibleTotal = 0;
  let mlCompatibleMissingPaymentData = 0;

  for (const row of sumData || []) {
    totalSum += row.total || 0;
    lucroSum += row.lucro || 0;

    const paymentCheck = hasApprovedPayment(row.pagamento_resumo);
    if (!paymentCheck.hasValidData) {
      mlCompatibleMissingPaymentData += 1;
      continue;
    }
    if (paymentCheck.approved) {
      mlCompatibleCount += 1;
      mlCompatibleTotal += row.total || 0;
    }
  }

  // Status counts via RPC ou group by
  let statusQuery = supabase
    .from('pedidos')
    .select('situacao')
    .not('situacao', 'is', null);
  statusQuery = applyFilters(statusQuery);
  const { data: statusData } = await statusQuery;

  const statusCounts: Record<string, number> = {};
  for (const row of statusData || []) {
    const s = row.situacao || 'aberto';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  const ticket = (count || 0) > 0 ? totalSum / (count || 1) : 0;
  const margem = totalSum > 0 ? (lucroSum / totalSum) * 100 : 0;

  return NextResponse.json({
    count: count || 0,
    total: totalSum,
    lucroSum,
    ticket,
    margem,
    statusCounts,
    mlCompatibleCount,
    mlCompatibleTotal,
    mlCompatibleMissingPaymentData,
  });
}
