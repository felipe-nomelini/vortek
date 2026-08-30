import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { enqueueAutomaticPricesForCostChanges } from '@/lib/ml/automatic-pricing';

const SITUACOES = new Set(['liberado', 'nao_aproveitavel']);

export async function PATCH(req: Request, { params }: { params: { movimentoId: string } }) {
  const body = await req.json().catch(() => ({}));
  const situacao = String(body.situacao || '');
  if (!SITUACOES.has(situacao)) return NextResponse.json({ error: 'Situação inválida.' }, { status: 400 });

  const db = createServiceClient();
  const { data: movimento, error: consultaError } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('status_devolucao,produto_id,origem_entrada,custo_unitario')
    .eq('id', params.movimentoId)
    .eq('tipo', 'entrada_devolucao')
    .maybeSingle();
  if (consultaError || !movimento) return NextResponse.json({ error: 'Movimento de estoque não encontrado.' }, { status: 404 });
  if (!['delivered', 'returned', 'manual'].includes(String(movimento.status_devolucao || ''))) {
    return NextResponse.json({ error: 'Ações liberadas somente após entrega da devolução.' }, { status: 409 });
  }

  const { error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .update({ situacao_estoque: situacao, disponivel_venda: situacao === 'liberado' })
    .eq('id', params.movimentoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let automaticPricing = null;
  const isPurchaseRelease = situacao === 'liberado' && movimento.origem_entrada === 'compra';
  if (isPurchaseRelease) {
    const custoUnitario = Number(movimento.custo_unitario);
    if (!Number.isFinite(custoUnitario) || custoUnitario <= 0) {
      return NextResponse.json({ error: 'Compra sem custo unitário válido.' }, { status: 409 });
    }

    const { data: produto, error: produtoError } = await db
      .from('produtos')
      .select('id,custo')
      .eq('id', movimento.produto_id)
      .maybeSingle();
    if (produtoError || !produto) {
      return NextResponse.json({ error: produtoError?.message || 'Produto da compra não encontrado.' }, { status: 404 });
    }

    const custoAnterior = Number(produto.custo || 0);
    const { error: productUpdateError } = await db
      .from('produtos')
      .update({
        ativo: true,
        custo: custoUnitario,
        updated_at: new Date().toISOString(),
      })
      .eq('id', movimento.produto_id);
    if (productUpdateError) {
      return NextResponse.json({ error: productUpdateError.message }, { status: 500 });
    }

    try {
      automaticPricing = await enqueueAutomaticPricesForCostChanges(db, [{
        productId: String(movimento.produto_id),
        previous: { custo: custoAnterior },
        next: { custo: custoUnitario },
      }]);
    } catch (pricingError: any) {
      automaticPricing = {
        productsUpdated: 0,
        outboxEnqueued: 0,
        skipped: 0,
        errors: [{
          productId: String(movimento.produto_id),
          message: pricingError?.message || 'Falha ao recalcular preço automático.',
        }],
      };
    }
  }

  try {
    const mlSync = await enfileirarSyncMlEstoqueInterno(
      String(movimento.produto_id),
      undefined,
      { reactivateSupplierPaused: isPurchaseRelease },
    );
    return NextResponse.json({ success: true, mlSync, automaticPricing });
  } catch (syncError: any) {
    console.error('[estoque_interno_ml_sync_failed]', syncError?.message || syncError);
    return NextResponse.json({ success: true, mlSyncWarning: 'Saldo atualizado, mas não foi possível enfileirar a atualização do anúncio.' });
  }
}

export async function DELETE(_req: Request, { params }: { params: { movimentoId: string } }) {
  const db = createServiceClient();
  const { data: movimento, error: consultaError } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('id,status_devolucao,produto_id')
    .eq('id', params.movimentoId)
    .eq('tipo', 'entrada_devolucao')
    .maybeSingle();
  if (consultaError || !movimento) {
    return NextResponse.json({ error: 'Movimento de estoque não encontrado.' }, { status: 404 });
  }
  if (String(movimento.status_devolucao || '') !== 'manual') {
    return NextResponse.json({ error: 'Somente inserções manuais podem ser excluídas.' }, { status: 409 });
  }

  const { data: excluido, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .delete()
    .eq('id', params.movimentoId)
    .eq('status_devolucao', 'manual')
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!excluido) {
    return NextResponse.json({ error: 'Inserção manual não foi excluída.' }, { status: 409 });
  }

  try {
    const mlSync = await enfileirarSyncMlEstoqueInterno(String(movimento.produto_id));
    return NextResponse.json({ success: true, mlSync });
  } catch (syncError: any) {
    console.error('[estoque_interno_ml_sync_failed]', syncError?.message || syncError);
    return NextResponse.json({
      success: true,
      mlSyncWarning: 'Inserção excluída, mas não foi possível enfileirar a atualização do anúncio.',
    });
  }
}
