import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await (db as any)
    .from('estoque_interno_movimentacoes')
    .select('id,produto_id,tipo,quantidade,motivo,disponivel_venda,created_at,produtos(sku,nome)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const agrupados = new Map<string, any>();
  for (const movimento of data || []) {
    const produtoId = String(movimento.produto_id);
    const item = agrupados.get(produtoId) || {
      produto_id: produtoId,
      sku: movimento.produtos?.sku || '-',
      nome: movimento.produtos?.nome || 'Produto não encontrado',
      quantidade: 0,
      disponivel: 0,
      motivos: new Set<string>(),
    };
    const quantidade = Number(movimento.quantidade || 0);
    if (movimento.tipo === 'entrada_devolucao') {
      item.quantidade += quantidade;
      if (movimento.disponivel_venda) item.disponivel += quantidade;
      item.motivos.add(movimento.motivo);
    } else {
      item.quantidade -= quantidade;
      item.disponivel -= quantidade;
    }
    agrupados.set(produtoId, item);
  }

  const rows = [...agrupados.values()]
    .filter((item) => item.quantidade > 0)
    .map((item) => ({ ...item, disponivel: Math.max(0, item.disponivel), motivos: [...item.motivos].join(', ') }));

  return NextResponse.json({
    data: rows,
    total: rows.length,
    disponivel: rows.reduce((total, item) => total + item.disponivel, 0),
    bloqueado: rows.reduce((total, item) => total + item.quantidade - item.disponivel, 0),
  });
}
