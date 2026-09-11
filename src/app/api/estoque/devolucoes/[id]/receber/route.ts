import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const db = createServiceClient();
  const { error } = await (db as any).rpc('receive_internal_ml_return', {
    p_return_id: id,
    p_user_id: auth.userId,
  });

  if (error) {
    const message = String(error.message || '');
    if (message.includes('internal_return_not_found')) {
      return NextResponse.json({ error: 'Devolução não encontrada.' }, { status: 404 });
    }
    if (message.includes('internal_return_cannot_be_received')) {
      return NextResponse.json({ error: 'Esta devolução não pode mais ser recebida.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível confirmar o recebimento.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
