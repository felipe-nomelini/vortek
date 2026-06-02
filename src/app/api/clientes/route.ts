import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type ClienteSortKey =
  | 'ml_id'
  | 'nome'
  | 'tipo_pessoa'
  | 'documento'
  | 'endereco'
  | 'email'
  | 'telefone'
  | 'total_vendas';

const DEFAULT_SORT: { sortBy: ClienteSortKey; sortOrder: 'asc' | 'desc' } = {
  sortBy: 'nome',
  sortOrder: 'asc',
};

function parseSort(searchParams: URLSearchParams): { sortBy: ClienteSortKey; sortOrder: 'asc' | 'desc' } {
  const rawSortBy = searchParams.get('sortBy') || DEFAULT_SORT.sortBy;
  const rawSortOrder = searchParams.get('sortOrder') || DEFAULT_SORT.sortOrder;
  const allowed: ClienteSortKey[] = [
    'ml_id',
    'nome',
    'tipo_pessoa',
    'documento',
    'endereco',
    'email',
    'telefone',
    'total_vendas',
  ];
  const sortBy = allowed.includes(rawSortBy as ClienteSortKey)
    ? rawSortBy as ClienteSortKey
    : DEFAULT_SORT.sortBy;
  const sortOrder = rawSortOrder === 'desc' ? 'desc' : 'asc';
  return { sortBy, sortOrder };
}

function sortClientes(rows: any[], sortBy: ClienteSortKey, sortOrder: 'asc' | 'desc') {
  const direction = sortOrder === 'asc' ? 1 : -1;

  rows.sort((left, right) => {
    let comparison = 0;

    switch (sortBy) {
      case 'ml_id':
        comparison = String(left.ml_id || '').localeCompare(String(right.ml_id || ''), 'pt-BR');
        break;
      case 'nome':
        comparison = String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR');
        break;
      case 'tipo_pessoa':
        comparison = String(left.tipo_pessoa || '').localeCompare(String(right.tipo_pessoa || ''), 'pt-BR');
        break;
      case 'documento':
        comparison = String(left.documento || '').localeCompare(String(right.documento || ''), 'pt-BR');
        break;
      case 'endereco':
        comparison = String(left.endereco || '').localeCompare(String(right.endereco || ''), 'pt-BR');
        break;
      case 'email':
        comparison = String(left.email || '').localeCompare(String(right.email || ''), 'pt-BR');
        break;
      case 'telefone':
        comparison = String(left.telefone || '').localeCompare(String(right.telefone || ''), 'pt-BR');
        break;
      case 'total_vendas':
        comparison = Number(left.total_vendas || 0) - Number(right.total_vendas || 0);
        break;
      default:
        comparison = String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR');
        break;
    }

    if (comparison !== 0) return comparison * direction;
    return String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR');
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const search = searchParams.get('search') || '';
    const tipo = searchParams.get('tipo') || '';
    const { sortBy, sortOrder } = parseSort(searchParams);

    const pageSize = 100;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const supabase = createServiceClient();
    const chunkSize = 1000;
    const allClients: any[] = [];
    let offset = 0;

    function applyFilters(query: any) {
      if (search) {
        const filter = `nome.ilike.%${search}%,documento.ilike.%${search}%,nickname.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%,endereco.ilike.%${search}%`;
        query = query.or(filter);
      }

      if (tipo) {
        query = query.eq('tipo_pessoa', tipo);
      }

      return query;
    }

    while (true) {
      let dataQuery = supabase.from('clientes').select('*');
      dataQuery = applyFilters(dataQuery);
      const { data, error } = await dataQuery
        .order('nome', { ascending: true })
        .range(offset, offset + chunkSize - 1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const chunk = data || [];
      allClients.push(...chunk);
      if (chunk.length < chunkSize) break;
      offset += chunkSize;
    }

    const vendasMap: Record<string, number> = {};
    const { data: allPedidos, error: pedidosError } = await supabase
      .from('pedidos')
      .select('contato_nome');

    if (pedidosError) {
      return NextResponse.json({ error: pedidosError.message }, { status: 500 });
    }

    for (const pedido of allPedidos || []) {
      const match = pedido.contato_nome?.match(/\(([^)]+)\)$/);
      const nickname = match ? match[1] : '';
      if (nickname) {
        vendasMap[nickname] = (vendasMap[nickname] || 0) + 1;
      }
    }

    const enriched = allClients.map((client) => ({
      ...client,
      total_vendas: vendasMap[client.ml_nickname || ''] || 0,
    }));

    sortClientes(enriched, sortBy, sortOrder);

    return NextResponse.json({
      data: enriched.slice(start, end),
      total: enriched.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
