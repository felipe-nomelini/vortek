import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

export async function POST(req: Request) {
  try {
    const { pedidoId, mlOrderId, motivo } = await req.json().catch(() => ({}));
    if (!pedidoId && !mlOrderId) {
      return NextResponse.json({ error: 'pedidoId ou mlOrderId é obrigatório' }, { status: 400 });
    }

    const client = createServiceClient();
    let query = client
      .from('pedidos')
      .select('id,ml_order_id,dslite_id,dslite_status,dslite_etiqueta_enviada,dslite_label_source')
      .limit(1);

    if (pedidoId) {
      query = query.eq('id', String(pedidoId));
    } else {
      query = query.eq('ml_order_id', String(mlOrderId));
    }

    const { data: pedido, error: pedidoError } = await query.maybeSingle();
    if (pedidoError || !pedido) {
      return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
    }

    const dsliteIdAntigo = pedido.dslite_id ? String(pedido.dslite_id) : null;
    const dsliteStatusAntigo = pedido.dslite_status ? String(pedido.dslite_status) : null;

    await client
      .from('pedidos')
      .update({
        dslite_id: null,
        dslite_status: null,
        dslite_etiqueta_enviada: false,
        dslite_label_source: null,
      })
      .eq('id', pedido.id);

    await registrarEventoNfAuditoria({
      pedidoId: pedido.id,
      mlOrderId: pedido.ml_order_id ? String(pedido.ml_order_id) : null,
      evento: 'dslite_desvinculo_manual',
      payloadEnviado: {
        motivo: String(motivo || 'desvinculo_local_para_correcao_de_estado'),
      },
      respostaMl: {
        dslite_id_antigo: dsliteIdAntigo,
        dslite_status_antigo: dsliteStatusAntigo,
      },
      statusResultante: 'desvinculado_local',
    });

    return NextResponse.json({
      success: true,
      data: {
        id: pedido.id,
        ml_order_id: pedido.ml_order_id,
        dslite_id_antigo: dsliteIdAntigo,
        dslite_status_antigo: dsliteStatusAntigo,
        dslite_id_novo: null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao desvincular compra DSLite local' }, { status: 500 });
  }
}

