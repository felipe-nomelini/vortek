import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { normalizeNfeTechnicalStatus } from '@/lib/fiscal/nfe-status';
import { enviarCartaCorrecaoBrasilNfePorChave } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

function resolveTipoAmbiente(): 1 | 2 {
  const v = Number(String(process.env.BRASILNFE_TIPO_AMBIENTE || '1').trim());
  return v === 2 ? 2 : 1;
}

export async function POST(request: Request, context: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json({ error: 'ID da nota fiscal é obrigatório' }, { status: 422 });
  }

  const body = await request.json().catch(() => ({}));
  const correcao = String(body?.correcao || '').trim();
  const numeroSequencial = Math.max(1, Number(body?.numeroSequencial || 1));
  if (correcao.length < 15) {
    return NextResponse.json({ error: 'A descrição da correção deve ter no mínimo 15 caracteres.' }, { status: 422 });
  }

  const serviceClient = createServiceClient();
  const { data: pedido, error: pedidoError } = await serviceClient
    .from('pedidos')
    .select('id,ml_order_id,nfe_chave,nfe_status,nota_fiscal_numero')
    .eq('id', id)
    .maybeSingle();

  if (pedidoError) {
    return NextResponse.json({ error: 'Erro ao buscar nota fiscal' }, { status: 500 });
  }
  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }
  if (!pedido.nfe_chave) {
    return NextResponse.json({ error: 'Nota fiscal sem chave de acesso para Carta de Correção.' }, { status: 422 });
  }

  const statusNormalizado = normalizeNfeTechnicalStatus(pedido.nfe_status);
  if (statusNormalizado !== 'autorizada') {
    return NextResponse.json(
      { error: 'Carta de Correção só pode ser enviada para nota autorizada.' },
      { status: 422 },
    );
  }

  await registrarEventoNfAuditoria({
    pedidoId: pedido.id,
    mlOrderId: pedido.ml_order_id || null,
    evento: 'nota_fiscal_carta_correcao_start',
    payloadEnviado: {
      chave: pedido.nfe_chave,
      numero_nota: pedido.nota_fiscal_numero || null,
      numero_sequencial: numeroSequencial,
      correcao,
      tipo_ambiente: resolveTipoAmbiente(),
    },
    statusResultante: 'started',
  });

  const result = await enviarCartaCorrecaoBrasilNfePorChave({
    chave: pedido.nfe_chave,
    correcao,
    numeroSequencial,
    tipoAmbiente: resolveTipoAmbiente(),
  });

  if (!result.ok) {
    await registrarEventoNfAuditoria({
      pedidoId: pedido.id,
      mlOrderId: pedido.ml_order_id || null,
      evento: 'nota_fiscal_carta_correcao_failed',
      payloadEnviado: {
        chave: pedido.nfe_chave,
        numero_sequencial: numeroSequencial,
        correcao,
      },
      respostaMl: {
        error: result.error || null,
        provider_raw: result.raw || null,
      },
      statusResultante: 'failed',
    });
    return NextResponse.json({ error: result.error || 'Falha ao enviar Carta de Correção' }, { status: 502 });
  }

  await serviceClient
    .from('pedidos')
    .update({
      nfe_last_sync_at: new Date().toISOString(),
    } as any)
    .eq('id', pedido.id);

  await registrarEventoNfAuditoria({
    pedidoId: pedido.id,
    mlOrderId: pedido.ml_order_id || null,
    evento: 'nota_fiscal_carta_correcao_success',
    payloadEnviado: {
      chave: pedido.nfe_chave,
      numero_sequencial: numeroSequencial,
    },
    respostaMl: {
      protocolo: result.protocolo || null,
      provider_raw: result.raw || null,
    },
    statusResultante: 'success',
  });

  return NextResponse.json({
    success: true,
    protocolo: result.protocolo || null,
  });
}
