import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function PATCH(req: Request, { params }: { params: { produtoId: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.disponivel !== 'boolean') {
    return NextResponse.json({ error: 'Campo disponivel é obrigatório.' }, { status: 400 });
  }

  const { error } = await (createServiceClient() as any)
    .from('estoque_interno_movimentacoes')
    .update({ disponivel_venda: body.disponivel })
    .eq('produto_id', params.produtoId)
    .eq('tipo', 'entrada_devolucao');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
