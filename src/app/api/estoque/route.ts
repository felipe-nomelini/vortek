import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('id,produto_id,pedido_id,quantidade,motivo,status_devolucao,situacao_estoque,created_at,produtos(sku,nome)')
    .eq('tipo', 'entrada_devolucao')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data || []).map((item: any) => ({
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

  return NextResponse.json({
    data: rows,
    revisao: resumo.revisao || 0,
    liberado: resumo.liberado || 0,
    nao_aproveitavel: resumo.nao_aproveitavel || 0,
  });
}
