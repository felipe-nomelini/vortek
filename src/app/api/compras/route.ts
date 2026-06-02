import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type CompraSortKey =
  | 'dsid'
  | 'pedido_vendas_numero'
  | 'data_criacao'
  | 'destinatario_nome'
  | 'produto_descricao'
  | 'quantidade'
  | 'valor_total'
  | 'status'
  | 'nf_numero';

const DEFAULT_SORT: { sortBy: CompraSortKey; sortOrder: 'asc' | 'desc' } = {
  sortBy: 'data_criacao',
  sortOrder: 'desc',
};

function parseSort(searchParams: URLSearchParams): { sortBy: CompraSortKey; sortOrder: 'asc' | 'desc' } {
  const rawSortBy = searchParams.get('sortBy') || DEFAULT_SORT.sortBy;
  const rawSortOrder = searchParams.get('sortOrder') || DEFAULT_SORT.sortOrder;
  const allowed: CompraSortKey[] = [
    'dsid',
    'pedido_vendas_numero',
    'data_criacao',
    'destinatario_nome',
    'produto_descricao',
    'quantidade',
    'valor_total',
    'status',
    'nf_numero',
  ];
  const sortBy = allowed.includes(rawSortBy as CompraSortKey)
    ? rawSortBy as CompraSortKey
    : DEFAULT_SORT.sortBy;
  const sortOrder = rawSortOrder === 'asc' ? 'asc' : 'desc';
  return { sortBy, sortOrder };
}

function sortCompras(rows: any[], sortBy: CompraSortKey, sortOrder: 'asc' | 'desc') {
  const direction = sortOrder === 'asc' ? 1 : -1;

  rows.sort((left, right) => {
    let comparison = 0;

    switch (sortBy) {
      case 'dsid':
        comparison = String(left.dsid || '').localeCompare(String(right.dsid || ''), 'pt-BR', { numeric: true });
        break;
      case 'pedido_vendas_numero':
        comparison = Number(left.pedido_vendas_numero || Number.MAX_SAFE_INTEGER) - Number(right.pedido_vendas_numero || Number.MAX_SAFE_INTEGER);
        break;
      case 'data_criacao':
        comparison = new Date(left.data_criacao || 0).getTime() - new Date(right.data_criacao || 0).getTime();
        break;
      case 'destinatario_nome':
        comparison = String(left.destinatario_nome || '').localeCompare(String(right.destinatario_nome || ''), 'pt-BR');
        break;
      case 'produto_descricao':
        comparison = String(left.produto_descricao || '').localeCompare(String(right.produto_descricao || ''), 'pt-BR');
        break;
      case 'quantidade':
        comparison = Number(left.quantidade || 0) - Number(right.quantidade || 0);
        break;
      case 'valor_total':
        comparison = Number(left.valor_total || 0) - Number(right.valor_total || 0);
        break;
      case 'status':
        comparison = String(left.status || '').localeCompare(String(right.status || ''), 'pt-BR');
        break;
      case 'nf_numero':
        comparison = String(left.nf_numero || '').localeCompare(String(right.nf_numero || ''), 'pt-BR', { numeric: true });
        break;
      default:
        comparison = new Date(left.data_criacao || 0).getTime() - new Date(right.data_criacao || 0).getTime();
        break;
    }

    if (comparison !== 0) return comparison * direction;
    return new Date(right.data_criacao || 0).getTime() - new Date(left.data_criacao || 0).getTime();
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const status = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';
    const { sortBy, sortOrder } = parseSort(searchParams);

    const client = createServiceClient();
    const chunkSize = 1000;
    const allCompras: any[] = [];
    let offset = 0;

    function applyFilters(query: any) {
      if (status) query = query.eq('status', status);
      if (search) query = query.or(`destinatario_nome.ilike.%${search}%,produto_descricao.ilike.%${search}%,dsid.ilike.%${search}%`);
      if (dateFrom) query = query.gte('data_criacao', dateFrom);
      if (dateTo) query = query.lte('data_criacao', `${dateTo}T23:59:59`);
      return query;
    }

    while (true) {
      let query = client.from('compras').select('*');
      query = applyFilters(query);
      const { data, error } = await query
        .order('data_criacao', { ascending: false })
        .range(offset, offset + chunkSize - 1);

      if (error) {
        console.error('[api/compras] Erro:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const chunk = data || [];
      allCompras.push(...chunk);
      if (chunk.length < chunkSize) break;
      offset += chunkSize;
    }

    let pedidoNumeroPorDsliteId = new Map<string, number>();
    const dsids = Array.from(new Set(allCompras.map((item: any) => String(item.dsid)).filter(Boolean)));

    if (dsids.length > 0) {
      const pedidosVinculados: any[] = [];
      for (let index = 0; index < dsids.length; index += 500) {
        const chunk = dsids.slice(index, index + 500);
        const { data, error } = await client
          .from('pedidos')
          .select('dslite_id, numero')
          .in('dslite_id', chunk);

        if (error) {
          console.error('[api/compras] Erro ao buscar pedidos vinculados:', error);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        pedidosVinculados.push(...(data || []));
      }

      pedidoNumeroPorDsliteId = new Map(
        pedidosVinculados
          .filter((item: any) => item?.dslite_id)
          .map((item: any) => [String(item.dslite_id), Number(item.numero)]),
      );
    }

    const comprasEnriquecidas = allCompras.map((item: any) => ({
      ...item,
      pedido_vendas_numero: pedidoNumeroPorDsliteId.get(String(item.dsid)) ?? null,
    }));

    sortCompras(comprasEnriquecidas, sortBy, sortOrder);

    const from = (page - 1) * limit;
    const to = from + limit;

    return NextResponse.json({
      data: comprasEnriquecidas.slice(from, to),
      total: comprasEnriquecidas.length,
      page,
      pageSize: limit,
    });
  } catch (err: any) {
    console.error('[api/compras] Erro geral:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
