import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { data, error } = await supabase.from('clientes').select('*', {count: 'exact'}).order('created_at', { ascending: false }).limit(10000);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ data, total: data.length });
}
