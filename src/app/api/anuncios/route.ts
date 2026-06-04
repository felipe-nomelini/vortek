import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

type AnuncioSortKey =
  | 'sku'
  | 'titulo'
  | 'preco_ml'
  | 'lucro'
  | 'vendidos'
  | 'visitas'
  | 'qualidade'
  | 'status'
  | 'catalogo';

const DEFAULT_SORT: { sortBy: AnuncioSortKey; sortOrder: 'asc' | 'desc' } = {
  sortBy: 'titulo',
  sortOrder: 'asc',
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeListingProfit(item: any): number | null {
  const precoMl = Number(item?.preco_ml ?? 0);
  const custo = Number(item?.produtos?.custo ?? NaN);
  if (!Number.isFinite(precoMl) || precoMl <= 0 || !Number.isFinite(custo)) return null;

  const mlFeeRate = Number(item?.produtos?.ml_fee ?? NaN);
  const shipping = Number(item?.produtos?.ml_shipping ?? 0);
  if (!Number.isFinite(mlFeeRate) || mlFeeRate < 0) return null;
  const imposto = precoMl * 0.04;
  const taxaMl = precoMl * mlFeeRate;
  return round2(precoMl - custo - shipping - imposto - taxaMl);
}

function compareNullableNumber(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function parseSort(searchParams: URLSearchParams): { sortBy: AnuncioSortKey; sortOrder: 'asc' | 'desc' } {
  const rawSortBy = searchParams.get('sortBy') || DEFAULT_SORT.sortBy;
  const rawSortOrder = searchParams.get('sortOrder') || DEFAULT_SORT.sortOrder;
  const allowed: AnuncioSortKey[] = [
    'sku',
    'titulo',
    'preco_ml',
    'lucro',
    'vendidos',
    'visitas',
    'qualidade',
    'status',
    'catalogo',
  ];
  const sortBy = allowed.includes(rawSortBy as AnuncioSortKey)
    ? rawSortBy as AnuncioSortKey
    : DEFAULT_SORT.sortBy;
  const sortOrder = rawSortOrder === 'desc' ? 'desc' : 'asc';
  return { sortBy, sortOrder };
}

function sortListings(rows: any[], sortBy: AnuncioSortKey, sortOrder: 'asc' | 'desc') {
  const direction = sortOrder === 'asc' ? 1 : -1;

  rows.sort((left, right) => {
    let comparison = 0;

    switch (sortBy) {
      case 'sku':
        comparison = String(left?.sku || '').localeCompare(String(right?.sku || ''), 'pt-BR');
        break;
      case 'titulo':
        comparison = String(left?.titulo || '').localeCompare(String(right?.titulo || ''), 'pt-BR');
        break;
      case 'preco_ml':
        comparison = Number(left?.preco_ml || 0) - Number(right?.preco_ml || 0);
        break;
      case 'lucro':
        comparison = compareNullableNumber(left?.lucro ?? null, right?.lucro ?? null);
        break;
      case 'vendidos':
        comparison = Number(left?.vendidos || 0) - Number(right?.vendidos || 0);
        break;
      case 'visitas':
        comparison = Number(left?.visitas || 0) - Number(right?.visitas || 0);
        break;
      case 'qualidade':
        comparison = Number(left?.qualidade || 0) - Number(right?.qualidade || 0);
        break;
      case 'status':
        comparison = String(left?.status || '').localeCompare(String(right?.status || ''), 'pt-BR');
        break;
      case 'catalogo':
        comparison = Number(Boolean(left?.catalogo)) - Number(Boolean(right?.catalogo));
        break;
      default:
        comparison = String(left?.titulo || '').localeCompare(String(right?.titulo || ''), 'pt-BR');
        break;
    }

    if (comparison !== 0) return comparison * direction;
    return String(left?.titulo || '').localeCompare(String(right?.titulo || ''), 'pt-BR');
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
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;
  const { sortBy, sortOrder } = parseSort(searchParams);
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  function applyFilters(query: any) {
    if (search) {
      query = query.or(`titulo.ilike.%${search}%,sku.ilike.%${search}%`);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (priceMin !== null) {
      query = query.gte('preco_ml', priceMin);
    }
    if (priceMax !== null) {
      query = query.lte('preco_ml', priceMax);
    }
    return query;
  }

  const chunkSize = 1000;
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    let dataQuery = supabase.from('anuncios_ml').select(`
      ml_item_id,
      produto_id,
      permalink,
      sku,
      titulo,
      preco_ml,
      vendidos,
      visitas,
      qualidade,
      qualidade_info,
      status,
      catalogo,
      produtos(custo, ml_fee, ml_shipping)
    `);
    dataQuery = applyFilters(dataQuery);
    const { data, error } = await dataQuery
      .order('titulo', { ascending: true })
      .range(offset, offset + chunkSize - 1);

    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

    const chunk = (data || []).map((item: any) => ({
      ...item,
      lucro: computeListingProfit(item),
    }));
    rows.push(...chunk);

    if (chunk.length < chunkSize) break;
    offset += chunkSize;
  }

  sortListings(rows, sortBy, sortOrder);

  return NextResponse.json({
    data: rows.slice(from, to),
    total: rows.length,
    page,
    pageSize,
  });
}
