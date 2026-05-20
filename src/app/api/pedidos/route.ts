import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

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

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Build base query
  function applyFilters(query: any) {
    if (search) {
      query = query.or(`numero.ilike.%${search}%,contato_nome.ilike.%${search}%`);
    }
    if (status) {
      query = query.eq('situacao', status);
    }
    if (dateFrom) {
      query = query.gte('data', dateFrom);
    }
    if (dateTo) {
      // Ajustar para final do dia
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

  // Count query
  let countQuery = supabase.from('pedidos').select('*', { count: 'exact', head: false }).range(0, 0);
  countQuery = applyFilters(countQuery);
  const { count } = await countQuery;

  // Data query
  let dataQuery = supabase.from('pedidos').select('*');
  dataQuery = applyFilters(dataQuery);
  const { data, error } = await dataQuery
    .order('data', { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

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
