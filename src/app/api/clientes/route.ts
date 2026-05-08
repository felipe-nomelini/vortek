import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

async function fetchAll(table: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const all: any[] = [];
  const pageSize = 1000;
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = (page + 1) * pageSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    page++;
  }

  return all;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const data = await fetchAll('clientes');
  if (!data) return NextResponse.json({ erro: 'Erro ao buscar clientes' }, { status: 500 });

  return NextResponse.json({ data, total: data.length });
}
