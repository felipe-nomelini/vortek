import { NextResponse } from 'next/server';
import { definirTransportadoraPedido, enviarEtiqueta } from '@/services/dslite';
import { baixarEtiquetaML } from '@/services/integration';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { pedidoId, dsid } = await req.json();

    if (!pedidoId || !dsid) {
      return NextResponse.json({ error: 'pedidoId e dsid são obrigatórios' }, { status: 400 });
    }

    const client = createServiceClient();

    // Busca ml_shipment_id do pedido
    const { data: pedido, error: pedidoError } = await client
      .from('pedidos')
      .select('ml_shipment_id')
      .eq('id', pedidoId)
      .maybeSingle();

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
    }

    if (!pedido.ml_shipment_id) {
      return NextResponse.json({ error: 'Pedido sem envio (ml_shipment_id) no Mercado Livre' }, { status: 400 });
    }

    // Step 1: Baixa etiqueta do ML
    const etiquetaResult = await baixarEtiquetaML(String(pedido.ml_shipment_id));
    if (!etiquetaResult.pdf) {
      return NextResponse.json(
        { error: etiquetaResult.error || 'Falha ao baixar etiqueta do ML' },
        { status: 502 }
      );
    }

    // Step 2: Define transportadora Correios (ID 31)
    const transportadoraResult = await definirTransportadoraPedido(dsid, 31);
    if (!transportadoraResult?.success) {
      return NextResponse.json(
        { error: transportadoraResult?.message || 'Falha ao definir transportadora na DSLite' },
        { status: 502 }
      );
    }

    // Step 3: Envia etiqueta para DSLite
    const envioResult = await enviarEtiqueta(dsid, etiquetaResult.pdf, 'etiqueta_ml.pdf');
    if (!envioResult?.success) {
      return NextResponse.json(
        { error: envioResult?.message || 'Falha ao enviar etiqueta para DSLite' },
        { status: 502 }
      );
    }

    // Atualiza banco
    await client
      .from('pedidos')
      .update({ dslite_etiqueta_enviada: true })
      .eq('id', pedidoId);

    return NextResponse.json({
      success: true,
      data: {
        etiquetaBaixada: true,
        etiquetaBytes: etiquetaResult.pdf.length,
        transportadoraDefinida: true,
        transportadoraMensagem: transportadoraResult?.message,
        etiquetaEnviada: true,
      },
    });
  } catch (err: any) {
    console.error('[api/dslite/etiqueta-auto] Erro:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
