import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export const maxDuration = 300;

const endpointMap: Record<string, string> = {
  catalogo: '/api/sync/catalogo',
  precos: '/api/sync/preco-estoque',
  anuncios: '/api/sync/anuncios',
  pedidos: '/api/sync/pedidos',
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  try {
    const { tipo } = await request.json();

    const endpointPath = endpointMap[tipo];
    if (!endpointPath) {
      return NextResponse.json({ erro: `tipo inválido: ${tipo}. Valores: ${Object.keys(endpointMap).join(', ')}` }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const res = await fetch(`${baseUrl}${endpointPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.API_SECRET_KEY || '',
      },
      body: JSON.stringify({}),
    });

    const data = await res.json().catch(() => ({ erro: 'Falha ao parsear resposta' }));

    if (!res.ok) {
      return NextResponse.json(
        { erro: data.erro || `Sync ${tipo} falhou`, detalhes: data },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, tipo, data });
  } catch (err: any) {
    return NextResponse.json({ erro: err.message }, { status: 500 });
  }
}
