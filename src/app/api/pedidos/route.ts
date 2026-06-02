import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { reconcileLocalNfeSnapshotFromXml } from '@/lib/fiscal/nfe-local-reconciliation';

function logDbError(
  event: string,
  endpoint: string,
  search: string,
  error: { code?: string; message?: string; details?: string } | null,
  context?: Record<string, unknown>,
) {
  console.error('[pedidos_api_error]', {
    event,
    endpoint,
    search,
    db_code: error?.code ?? null,
    db_message: error?.message ?? null,
    db_details: error?.details ?? null,
    ...(context || {}),
  });
}

function reconcileNotaFiscalEmitidaRow(row: any) {
  const reconciliation = reconcileLocalNfeSnapshotFromXml({
    nfe_status: row?.nfe_status,
    nfe_xml: row?.nfe_xml,
    nfe_chave: row?.nfe_chave,
    nota_fiscal_numero: row?.nota_fiscal_numero,
    nfe_protocolo: row?.nfe_protocolo,
    nfe_cfop: row?.nfe_cfop,
  });
  const shouldKeepEmitida = Boolean(row?.nota_fiscal_emitida && String(row?.nfe_danfe_url || '').trim());
  const nextRow = {
    ...row,
    ...reconciliation.updates,
    nota_fiscal_emitida: shouldKeepEmitida,
  };
  const needsPersistence = Boolean(
    Object.keys(reconciliation.updates || {}).length > 0
    || Boolean(row?.nota_fiscal_emitida) !== shouldKeepEmitida,
  );
  return {
    row: nextRow,
    needsPersistence,
  };
}

async function persistReconciledPedidos(rows: any[]) {
  const pending = rows
    .map(reconcileNotaFiscalEmitidaRow)
    .filter((entry) => entry.needsPersistence && entry.row?.id);

  if (!pending.length) return rows.map((row) => reconcileNotaFiscalEmitidaRow(row).row);

  const serviceClient = createServiceClient();
  await Promise.allSettled(
    pending.map(({ row }) => serviceClient
      .from('pedidos')
      .update({
        nota_fiscal_emitida: row.nota_fiscal_emitida,
        nfe_status: row.nfe_status || undefined,
        nfe_chave: row.nfe_chave || undefined,
        nota_fiscal_numero: row.nota_fiscal_numero || undefined,
        nfe_protocolo: row.nfe_protocolo || undefined,
        nfe_cfop: row.nfe_cfop || undefined,
        nfe_danfe_url: row.nfe_danfe_url || null,
      } as any)
      .eq('id', row.id)),
  );

  return rows.map((row) => reconcileNotaFiscalEmitidaRow(row).row);
}

function applyPedidoFilters(query: any, filters: {
  status: string;
  dateFrom: string;
  endDateIso: string | null;
  priceMin: number | null;
  priceMax: number | null;
}) {
  const {
    status,
    dateFrom,
    endDateIso,
    priceMin,
    priceMax,
  } = filters;

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

function applyPedidoSort(query: any, sortBy: string, sortOrder: 'asc' | 'desc') {
  const ascending = sortOrder === 'asc';

  switch (sortBy) {
    case 'numero':
      return query.order('numero', { ascending });
    case 'cliente':
      return query
        .order('billing_nome', { ascending, nullsFirst: false })
        .order('contato_nome', { ascending, nullsFirst: false });
    case 'total':
      return query.order('total', { ascending });
    case 'rastreio':
      return query.order('rastreio', { ascending, nullsFirst: false });
    case 'situacao':
      return query.order('situacao', { ascending });
    case 'nota_fiscal_numero':
      return query.order('nota_fiscal_numero', { ascending, nullsFirst: false });
    case 'pedido_compra':
      return query.order('dslite_id', { ascending, nullsFirst: false });
    case 'lucro':
      return query.order('lucro', { ascending });
    case 'data':
    default:
      return query.order('data', { ascending });
  }
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
  const rawSortBy = searchParams.get('sortBy') || 'data';
  const rawSortOrder = searchParams.get('sortOrder') || 'desc';
  const allowedSortBy = new Set([
    'numero',
    'data',
    'cliente',
    'total',
    'rastreio',
    'situacao',
    'nota_fiscal_numero',
    'pedido_compra',
    'lucro',
  ]);
  const sortBy = allowedSortBy.has(rawSortBy) ? rawSortBy : 'data';
  const sortOrder = rawSortOrder === 'asc' ? 'asc' : 'desc';
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
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
    });

    if (rpcError) {
      logDbError('pedidos_search_rpc_failed', '/api/pedidos', normalizedSearch, rpcError, {
        rpc_name: 'search_pedidos_paginated',
        sortBy,
        sortOrder,
        search_present: true,
        fallback_used: false,
      });
      return NextResponse.json({ erro: 'Falha ao buscar pedidos com filtro de busca.' }, { status: 500 });
    }

    const rows = Array.isArray(rpcData?.data) ? rpcData.data : [];
    const total = Number(rpcData?.total ?? 0) || 0;
    const reconciledRows = await persistReconciledPedidos(rows);

    return NextResponse.json({
      data: reconciledRows,
      total,
      page,
      pageSize,
    });
  }

  const filterContext = {
    status,
    dateFrom,
    endDateIso,
    priceMin,
    priceMax,
  };

  let countQuery = supabase.from('pedidos').select('*', { count: 'exact', head: false }).range(0, 0);
  countQuery = applyPedidoFilters(countQuery, filterContext);
  const { count, error: countError } = await countQuery;

  if (countError) {
    logDbError('pedidos_count_query_failed', '/api/pedidos', normalizedSearch, countError, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: true,
    });
    return NextResponse.json({ erro: 'Falha ao contar pedidos filtrados.' }, { status: 500 });
  }

  let dataQuery = supabase.from('pedidos').select('*');
  dataQuery = applyPedidoFilters(dataQuery, filterContext);
  dataQuery = applyPedidoSort(dataQuery, sortBy, sortOrder);

  const { data, error } = await dataQuery.range(from, to);

  if (error) {
    logDbError('pedidos_data_query_failed', '/api/pedidos', normalizedSearch, error, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: true,
    });
    return NextResponse.json({ erro: 'Falha ao carregar pedidos.' }, { status: 500 });
  }

  const reconciledRows = await persistReconciledPedidos(data || []);

  return NextResponse.json({
    data: reconciledRows,
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
