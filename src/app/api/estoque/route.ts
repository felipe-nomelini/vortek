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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sku = String(body.sku || '').trim().toUpperCase();
  const quantidade = Number(body.quantidade);
  if (!sku) return NextResponse.json({ error: 'Informe o SKU.' }, { status: 400 });
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return NextResponse.json({ error: 'Informe uma quantidade inteira maior que zero.' }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: produto, error: produtoError } = await db
    .from('produtos')
    .select('id,sku,nome')
    .eq('sku', sku)
    .maybeSingle();
  if (produtoError) return NextResponse.json({ error: produtoError.message }, { status: 500 });
  if (!produto) return NextResponse.json({ error: 'Produto não encontrado para este SKU.' }, { status: 404 });

  const { error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .insert({
      produto_id: produto.id,
      tipo: 'entrada_devolucao',
      quantidade,
      motivo: 'Inserido manualmente',
      status_devolucao: 'manual',
      situacao_estoque: 'revisao',
      disponivel_venda: false,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, produto: { sku: produto.sku, nome: produto.nome } }, { status: 201 });
}
