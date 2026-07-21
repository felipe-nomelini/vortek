import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';

const SITUACOES = new Set(['liberado', 'nao_aproveitavel']);

export async function PATCH(req: Request, { params }: { params: { movimentoId: string } }) {
  const body = await req.json().catch(() => ({}));
  const situacao = String(body.situacao || '');
  if (!SITUACOES.has(situacao)) return NextResponse.json({ error: 'Situação inválida.' }, { status: 400 });

  const db = createServiceClient();
  const { data: movimento, error: consultaError } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('status_devolucao,produto_id')
    .eq('id', params.movimentoId)
    .eq('tipo', 'entrada_devolucao')
    .maybeSingle();
  if (consultaError || !movimento) return NextResponse.json({ error: 'Movimento de estoque não encontrado.' }, { status: 404 });
  if (!['delivered', 'manual'].includes(String(movimento.status_devolucao || ''))) {
    return NextResponse.json({ error: 'Ações liberadas somente após entrega da devolução.' }, { status: 409 });
  }

  const { error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .update({ situacao_estoque: situacao, disponivel_venda: situacao === 'liberado' })
    .eq('id', params.movimentoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const mlSync = await enfileirarSyncMlEstoqueInterno(String(movimento.produto_id));
    return NextResponse.json({ success: true, mlSync });
  } catch (syncError: any) {
    console.error('[estoque_interno_ml_sync_failed]', syncError?.message || syncError);
    return NextResponse.json({ success: true, mlSyncWarning: 'Saldo atualizado, mas não foi possível enfileirar a atualização do anúncio.' });
  }
}
