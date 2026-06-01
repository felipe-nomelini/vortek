import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { normalizeNfeTechnicalStatus } from '@/lib/fiscal/nfe-status';
import { cancelarNotaBrasilNfePorChave } from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

const DEFAULT_JUSTIFICATIVA = 'Cancelamento operacional da NF-e solicitada pelo usuário';

function normalizeJustificativa(value: unknown): string {
  return String(value || '').trim();
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
  const justificativaRaw = normalizeJustificativa(body?.justificativa);
  const justificativa = justificativaRaw || DEFAULT_JUSTIFICATIVA;
  if (justificativa.length < 15) {
    return NextResponse.json({ error: 'A justificativa deve ter no mínimo 15 caracteres.' }, { status: 422 });
  }

  const serviceClient = createServiceClient();
  const { data: pedido, error: pedidoError } = await serviceClient
    .from('pedidos')
    .select('id,ml_order_id,nfe_chave,nfe_status,nfe_protocolo,nota_fiscal_numero')
    .eq('id', id)
    .maybeSingle();

  if (pedidoError) {
    return NextResponse.json({ error: 'Erro ao buscar nota fiscal' }, { status: 500 });
  }
  if (!pedido) {
    return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 });
  }

  const statusNormalizado = normalizeNfeTechnicalStatus(pedido.nfe_status);
  if (statusNormalizado === 'cancelada') {
    return NextResponse.json({ success: true, alreadyCanceled: true, message: 'Nota fiscal já está cancelada.' });
  }
  if (!pedido.nfe_chave) {
    return NextResponse.json({ error: 'Nota fiscal sem chave de acesso para cancelamento.' }, { status: 422 });
  }

  await registrarEventoNfAuditoria({
    pedidoId: pedido.id,
    mlOrderId: pedido.ml_order_id || null,
    evento: 'nota_fiscal_cancelamento_start',
    payloadEnviado: {
      chave: pedido.nfe_chave,
      numero_nota: pedido.nota_fiscal_numero || null,
      justificativa,
    },
    statusResultante: 'started',
  });

  const cancel = await cancelarNotaBrasilNfePorChave({
    chave: pedido.nfe_chave,
    protocolo: pedido.nfe_protocolo || null,
    justificativa,
  });

  if (!cancel.ok) {
    await registrarEventoNfAuditoria({
      pedidoId: pedido.id,
      mlOrderId: pedido.ml_order_id || null,
      evento: 'nota_fiscal_cancelamento_failed',
      payloadEnviado: {
        chave: pedido.nfe_chave,
        justificativa,
      },
      respostaMl: {
        error: cancel.error || null,
        provider_raw: cancel.raw || null,
      },
      statusResultante: 'failed',
    });
    return NextResponse.json({ error: cancel.error || 'Falha ao cancelar nota fiscal' }, { status: 502 });
  }

  await serviceClient
    .from('pedidos')
    .update({
      nfe_status: 'cancelada',
      nfe_last_sync_at: new Date().toISOString(),
    } as any)
    .eq('id', pedido.id);

  await registrarEventoNfAuditoria({
    pedidoId: pedido.id,
    mlOrderId: pedido.ml_order_id || null,
    evento: 'nota_fiscal_cancelamento_success',
    payloadEnviado: {
      chave: pedido.nfe_chave,
      justificativa,
    },
    respostaMl: {
      provider_raw: cancel.raw || null,
    },
    statusResultante: 'success',
  });

  return NextResponse.json({ success: true, status: 'cancelada' });
}
