import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetch-all';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const data = await fetchAll(supabase, 'clientes');
  if (!data) return NextResponse.json({ erro: 'Erro ao buscar clientes' }, { status: 500 });

  return NextResponse.json({ data, total: data.length });
}
