import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetch-all';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const data = await fetchAll(supabase, 'pedidos');
  if (!data) return NextResponse.json({ erro: 'Erro ao buscar pedidos' }, { status: 500 });

  return NextResponse.json({ data, total: data.length });
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
