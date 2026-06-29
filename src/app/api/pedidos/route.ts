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

function isMissingSaleDateColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42703' && String(error?.message || '').includes('data_venda');
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

async function enrichPedidosWithCompras(rows: any[], serviceClient: ReturnType<typeof createServiceClient>) {
  const dsids = Array.from(new Set(
    rows
      .map((row) => String(row?.dslite_id || '').trim())
      .filter(Boolean),
  ));
  if (!dsids.length) return rows;

  const compras: any[] = [];
  for (let index = 0; index < dsids.length; index += 500) {
    const chunk = dsids.slice(index, index + 500);
    const { data, error } = await serviceClient
      .from('compras')
      .select('id,dsid,fornecedor_id,fornecedor_nome,supplier_payment_mode,supplier_payment_status,supplier_payment_amount,supplier_payment_receipt_path,supplier_payment_reference,supplier_payment_notes')
      .in('dsid', chunk);

    if (error) {
      logDbError('pedidos_compras_enrich_failed', '/api/pedidos', '', error, {
        dsids_count: dsids.length,
      });
      return rows;
    }
    compras.push(...(data || []));
  }

  const comprasByDsid = new Map(compras.map((compra) => [String(compra.dsid), compra]));
  const fornecedorIds = Array.from(new Set(
    compras
      .map((compra) => String(compra?.fornecedor_id || '').trim())
      .filter(Boolean),
  ));
  const fornecedores: any[] = [];
  for (let index = 0; index < fornecedorIds.length; index += 500) {
    const chunk = fornecedorIds.slice(index, index + 500);
    const { data } = await serviceClient
      .from('fornecedores')
      .select('dslite_id,telefone,supplier_pix_key')
      .in('dslite_id', chunk);
    fornecedores.push(...(data || []));
  }
  const fornecedorByDsliteId = new Map(fornecedores.map((fornecedor) => [String(fornecedor.dslite_id), fornecedor]));

  return rows.map((row) => {
    const compra = comprasByDsid.get(String(row?.dslite_id || ''));
    if (!compra) {
      return {
        ...row,
        dslite_next_action: row?.dslite_id ? 'complete_dslite_label' : 'create_dslite_order',
        dslite_next_action_label: row?.dslite_id ? 'Completar etiqueta DSLite' : 'Criar pedido DSLite',
      };
    }
    const releaseAt = row?.ml_fiscal_release_at ? new Date(row.ml_fiscal_release_at) : null;
    const labelPendingByMl = Boolean(releaseAt && !Number.isNaN(releaseAt.getTime()) && releaseAt.getTime() > Date.now());
    const paymentMode = String(compra.supplier_payment_mode || '');
    const paymentStatus = String(compra.supplier_payment_status || '');
    const hasReceipt = Boolean(compra.supplier_payment_receipt_path);
    const labelSent = Boolean(row?.dslite_etiqueta_enviada);
    const fornecedor = fornecedorByDsliteId.get(String(compra.fornecedor_id || ''));
    let nextAction = 'done';
    let nextActionLabel = 'OK';

    if (paymentMode === 'prepaid_pix' && paymentStatus !== 'paid') {
      nextAction = 'confirm_supplier_payment';
      nextActionLabel = 'Confirmar PIX';
    } else if (paymentMode === 'prepaid_pix' && paymentStatus === 'paid' && !hasReceipt) {
      nextAction = 'send_supplier_receipt';
      nextActionLabel = 'Anexar comprovante';
    } else if (paymentMode === 'prepaid_pix' && paymentStatus === 'paid' && hasReceipt && !labelSent) {
      nextAction = 'resume_dslite_flow';
      nextActionLabel = 'Retomar fluxo';
    } else if (!labelSent && labelPendingByMl) {
      nextAction = 'wait_ml_label';
      nextActionLabel = 'Aguardando ML';
    } else if (!labelSent) {
      nextAction = 'complete_dslite_label';
      nextActionLabel = 'Completar etiqueta';
    }

    return {
      ...row,
      compra_id: compra.id || null,
      fornecedor_id: compra.fornecedor_id || null,
      fornecedor_nome: compra.fornecedor_nome || null,
      fornecedor_telefone: fornecedor?.telefone || null,
      supplier_payment_mode: compra.supplier_payment_mode || null,
      supplier_payment_status: compra.supplier_payment_status || null,
      supplier_payment_amount: compra.supplier_payment_amount ?? null,
      supplier_payment_receipt_path: compra.supplier_payment_receipt_path || null,
      supplier_payment_reference: compra.supplier_payment_reference || null,
      supplier_payment_notes: compra.supplier_payment_notes || null,
      supplier_pix_key: fornecedor?.supplier_pix_key || null,
      dslite_next_action: nextAction,
      dslite_next_action_label: nextActionLabel,
    };
  });
}

function applyPedidoFilters(query: any, filters: {
  status: string;
  dateFrom: string;
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
    query = query.gte('total', priceMin);
  }
  if (priceMax !== null) {
    query = query.lte('total', priceMax);
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
      return useSaleDate
        ? query
            .order('data_venda', { ascending, nullsFirst: false })
            .order('data', { ascending })
        : query.order('data', { ascending });
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

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
    const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_paginated', {
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
    const enrichedRows = await enrichPedidosWithCompras(reconciledRows, serviceClient);

    return NextResponse.json({
      data: enrichedRows,
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

  async function runListQueries(useSaleDate: boolean) {
    let countQuery = serviceClient.from('pedidos').select('*', { count: 'exact', head: false }).range(0, 0);
    countQuery = applyPedidoFilters(countQuery, { ...filterContext, useSaleDate });
    const countResult = await countQuery;

    let dataQuery = serviceClient.from('pedidos').select('*');
    dataQuery = applyPedidoFilters(dataQuery, { ...filterContext, useSaleDate });
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

  const reconciledRows = await persistReconciledPedidos(data || []);
  const enrichedRows = await enrichPedidosWithCompras(reconciledRows, serviceClient);

  return NextResponse.json({
    data: enrichedRows,
    total: count || 0,
    page,
    pageSize,
  });
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
