import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const SITUACOES = new Set(['liberado', 'nao_aproveitavel']);

export async function PATCH(req: Request, { params }: { params: { movimentoId: string } }) {
  const body = await req.json().catch(() => ({}));
  const situacao = String(body.situacao || '');
  if (!SITUACOES.has(situacao)) return NextResponse.json({ error: 'Situação inválida.' }, { status: 400 });

  const db = createServiceClient();
  const { data: movimento, error: consultaError } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('status_devolucao')
    .eq('id', params.movimentoId)
    .eq('tipo', 'entrada_devolucao')
    .maybeSingle();
  if (consultaError || !movimento) return NextResponse.json({ error: 'Devolução não encontrada.' }, { status: 404 });
  if (movimento.status_devolucao !== 'delivered') {
    return NextResponse.json({ error: 'Ações liberadas somente após entrega da devolução.' }, { status: 409 });
  }

  const { error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .update({ situacao_estoque: situacao, disponivel_venda: situacao === 'liberado' })
    .eq('id', params.movimentoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
