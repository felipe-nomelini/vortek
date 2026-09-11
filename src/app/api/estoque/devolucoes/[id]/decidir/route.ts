import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { createServiceClient } from '@/lib/supabase';

const schema = z.object({
  resultado: z.enum(['apto', 'nao_apto']),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Escolha se o produto está apto para venda.' }, { status: 400 });
  }

  const { id } = await context.params;
  const db = createServiceClient();
  const { data, error } = await (db as any).rpc('decide_internal_ml_return', {
    p_return_id: id,
    p_result: parsed.data.resultado,
    p_user_id: auth.userId,
  });

  if (error) {
    const message = String(error.message || '');
    if (message.includes('internal_return_not_found')) {
      return NextResponse.json({ error: 'Devolução não encontrada.' }, { status: 404 });
    }
    if (message.includes('internal_return_not_received')) {
      return NextResponse.json({ error: 'Confirme o recebimento antes de avaliar o produto.' }, { status: 409 });
    }
    if (message.includes('internal_return_already_decided')) {
      return NextResponse.json({ error: 'Esta devolução já foi avaliada.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível salvar a decisão.' }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (parsed.data.resultado === 'apto' && row?.produto_id) {
    try {
      const mlSync = await enfileirarSyncMlEstoqueInterno(String(row.produto_id));
      return NextResponse.json({ success: true, mlSync });
    } catch (syncError: any) {
      console.error('[internal_return_ml_stock_sync_failed]', {
        returnId: id,
        error: syncError?.message || syncError,
      });
      return NextResponse.json({
        success: true,
        mlSyncWarning: 'O produto entrou no estoque, mas o anúncio ainda não foi atualizado.',
      });
    }
  }

  return NextResponse.json({ success: true });
}
