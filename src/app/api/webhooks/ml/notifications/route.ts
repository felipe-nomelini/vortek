import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { topic, resource } = body;

    console.log(`[Webhook ML] topic=${topic} resource=${resource}`);

    if (!topic || !resource) {
      return NextResponse.json({ ok: false, erro: 'topic e resource obrigatórios' }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    const resourcePath = resource.replace('https://api.mercadolibre.com', '');

    if (topic === 'orders') {
      const order = await fetchML<any>(resourcePath);
      if (order) {
        await serviceClient.from('pedidos').upsert({
          numero: order.id,
          numero_loja: String(order.id),
          data: order.date_created,
          contato_nome: order.buyer?.nickname || 'Desconhecido',
          total: order.total_amount || 0,
          situacao: order.status === 'paid' ? 'aberto' : order.status === 'shipped' ? 'faturado' : 'entregue',
          ml_order_id: String(order.id),
        }, { onConflict: 'ml_order_id' });
        console.log(`[Webhook ML] Order ${order.id} saved`);
      }
    }

    if (topic === 'questions') {
      const questionId = resourcePath.split('/').pop();
      console.log(`[Webhook ML] Question ${questionId} received - sync on demand`);
    }

    if (topic === 'claims') {
      const claimId = resourcePath.split('/').pop();
      console.log(`[Webhook ML] Claim ${claimId} received - sync on demand`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Webhook ML] Error:', err);
    return NextResponse.json({ ok: false, erro: 'Internal error' }, { status: 500 });
  }
}
