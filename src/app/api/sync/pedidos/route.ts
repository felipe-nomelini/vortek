import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const me = await fetchML<any>('/users/me');
  if (!me) return NextResponse.json({ erro: 'Erro ao conectar com ML' }, { status: 502 });

  const orders = await fetchML<any>(`/orders/search?seller=${me.id}&order.status=paid&limit=50`);
  if (!orders) return NextResponse.json({ erro: 'Erro ao buscar pedidos' }, { status: 502 });

  const results = orders.results || [];
  const serviceClient = createServiceClient();
  let salvos = 0;

  for (const o of results) {
    await serviceClient.from('pedidos').upsert({
      numero: o.id,
      numero_loja: String(o.id),
      data: o.date_created,
      contato_nome: o.buyer?.nickname || 'Desconhecido',
      total: o.total_amount || 0,
      situacao: o.status === 'paid' ? 'aberto' : o.status === 'shipped' ? 'faturado' : 'entregue',
      ml_order_id: String(o.id),
    }, { onConflict: 'ml_order_id' });

    salvos++;
  }

  return NextResponse.json({ ok: true, sincronizados: salvos, total: results.length });
}
