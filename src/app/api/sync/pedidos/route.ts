import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const me = await fetchML<any>('/users/me');
  if (!me) return NextResponse.json({ erro: 'Erro ao conectar com ML' }, { status: 502 });

  const serviceClient = createServiceClient();
  let totalGeral = 0;
  let salvos = 0;
  let offset = 0;
  const limit = 50;

  while (true) {
    const orders = await fetchML<any>(
      `/orders/search?seller=${me.id}&order.status=paid&limit=${limit}&offset=${offset}`
    );

    if (!orders) break;

    const results = orders.results || [];
    if (results.length === 0) break;

    totalGeral += results.length;

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

    const paging = orders.paging;
    const total = paging?.total || 0;
    offset += limit;

    if (offset >= total) break;
    if (results.length < limit) break;
  }

  return NextResponse.json({ ok: true, sincronizados: salvos, total: totalGeral });
}
