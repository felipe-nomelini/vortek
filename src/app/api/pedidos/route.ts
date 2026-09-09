import { enrichPedidosWithCompras, reconcileNotaFiscalEmitidaRow, logDbError } from '@/services/order-read-projection';
import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase';
import { saoPauloDateParamToUtcIso } from '@/lib/timezone';
import {
  PREPARATION_ORDER_STATUSES,
  SHIPPING_ORDER_STATUSES,
  matchesOrdersOperationalView,
  parseOrdersOperationalView,
  type OrdersOperationalView,
} from '@/lib/orders/operational-view';
import { enrichOrdersWithWhatsappStatus } from '@/services/order-operational-status';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { isHomologationFixtureSource } from '@/lib/homologation-fixture';
import {
  includesInternalSupplierFilter,
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  matchesOrderSupplierFilter,
} from '@/lib/produto-filtering';
import type {
  PedidoOperacionalApiDto,
  PedidosOperacionaisApiResponse,
} from '@/types/order';
import { loadOperationRuntimeConfiguration } from '@/services/operation-configuration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function isMissingSaleDateColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42703' && String(error?.message || '').includes('data_venda');
}

async function persistReconciledPedidos(rows: any[]) {
  const pending = rows
    .map(reconcileNotaFiscalEmitidaRow)
    .filter((entry) => (
      entry.needsPersistence
      && entry.row?.id
      && !isHomologationFixtureSource(entry.row?.snapshot_source)
    ));

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

async function enrichPedidosForOperationalView(
  rows: any[],
  serviceClient: ReturnType<typeof createServiceClient>,
  persistReconciliation = true,
) {
  const reconciledRows = persistReconciliation
    ? await persistReconciledPedidos(rows)
    : rows.map((row) => reconcileNotaFiscalEmitidaRow(row).row);
  const withPurchases = await enrichPedidosWithCompras(reconciledRows, serviceClient);
  return enrichOrdersWithWhatsappStatus(withPurchases, serviceClient);
}

function applyPedidoFilters(query: any, filters: {
  status: string;
  dateFrom: string | null;
  endDateIso: string | null;
  priceMin: number | null;
  priceMax: number | null;
  useSaleDate?: boolean;
}) {
  const {
    status,
    dateFrom,
    endDateIso,
    priceMin,
    priceMax,
    useSaleDate = true,
  } = filters;
  const dateColumn = useSaleDate ? 'data_venda' : 'data';

  if (status) {
    query = query.eq('situacao', status);
  }
  if (dateFrom) {
    query = query.gte(dateColumn, dateFrom);
  }
  if (endDateIso) {
    query = query.lte(dateColumn, endDateIso);
  }
  if (priceMin !== null) {
    query = query.gte('operational_total', priceMin);
  }
  if (priceMax !== null) {
    query = query.lte('operational_total', priceMax);
  }
  return query;
}

function applyOperationalViewFilter(query: any, view: OrdersOperationalView) {
  if (view === 'urgent') {
    return query.in('situacao', [...PREPARATION_ORDER_STATUSES]);
  }
  if (view === 'preparation') {
    return query.in('situacao', [...PREPARATION_ORDER_STATUSES]);
  }
  if (view === 'shipping') {
    return query.in('situacao', [...SHIPPING_ORDER_STATUSES]);
  }
  if (view === 'delivered') {
    return query.eq('situacao', 'entregue');
  }
  return query;
}

function applyPedidoSort(query: any, sortBy: string, sortOrder: 'asc' | 'desc') {
  return applyPedidoSortWithMode(query, sortBy, sortOrder, true);
}

function applyPedidoSortWithMode(query: any, sortBy: string, sortOrder: 'asc' | 'desc', useSaleDate: boolean) {
  const ascending = sortOrder === 'asc';

  switch (sortBy) {
    case 'numero':
      return query.order('numero', { ascending });
    case 'cliente':
      return query
        .order('billing_nome', { ascending, nullsFirst: false })
        .order('contato_nome', { ascending, nullsFirst: false });
    case 'total':
      return query.order('operational_total', { ascending });
    case 'rastreio':
      return query.order('rastreio', { ascending, nullsFirst: false });
    case 'situacao':
      return query.order('situacao', { ascending });
    case 'nota_fiscal_numero':
      return query.order('nota_fiscal_numero', { ascending, nullsFirst: false });
    case 'pedido_compra':
      return query.order('dslite_id', { ascending, nullsFirst: false });
    case 'lucro':
      return query.order('operational_lucro', { ascending });
    case 'data':
    default:
      return useSaleDate
        ? query
            .order('data_venda', { ascending, nullsFirst: false })
            .order('data', { ascending })
        : query.order('data', { ascending });
  }
}

export async function GET(request: Request) {
  noStore();
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;
  const serviceClient = createServiceClient();
  const operationConfiguration = await loadOperationRuntimeConfiguration(serviceClient);
  const persistReconciliation = request.headers.get('x-vortek-read-only') !== '1';

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const maxPageSize = request.headers.get('x-vortek-read-only') === '1' ? 1000 : 100;
  const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(searchParams.get('pageSize') || '100')));
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;
  const fornecedorFilterIds = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const normalizedSearch = search.trim();
  const rawSortBy = searchParams.get('sortBy') || 'data';
  const rawSortOrder = searchParams.get('sortOrder') || 'desc';
  const operationalView = parseOrdersOperationalView(searchParams.get('operationalView'));
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
  const startDateIso = dateFrom ? saoPauloDateParamToUtcIso(dateFrom, 'start') : null;
  const endDateIso = dateTo ? saoPauloDateParamToUtcIso(dateTo, 'end') : null;
  let supplierOptions;
  try {
    supplierOptions = await listActiveSupplierOptions(serviceClient);
  } catch (error: any) {
    logDbError('pedidos_suppliers_query_failed', '/api/pedidos', normalizedSearch, error);
    return NextResponse.json({ erro: 'Falha ao carregar fornecedores.' }, { status: 500 });
  }
  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);
  const includeInternalSupplier = includesInternalSupplierFilter(fornecedorFilterIds);
  const listResponse = (data: PedidoOperacionalApiDto[], total: number) => {
    const payload: PedidosOperacionaisApiResponse = {
      data,
      total,
      page,
      pageSize,
      fornecedores: supplierOptions,
    };
    return NextResponse.json(payload);
  };

  if (fornecedorFilterIds.length > 0) {
    async function loadSupplierCandidates(useSaleDate: boolean) {
      const candidates: any[] = [];

      if (normalizedSearch) {
        let searchPage = 1;
        let searchTotal = 0;
        while (true) {
          const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_paginated', {
            p_search: normalizedSearch,
            p_status: status || null,
            p_date_from: startDateIso,
            p_date_to: endDateIso,
            p_price_min: priceMin,
            p_price_max: priceMax,
            p_page: searchPage,
            p_page_size: 100,
            p_sort_by: sortBy,
            p_sort_order: sortOrder,
          });
          if (rpcError) return { data: candidates, error: rpcError };
          const chunk = Array.isArray(rpcData?.data) ? rpcData.data : [];
          searchTotal = Number(rpcData?.total ?? searchTotal ?? 0);
          candidates.push(...chunk);
          if (chunk.length < 100 || candidates.length >= searchTotal) break;
          searchPage += 1;
        }
        return { data: candidates, error: null };
      }

      const chunkSize = 500;
      while (true) {
        let query = (serviceClient as any).from('pedidos_operacionais').select('*');
        query = applyPedidoFilters(query, {
          status,
          dateFrom: startDateIso,
          endDateIso,
          priceMin,
          priceMax,
          useSaleDate,
        });
        query = applyOperationalViewFilter(query, operationalView);
        query = applyPedidoSortWithMode(query, sortBy, sortOrder, useSaleDate);
        const offset = candidates.length;
        const { data: chunk, error: chunkError } = await query.range(offset, offset + chunkSize - 1);
        if (chunkError) return { data: candidates, error: chunkError };
        candidates.push(...(chunk || []));
        if ((chunk || []).length < chunkSize) return { data: candidates, error: null };
      }
    }

    let candidatesResult = await loadSupplierCandidates(true);
    if (!normalizedSearch && isMissingSaleDateColumnError(candidatesResult.error)) {
      candidatesResult = await loadSupplierCandidates(false);
    }
    if (candidatesResult.error) {
      logDbError('pedidos_supplier_filter_query_failed', '/api/pedidos', normalizedSearch, candidatesResult.error, {
        operationalView,
      });
      return NextResponse.json({ erro: 'Falha ao filtrar pedidos por fornecedor.' }, { status: 500 });
    }

    const enrichedRows = await enrichPedidosForOperationalView(candidatesResult.data, serviceClient, persistReconciliation);
    const filteredRows = enrichedRows
      .filter((row) => matchesOrdersOperationalView(row, operationalView, operationConfiguration.delayedAfterMinutes))
      .filter((row) => matchesOrderSupplierFilter({
        row,
        supplierDsliteIds: supplierFilterDsliteIds,
        includeInternal: includeInternalSupplier,
      }));
    return listResponse(filteredRows.slice(from, to + 1), filteredRows.length);
  }

  if (normalizedSearch && operationalView !== 'all') {
    const allRows: any[] = [];
    let searchTotal = 0;
    let searchPage = 1;

    while (true) {
      const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_paginated', {
        p_search: normalizedSearch,
        p_status: status || null,
        p_date_from: startDateIso,
        p_date_to: endDateIso,
        p_price_min: priceMin,
        p_price_max: priceMax,
        p_page: searchPage,
        p_page_size: 100,
        p_sort_by: sortBy,
        p_sort_order: sortOrder,
      });

      if (rpcError) {
        logDbError('pedidos_operational_search_rpc_failed', '/api/pedidos', normalizedSearch, rpcError, {
          operationalView,
          searchPage,
        });
        return NextResponse.json({ erro: 'Falha ao buscar pedidos na visão operacional.' }, { status: 500 });
      }

      const rows = Array.isArray(rpcData?.data) ? rpcData.data : [];
      searchTotal = Number(rpcData?.total ?? searchTotal ?? 0);
      allRows.push(...rows);
      if (rows.length < 100 || allRows.length >= searchTotal) break;
      searchPage += 1;
    }

    const enrichedRows = await enrichPedidosForOperationalView(allRows, serviceClient, persistReconciliation);
    const filteredRows = enrichedRows.filter((row) => matchesOrdersOperationalView(row, operationalView, operationConfiguration.delayedAfterMinutes));

    return listResponse(filteredRows.slice(from, to + 1), filteredRows.length);
  }

  if (normalizedSearch) {
    const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_paginated', {
      p_search: normalizedSearch,
      p_status: status || null,
      p_date_from: startDateIso,
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
    const enrichedRows = await enrichPedidosForOperationalView(rows, serviceClient, persistReconciliation);

    return listResponse(enrichedRows, total);
  }

  const filterContext = {
    status,
    dateFrom: startDateIso,
    endDateIso,
    priceMin,
    priceMax,
  };

  if (operationalView === 'urgent') {
    async function loadUrgentCandidates(useSaleDate: boolean) {
      const candidates: any[] = [];
      const chunkSize = 500;

      while (true) {
        let query = (serviceClient as any).from('pedidos_operacionais').select('*');
        query = applyPedidoFilters(query, { ...filterContext, useSaleDate });
        query = applyOperationalViewFilter(query, operationalView);
        query = applyPedidoSortWithMode(query, sortBy, sortOrder, useSaleDate);
        const offset = candidates.length;
        const { data: chunk, error: chunkError } = await query.range(offset, offset + chunkSize - 1);
        if (chunkError) return { data: candidates, error: chunkError };
        candidates.push(...(chunk || []));
        if ((chunk || []).length < chunkSize) return { data: candidates, error: null };
      }
    }

    let urgentResult = await loadUrgentCandidates(true);
    if (isMissingSaleDateColumnError(urgentResult.error)) {
      urgentResult = await loadUrgentCandidates(false);
    }
    if (urgentResult.error) {
      logDbError('pedidos_urgent_query_failed', '/api/pedidos', normalizedSearch, urgentResult.error, {
        operationalView,
      });
      return NextResponse.json({ erro: 'Falha ao carregar pedidos urgentes.' }, { status: 500 });
    }

    const enrichedRows = await enrichPedidosForOperationalView(urgentResult.data, serviceClient, persistReconciliation);
    const urgentRows = enrichedRows.filter((row) => matchesOrdersOperationalView(row, 'urgent', operationConfiguration.delayedAfterMinutes));
    return listResponse(urgentRows.slice(from, to + 1), urgentRows.length);
  }

  async function runListQueries(useSaleDate: boolean) {
    let countQuery = (serviceClient as any).from('pedidos_operacionais').select('*', { count: 'exact', head: false }).range(0, 0);
    countQuery = applyPedidoFilters(countQuery, { ...filterContext, useSaleDate });
    countQuery = applyOperationalViewFilter(countQuery, operationalView);
    const countResult = await countQuery;

    let dataQuery = (serviceClient as any).from('pedidos_operacionais').select('*');
    dataQuery = applyPedidoFilters(dataQuery, { ...filterContext, useSaleDate });
    dataQuery = applyOperationalViewFilter(dataQuery, operationalView);
    dataQuery = applyPedidoSortWithMode(dataQuery, sortBy, sortOrder, useSaleDate);
    const dataResult = await dataQuery.range(from, to);

    return { countResult, dataResult };
  }

  let {
    countResult: { count, error: countError },
    dataResult: { data, error },
  } = await runListQueries(true);

  const missingSaleDateColumn = isMissingSaleDateColumnError(countError) || isMissingSaleDateColumnError(error);
  if (missingSaleDateColumn) {
    logDbError('pedidos_schema_drift_fallback_data', '/api/pedidos', normalizedSearch, countError || error, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: true,
      fallback_reason: 'missing_data_venda_column',
    });

    ({
      countResult: { count, error: countError },
      dataResult: { data, error },
    } = await runListQueries(false));
  }

  if (countError) {
    logDbError('pedidos_count_query_failed', '/api/pedidos', normalizedSearch, countError, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: missingSaleDateColumn,
    });
    return NextResponse.json({ erro: 'Falha ao contar pedidos filtrados.' }, { status: 500 });
  }

  if (error) {
    logDbError('pedidos_data_query_failed', '/api/pedidos', normalizedSearch, error, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: missingSaleDateColumn,
    });
    return NextResponse.json({ erro: 'Falha ao carregar pedidos.' }, { status: 500 });
  }

  const enrichedRows = await enrichPedidosForOperationalView(data || [], serviceClient, persistReconciliation);

  return listResponse(enrichedRows, count || 0);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const body = await request.json();
  const { data, error } = await serviceClient.from('pedidos').insert(body).select().single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
