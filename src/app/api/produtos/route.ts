import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

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

  let query = supabase.from('produtos').select('*', { count: 'exact', head: false });

  if (search) {
    query = query.or(`nome.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order('sku', { ascending: true })
    .range(from, to);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count || 0, page, pageSize });
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
