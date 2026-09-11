import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { sincronizarDevolucoesMercadoLivreAtivas } from '@/lib/estoque-interno';

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;

  try {
    const result = await sincronizarDevolucoesMercadoLivreAtivas();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[internal_returns_refresh_failed]', error?.message || error);
    return NextResponse.json(
      { error: 'Não foi possível atualizar as devoluções agora.' },
      { status: 502 },
    );
  }
}
