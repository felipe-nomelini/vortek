import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

function logDbError(
  event: string,
  endpoint: string,
  search: string,
  error: { code?: string; message?: string; details?: string } | null
) {
  console.error('[pedidos_api_error]', {
    event,
    endpoint,
    search,
    db_code: error?.code ?? null,
    db_message: error?.message ?? null,
    db_details: error?.details ?? null,
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '100')));
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;
  const normalizedSearch = search.trim();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let endDateIso: string | null = null;

  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    endDateIso = end.toISOString();
  }

  if (normalizedSearch) {
    const { data: rpcData, error: rpcError } = await (supabase as any).rpc('search_pedidos_paginated', {
      p_search: normalizedSearch,
      p_status: status || null,
      p_date_from: dateFrom || null,
      p_date_to: endDateIso,
      p_price_min: priceMin,
      p_price_max: priceMax,
      p_page: page,
      p_page_size: pageSize,
    });

    if (rpcError) {
      logDbError('pedidos_search_rpc_failed', '/api/pedidos', normalizedSearch, rpcError);
      return NextResponse.json({ erro: 'Falha ao buscar pedidos com filtro de busca.' }, { status: 500 });
    }

    const rows = Array.isArray(rpcData?.data) ? rpcData.data : [];
    const total = Number(rpcData?.total ?? 0) || 0;

    return NextResponse.json({
      data: rows,
      total,
      page,
      pageSize,
    });
  }

  // Build base query
  function applyFilters(query: any) {
    if (status) {
      query = query.eq('situacao', status);
    }
    if (dateFrom) {
      query = query.gte('data', dateFrom);
    }
    if (endDateIso) {
      query = query.lte('data', endDateIso);
    }
    if (priceMin !== null) {
      query = query.gte('total', priceMin);
    }
    if (priceMax !== null) {
      query = query.lte('total', priceMax);
    }
    return query;
  }

  // Count query
  let countQuery = supabase.from('pedidos').select('*', { count: 'exact', head: false }).range(0, 0);
  countQuery = applyFilters(countQuery);
  const { count, error: countError } = await countQuery;
  if (countError) {
    logDbError('pedidos_count_query_failed', '/api/pedidos', normalizedSearch, countError);
    return NextResponse.json({ erro: 'Falha ao contar pedidos filtrados.' }, { status: 500 });
  }

  // Data query
  let dataQuery = supabase.from('pedidos').select('*');
  dataQuery = applyFilters(dataQuery);
  const { data, error } = await dataQuery
    .order('data', { ascending: false })
    .range(from, to);

  if (error) {
    logDbError('pedidos_data_query_failed', '/api/pedidos', normalizedSearch, error);
    return NextResponse.json({ erro: 'Falha ao carregar pedidos.' }, { status: 500 });
  }

  return NextResponse.json({
    data: data || [],
    total: count || 0,
    page,
    pageSize,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await request.json();
  const { data, error } = await supabase.from('pedidos').insert(body).select().single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
