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
  const tipo = searchParams.get('tipo') || '';
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

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

  let countQuery = supabase.from('anuncios_ml').select('*', { count: 'exact', head: false }).range(0, 0);
  countQuery = applyFilters(countQuery);
  const { count } = await countQuery;

  let dataQuery = supabase.from('anuncios_ml').select('*');
  dataQuery = applyFilters(dataQuery);
  const { data, error } = await dataQuery
    .order('titulo', { ascending: true })
    .range(from, to);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({
    data: data || [],
    total: count || 0,
    page,
    pageSize,
  });
}
