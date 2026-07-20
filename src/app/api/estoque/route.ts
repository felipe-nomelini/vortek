import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const db = createServiceClient();
  const [entradasResult, saidasResult] = await Promise.all([
    (db as any)
      .from('estoque_interno_movimentacoes')
      .select('id,produto_id,pedido_id,quantidade,motivo,status_devolucao,situacao_estoque,created_at,produtos(sku,nome)')
      .eq('tipo', 'entrada_devolucao')
      .order('created_at', { ascending: false }),
    (db as any)
      .from('estoque_interno_movimentacoes')
      .select('id,produto_id,pedido_id,quantidade,motivo,created_at,produtos(sku,nome),pedidos(ml_order_id,envio_interno_at)')
      .eq('tipo', 'saida_envio_interno')
      .order('created_at', { ascending: false }),
  ]);
  if (entradasResult.error) return NextResponse.json({ error: entradasResult.error.message }, { status: 500 });
  if (saidasResult.error) return NextResponse.json({ error: saidasResult.error.message }, { status: 500 });

  const rows = (entradasResult.data || []).map((item: any) => ({
    id: item.id,
    produto_id: item.produto_id,
    pedido_id: item.pedido_id,
    sku: item.produtos?.sku || '-',
    nome: item.produtos?.nome || 'Produto não encontrado',
    quantidade: Number(item.quantidade || 0),
    motivo: item.motivo || 'Motivo não informado pelo Mercado Livre',
    status_devolucao: item.status_devolucao || 'aguardando_confirmacao',
    situacao_estoque: item.situacao_estoque || 'revisao',
  }));

  const resumo = rows.reduce((total: Record<string, number>, item: any) => {
    total[item.situacao_estoque] = (total[item.situacao_estoque] || 0) + item.quantidade;
    return total;
  }, {});

  const vendidos = (saidasResult.data || []).map((item: any) => ({
    id: item.id,
    sku: item.produtos?.sku || '-',
    nome: item.produtos?.nome || 'Produto não encontrado',
    quantidade: Number(item.quantidade || 0),
    pedido_ml: item.pedidos?.ml_order_id || '-',
    vendido_em: item.pedidos?.envio_interno_at || item.created_at,
  }));

  return NextResponse.json({
    data: rows,
    revisao: resumo.revisao || 0,
    liberado: resumo.liberado || 0,
    nao_aproveitavel: resumo.nao_aproveitavel || 0,
    vendidos,
    vendidosQuantidade: vendidos.reduce((total: number, item: any) => total + item.quantidade, 0),
  });
}
