import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { saoPauloDateParamToUtcIso } from '@/lib/timezone';

function logDbError(
  event: string,
  endpoint: string,
  search: string,
  error: { code?: string; message?: string; details?: string } | null
) {
  console.error('[pedidos_resumo_api_error]', {
    event,
    endpoint,
    search,
    db_code: error?.code ?? null,
    db_message: error?.message ?? null,
    db_details: error?.details ?? null,
  });
}

function isMissingSaleDateColumnError(error: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  return error?.code === '42703' && String(error?.message || '').includes('data_venda');
}

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
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;
  const normalizedSearch = search.trim();
  const startDateIso = dateFrom ? saoPauloDateParamToUtcIso(dateFrom, 'start') : null;
  const endDateIso = dateTo ? saoPauloDateParamToUtcIso(dateTo, 'end') : null;

  if (normalizedSearch) {
    const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_resumo', {
      p_search: normalizedSearch,
      p_status: status || null,
      p_date_from: startDateIso,
      p_date_to: endDateIso,
      p_price_min: priceMin,
      p_price_max: priceMax,
    });

    if (rpcError) {
      logDbError('pedidos_resumo_search_rpc_failed', '/api/pedidos/resumo', normalizedSearch, rpcError);
      return NextResponse.json({ erro: 'Falha ao gerar resumo com filtro de busca.' }, { status: 500 });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const statusCounts = row?.status_counts && typeof row.status_counts === 'object' ? row.status_counts : {};

    return NextResponse.json({
      count: Number(row?.count ?? 0),
      total: Number(row?.total ?? 0),
      lucroSum: Number(row?.lucro_sum ?? 0),
      ticket: Number(row?.ticket ?? 0),
      margem: Number(row?.margem ?? 0),
      statusCounts,
      mlCompatibleCount: Number(row?.ml_compatible_count ?? 0),
      mlCompatibleTotal: Number(row?.ml_compatible_total ?? 0),
      mlCompatibleMissingPaymentData: Number(row?.ml_compatible_missing_payment_data ?? 0),
    });
  }

  // Build base query
  function applyFilters(query: any, useSaleDate: boolean) {
    const dateColumn = useSaleDate ? 'data_venda' : 'data';
    if (status) {
      query = query.eq('situacao', status);
    }
    if (startDateIso) {
      query = query.gte(dateColumn, startDateIso);
    }
    if (endDateIso) {
      query = query.lte(dateColumn, endDateIso);
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
  async function runSummaryQueries(useSaleDate: boolean) {
    let countQuery = serviceClient.from('pedidos').select('*', { count: 'exact', head: false }).range(0, 0);
    countQuery = applyFilters(countQuery, useSaleDate);
    const countResult = await countQuery;

    let sumQuery = serviceClient.from('pedidos').select('total, lucro, pagamento_resumo');
    sumQuery = applyFilters(sumQuery, useSaleDate);
    const sumResult = await sumQuery;

    let statusQuery = serviceClient
      .from('pedidos')
      .select('situacao')
      .not('situacao', 'is', null);
    statusQuery = applyFilters(statusQuery, useSaleDate);
    const statusResult = await statusQuery;

    return { countResult, sumResult, statusResult };
  }

  let {
    countResult: { count, error: countError },
    sumResult: { data: sumData, error: sumError },
    statusResult: { data: statusData, error: statusError },
  } = await runSummaryQueries(true);

  const missingSaleDateColumn = isMissingSaleDateColumnError(countError) || isMissingSaleDateColumnError(sumError) || isMissingSaleDateColumnError(statusError);
  if (missingSaleDateColumn) {
    logDbError('pedidos_resumo_schema_drift_fallback_data', '/api/pedidos/resumo', normalizedSearch, countError || sumError || statusError,);
    ({
      countResult: { count, error: countError },
      sumResult: { data: sumData, error: sumError },
      statusResult: { data: statusData, error: statusError },
    } = await runSummaryQueries(false));
  }

  if (countError) {
    logDbError('pedidos_resumo_count_query_failed', '/api/pedidos/resumo', normalizedSearch, countError);
    return NextResponse.json({ erro: 'Falha ao contar pedidos para resumo.' }, { status: 500 });
  }
  if (sumError) {
    logDbError('pedidos_resumo_sum_query_failed', '/api/pedidos/resumo', normalizedSearch, sumError);
    return NextResponse.json({ erro: 'Falha ao calcular totais do resumo.' }, { status: 500 });
  }

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
  if (statusError) {
    logDbError('pedidos_resumo_status_query_failed', '/api/pedidos/resumo', normalizedSearch, statusError);
    return NextResponse.json({ erro: 'Falha ao calcular status do resumo.' }, { status: 500 });
  }

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
