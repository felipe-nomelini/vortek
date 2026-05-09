import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

export const maxDuration = 120;

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = 50;

  const me = await fetchML<any>('/users/me');
  if (!me) return NextResponse.json({ erro: 'Erro ao conectar com ML' }, { status: 502 });

  const orders = await fetchML<any>(
    `/orders/search?seller=${me.id}&order.status=paid&limit=${limit}&offset=${offset}`
  );

  if (!orders) return NextResponse.json({ erro: 'Erro ao buscar pedidos' }, { status: 502 });

  const results = orders.results || [];
  if (results.length === 0) {
    return NextResponse.json({ ok: true, sincronizados: 0, total: 0, proximo: offset, acabou: true });
  }

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

  const total = orders.paging?.total || 0;
  const proximo = offset + limit;
  const acabou = proximo >= total || results.length < limit;

  return NextResponse.json({
    ok: true,
    sincronizados: salvos,
    pagina: Math.floor(offset / limit) + 1,
    total,
    proximo: acabou ? null : proximo,
    acabou,
  });
}
