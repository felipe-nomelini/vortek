import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient.from('configuracoes').select('*').single();

  if (error && error.code !== 'PGRST116') return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data || {});
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const body = await request.json();
  const { data, error } = await serviceClient.from('configuracoes').upsert({ id: '00000000-0000-0000-0000-000000000001', ...body }).select().single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
