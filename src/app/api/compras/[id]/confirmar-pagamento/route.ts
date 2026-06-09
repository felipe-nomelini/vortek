import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const compraId = String(params.id || '').trim();
  if (!compraId) {
    return NextResponse.json({ error: 'ID da compra é obrigatório' }, { status: 422 });
  }

  const body = await request.json().catch(() => ({}));
  const supplierPaymentReference = String(body?.supplier_payment_reference || '').trim() || null;
  const supplierPaymentReceiptUrl = String(body?.supplier_payment_receipt_url || '').trim() || null;
  const supplierPaymentNotes = String(body?.supplier_payment_notes || '').trim() || null;

  const service = createServiceClient();
  const { data: compra, error: compraError } = await service
    .from('compras')
    .select('id,dsid,fornecedor_id,fornecedor_nome,supplier_payment_mode,supplier_payment_status,status,status_dslite')
    .eq('id', compraId)
    .maybeSingle();

  if (compraError) {
    return NextResponse.json({ error: compraError.message }, { status: 500 });
  }
  if (!compra?.id) {
    return NextResponse.json({ error: 'Compra não encontrada' }, { status: 404 });
  }
  if (compra.supplier_payment_mode !== 'prepaid_pix') {
    return NextResponse.json({ error: 'Esta compra não exige confirmação manual de pagamento' }, { status: 422 });
  }
  if (compra.supplier_payment_status === 'paid') {
    return NextResponse.json({ error: 'O pagamento desta compra já foi confirmado' }, { status: 409 });
  }

  const confirmedAt = new Date().toISOString();
  const confirmedBy = user.email || user.id;
  const nextStatus = String(compra.status_dslite || compra.status || 'Iniciado');

  const { error: updateError } = await service
    .from('compras')
    .update({
      supplier_payment_status: 'paid',
      supplier_payment_confirmed_at: confirmedAt,
      supplier_payment_confirmed_by: confirmedBy,
      supplier_payment_reference: supplierPaymentReference,
      supplier_payment_receipt_url: supplierPaymentReceiptUrl,
      supplier_payment_notes: supplierPaymentNotes,
      status: nextStatus,
    } as any)
    .eq('id', compraId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data: pedido, error: pedidoError } = await service
    .from('pedidos')
    .select('id,ml_order_id,numero')
    .eq('dslite_id', String(compra.dsid))
    .maybeSingle();

  if (pedidoError) {
    return NextResponse.json({ error: pedidoError.message }, { status: 500 });
  }
  if (!pedido?.id || !pedido?.ml_order_id) {
    return NextResponse.json({ error: 'Pedido de venda vinculado não encontrado para retomar o fluxo DSLite' }, { status: 404 });
  }

  await registrarEventoNfAuditoria({
    pedidoId: String(pedido.id),
    mlOrderId: String(pedido.ml_order_id),
    evento: 'supplier_payment_confirmed_manual',
    respostaMl: {
      compra_id: compraId,
      dslite_id: compra.dsid,
      fornecedor_id: compra.fornecedor_id || null,
      fornecedor_nome: compra.fornecedor_nome || null,
      confirmed_at: confirmedAt,
      confirmed_by: confirmedBy,
      supplier_payment_reference: supplierPaymentReference,
      supplier_payment_receipt_url: supplierPaymentReceiptUrl,
    },
    statusResultante: 'confirmed',
  });

  const origin = new URL(request.url).origin;
  const resumeResponse = await fetch(`${origin}/api/dslite/pedido`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pedidoId: String(pedido.id),
      mlOrderId: String(pedido.ml_order_id),
      nfeProvider: 'brasilnfe',
      resumeAfterSupplierPayment: true,
    }),
  });

  const resumeJson = await resumeResponse.json().catch(() => ({}));
  if (!resumeResponse.ok) {
    return NextResponse.json(
      { error: resumeJson?.error || 'Falha ao retomar o fluxo DSLite após confirmar o pagamento' },
      { status: resumeResponse.status || 500 },
    );
  }

  return NextResponse.json({
    success: true,
    jobId: resumeJson?.jobId || null,
    compraId,
    pedidoId: pedido.id,
    mlOrderId: pedido.ml_order_id,
  });
}
