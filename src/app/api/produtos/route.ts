import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const search = searchParams.get('search') || '';
  const pageSize = 100;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Parse fornecedor filter (comma-separated)
  const fornecedorFilter = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];

  // Helper to apply common filters to a query
  function applyFilters(query: any) {
    if (search) {
      query = query.or(`nome.ilike.%${search}%,sku.ilike.%${search}%`);
    }
    if (fornecedorFilter.length > 0) {
      query = query.in('fornecedor', fornecedorFilter);
    }
    return query;
  }

  // Separate count query
  let countQuery = supabase.from('produtos').select('id', { count: 'exact', head: false }).range(0, 0);
  countQuery = applyFilters(countQuery);
  const { count } = await countQuery;

  // Data query with pagination
  let dataQuery = supabase.from('produtos').select('*');
  dataQuery = applyFilters(dataQuery);
  const { data, error } = await dataQuery
    .order('sku', { ascending: true })
    .range(from, to);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // Get distinct fornecedores via RPC (sem limite de linhas)
  const serviceClient = createServiceClient();
  const { data: fornData } = await serviceClient.rpc('get_fornecedores');
  const fornecedoresSet = new Set<string>();
  for (const item of fornData || []) {
    if (item.fornecedor) fornecedoresSet.add(item.fornecedor);
  }

  return NextResponse.json({
    data,
    total: count || 0,
    page,
    pageSize,
    fornecedores: Array.from(fornecedoresSet).sort(),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await request.json();
  const { data, error } = await supabase.from('produtos').insert(body).select().single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
