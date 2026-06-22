import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const apiKey = String(process.env.API_SECRET_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'API_SECRET_KEY não configurada' }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/api/sync/fornecedores`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: '{}',
  });
  const data = await response.json().catch(() => ({}));

  return NextResponse.json(data, { status: response.status });
}
