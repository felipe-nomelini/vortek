import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';
import { criarPedidoDropshipping } from '@/services/dslite';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { topic, resource } = body;

    if (!topic || !resource) {
      return NextResponse.json({ ok: false, erro: 'topic e resource obrigatórios' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const resourcePath = resource.replace('https://api.mercadolibre.com', '');

    if (topic === 'orders_v2') {
      const order = await fetchML<any>(resourcePath);
      if (order) {
        const { data: existing } = await serviceClient
          .from('pedidos')
          .select('id')
          .eq('ml_order_id', String(order.id))
          .maybeSingle();

        const pedidoPayload = {
          numero: Number(order.id) || 0,
          numero_loja: String(order.id || ''),
          data: order.date_created || new Date().toISOString(),
          contato_nome: order.buyer?.nickname || 'Desconhecido',
          contato_documento: String(order.buyer?.identification?.number || ''),
          total: order.total_amount || 0,
          situacao: order.status === 'paid' ? 'aberto' : 'atendido' as any,
          ml_order_id: String(order.id || ''),
        } as any;

        if (existing) {
          await serviceClient.from('pedidos').update(pedidoPayload).eq('id', existing.id);
        } else {
          const { data: inserted } = await serviceClient
            .from('pedidos')
            .insert(pedidoPayload)
            .select('id')
            .single();

          if (inserted && order.status === 'paid') {
            const xmlSimples = `<?xml version="1.0" encoding="UTF-8"?>
<pedido>
  <cliente>${order.buyer?.nickname || 'Cliente'}</cliente>
  <valor>${order.total_amount || 0}</valor>
  <ml_order_id>${order.id}</ml_order_id>
</pedido>`;
            const dsliteResult = await criarPedidoDropshipping(2, '', xmlSimples);
            if (dsliteResult) {
              await serviceClient
                .from('pedidos')
                .update({
                  dslite_id: String(dsliteResult.dsid),
                  dslite_status: dsliteResult.status,
                })
                .eq('id', inserted.id);
            }
          }
        }
      }
    }

    if (topic === 'questions') {
      // Notificações de perguntas — serão processadas sob demanda
    }

    if (topic === 'items') {
      // Notificações de alterações em anúncios — serão processadas sob demanda
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro desconhecido' }, { status: 500 });
  }
}
