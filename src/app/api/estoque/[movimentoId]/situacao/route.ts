import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { authorizeApiRequest } from '@/lib/api-request-auth';

const SITUACOES = new Set(['liberado', 'nao_aproveitavel']);

export async function PATCH(req: Request, props: { params: Promise<{ movimentoId: string }> }) {
  const auth = await authorizeApiRequest(req, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  const situacao = String(body.situacao || '');
  if (!SITUACOES.has(situacao)) return NextResponse.json({ error: 'Situação inválida.' }, { status: 400 });

  const db = createServiceClient();
  const { data: movimento, error: consultaError } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('status_devolucao,produto_id,situacao_estoque')
    .eq('id', params.movimentoId)
    .eq('tipo', 'entrada_devolucao')
    .maybeSingle();
  if (consultaError || !movimento) return NextResponse.json({ error: 'Movimento de estoque não encontrado.' }, { status: 404 });
  if (String(movimento.situacao_estoque || '') !== 'revisao') {
    return NextResponse.json({ error: 'Somente itens em revisão podem ter a situação alterada.' }, { status: 409 });
  }
  if (!['delivered', 'returned', 'manual'].includes(String(movimento.status_devolucao || ''))) {
    return NextResponse.json({ error: 'Ações liberadas somente após entrega da devolução.' }, { status: 409 });
  }

  const { data: atualizado, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .update({ situacao_estoque: situacao, disponivel_venda: situacao === 'liberado' })
    .eq('id', params.movimentoId)
    .eq('situacao_estoque', 'revisao')
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!atualizado) return NextResponse.json({ error: 'A situação do item já foi alterada.' }, { status: 409 });
  try {
    const mlSync = await enfileirarSyncMlEstoqueInterno(String(movimento.produto_id));
    return NextResponse.json({ success: true, mlSync });
  } catch (syncError: any) {
    console.error('[estoque_interno_ml_sync_failed]', syncError?.message || syncError);
    return NextResponse.json({ success: true, mlSyncWarning: 'Saldo atualizado, mas não foi possível enfileirar a atualização do anúncio.' });
  }
}

export async function DELETE(_req: Request, props: { params: Promise<{ movimentoId: string }> }) {
  const auth = await authorizeApiRequest(_req, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const params = await props.params;
  const db = createServiceClient();
  const { data: movimento, error: consultaError } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('id,status_devolucao,produto_id,situacao_estoque')
    .eq('id', params.movimentoId)
    .eq('tipo', 'entrada_devolucao')
    .maybeSingle();
  if (consultaError || !movimento) {
    return NextResponse.json({ error: 'Movimento de estoque não encontrado.' }, { status: 404 });
  }
  if (String(movimento.status_devolucao || '') !== 'manual') {
    return NextResponse.json({ error: 'Somente inserções manuais podem ser excluídas.' }, { status: 409 });
  }
  if (String(movimento.situacao_estoque || '') !== 'revisao') {
    return NextResponse.json({ error: 'Somente inserções manuais ainda em revisão podem ser excluídas.' }, { status: 409 });
  }

  const { data: excluido, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .update({
      estornada_em: new Date().toISOString(),
      estorno_motivo: 'Entrada manual anulada antes da conferência',
    })
    .eq('id', params.movimentoId)
    .eq('status_devolucao', 'manual')
    .eq('situacao_estoque', 'revisao')
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!excluido) {
    return NextResponse.json({ error: 'Inserção manual não foi anulada.' }, { status: 409 });
  }

  try {
    const mlSync = await enfileirarSyncMlEstoqueInterno(String(movimento.produto_id));
    return NextResponse.json({ success: true, mlSync });
  } catch (syncError: any) {
    console.error('[estoque_interno_ml_sync_failed]', syncError?.message || syncError);
    return NextResponse.json({
      success: true,
      mlSyncWarning: 'Inserção anulada, mas não foi possível enfileirar a atualização do anúncio.',
    });
  }
}
