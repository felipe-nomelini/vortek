import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { formatCurrency } from '@/lib/format';
import { formatMlReleaseWindow } from '@/lib/ml/release-window-display';
import { buildPublicSupplierReceiptUrl } from '@/lib/public-supplier-receipt-links';
import { createShortLink } from '@/lib/short-links';
import { normalizeWhatsappChatId, sendWahaFile, sendWahaText } from '@/services/waha';

const RECEIPTS_BUCKET = 'supplier-payment-receipts';
const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024;

function safeFilename(value: string): string {
  const name = String(value || 'comprovante').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'comprovante';
}

function resolveReceiptMimeType(file: File): string {
  const explicit = String(file.type || '').trim().toLowerCase();
  if (['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(explicit)) return explicit;
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  throw new Error('Formato de comprovante inválido. Use PDF, JPG, PNG ou WEBP.');
}

async function parsePaymentConfirmationRequest(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const receipt = form.get('receipt');
    return {
      supplierPaymentReference: String(form.get('supplier_payment_reference') || '').trim() || null,
      supplierPaymentReceiptUrl: String(form.get('supplier_payment_receipt_url') || '').trim() || null,
      supplierPaymentNotes: String(form.get('supplier_payment_notes') || '').trim() || null,
      resumeDsliteFlow: String(form.get('resume_dslite_flow') || '').trim() === 'true',
      receiptFile: receipt instanceof File && receipt.size > 0 ? receipt : null,
    };
  }

  const body = await request.json().catch(() => ({}));
  return {
    supplierPaymentReference: String(body?.supplier_payment_reference || '').trim() || null,
    supplierPaymentReceiptUrl: String(body?.supplier_payment_receipt_url || '').trim() || null,
    supplierPaymentNotes: String(body?.supplier_payment_notes || '').trim() || null,
    resumeDsliteFlow: Boolean(body?.resume_dslite_flow),
    receiptFile: null as File | null,
  };
}

async function uploadReceiptFile(input: {
  service: ReturnType<typeof createServiceClient>;
  compraId: string;
  dsid: string | null;
  file: File;
}) {
  if (input.file.size > MAX_RECEIPT_SIZE_BYTES) {
    throw new Error('Comprovante maior que 10MB');
  }

  const buffer = Buffer.from(await input.file.arrayBuffer());
  const filename = safeFilename(input.file.name || 'comprovante');
  const mimetype = resolveReceiptMimeType(input.file);
  const path = `compras/${input.compraId}/${Date.now()}-${input.dsid || 'sem-dsid'}-${filename}`;
  const { error } = await input.service.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, buffer, {
      contentType: mimetype,
      upsert: true,
    });
  if (error) throw new Error(`Falha ao salvar comprovante: ${error.message}`);
  return {
    path,
    buffer,
    filename,
    mimetype,
  };
}

async function downloadReceiptFile(input: {
  service: ReturnType<typeof createServiceClient>;
  path: string | null;
}) {
  const path = String(input.path || '').trim();
  if (!path) return null;
  const { data, error } = await input.service.storage.from(RECEIPTS_BUCKET).download(path);
  if (error || !data) throw new Error(`Falha ao ler comprovante salvo: ${error?.message || 'arquivo indisponível'}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  const filename = safeFilename(path.split('/').pop() || 'comprovante.pdf');
  return {
    path,
    buffer,
    filename,
    mimetype: data.type || 'application/pdf',
  };
}

async function sendSupplierPaymentWhatsapp(input: {
  service: ReturnType<typeof createServiceClient>;
  appBaseUrl: string;
  compra: any;
  pedido: any;
  fornecedorTelefone: string | null;
  receipt: { buffer: Buffer; filename: string; mimetype: string } | null;
  reference: string | null;
  notes: string | null;
}) {
  const phone = String(input.fornecedorTelefone || '').replace(/\D/g, '');
  if (!phone) return { sent: false, skipped: true, reason: 'supplier_phone_missing' };
  if (!input.receipt) return { sent: false, skipped: true, reason: 'receipt_missing' };

  const releaseAt = String(input.pedido?.ml_fiscal_release_at || '').trim();
  const release = releaseAt ? formatMlReleaseWindow(releaseAt) : null;
  const labelStatus = release
    ? `Etiqueta ML: prevista para ${release.when}${release.remaining ? ` (${release.remaining})` : ''}`
    : 'Etiqueta ML: sem previsão registrada no momento';
  const receiptUrl = buildPublicSupplierReceiptUrl(input.appBaseUrl, String(input.compra.id));
  const receiptShortUrl = await createShortLink({
    client: input.service,
    baseUrl: input.appBaseUrl,
    targetUrl: receiptUrl,
    purpose: 'supplier_payment_receipt',
    metadata: {
      compraId: input.compra.id,
      dsid: input.compra.dsid || null,
      fornecedorId: input.compra.fornecedor_id || null,
    },
  });
  const caption = [
    '*Comprovante PIX recebido*',
    `O comprovante do pedido *#${input.compra.dsid || '—'}* está disponível no link abaixo:`,
    receiptShortUrl || receiptUrl,
    '------------------------',
    '*STATUS DA ETIQUETA*',
    labelStatus,
    'Aguarde o envio da etiqueta real antes de despachar o pedido.',
    '------------------------',
    '*PEDIDO DSLITE*',
    `Número: #${input.compra.dsid || '—'}`,
    `Fornecedor: ${input.compra.fornecedor_nome || '—'}`,
    `Valor pago: ${formatCurrency(Number(input.compra.supplier_payment_amount || 0))}`,
    input.reference ? `Referência PIX: ${input.reference}` : null,
    '------------------------',
    '*VENDA MERCADO LIVRE*',
    input.pedido?.ml_order_id ? `Pedido ML: #${input.pedido.ml_order_id}` : null,
    input.pedido?.numero ? `Venda: #${input.pedido.numero}` : null,
    '------------------------',
    '*Produto*',
    input.compra.produto_descricao || 'Produto não informado',
    `Quantidade: ${input.compra.quantidade || 1}`,
    '------------------------',
    input.notes ? `Observações: ${input.notes}` : null,
  ].filter(Boolean).join('\n');

  const chatId = normalizeWhatsappChatId(phone);
  try {
    await sendWahaFile({
      chatId,
      caption,
      filename: input.receipt.filename,
      mimetype: input.receipt.mimetype,
      data: input.receipt.buffer,
    });
    return { sent: true, skipped: false, mode: 'file' };
  } catch (err: any) {
    const message = String(err?.message || err || '');
    const plusOnly = message.toLowerCase().includes('plus version') || message.toLowerCase().includes('available only in plus');
    if (!plusOnly) throw err;
    await sendWahaText({ chatId, text: caption });
    return { sent: true, skipped: false, mode: 'text_link', fallbackReason: 'waha_file_plus_only' };
  }
}

function resolveAppBaseUrl(request: Request): string {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function resolveInternalApiBaseUrl(request: Request): string {
  const configured = String(process.env.INTERNAL_APP_URL || process.env.NEXT_INTERNAL_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const port = String(process.env.PORT || '3000').trim() || '3000';
  if (process.env.NODE_ENV === 'production') return `http://127.0.0.1:${port}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function startDsliteResumeFlow(input: { request: Request; pedidoId: string; mlOrderId: string }) {
  const body = JSON.stringify({
    pedidoId: input.pedidoId,
    mlOrderId: input.mlOrderId,
    nfeProvider: 'brasilnfe',
    resumeAfterSupplierPayment: true,
  });
  const headers = {
    'Content-Type': 'application/json',
    ...(process.env.API_SECRET_KEY ? { 'x-api-key': process.env.API_SECRET_KEY } : {}),
  };
  const urls = Array.from(new Set([
    `${resolveInternalApiBaseUrl(input.request)}/api/dslite/pedido`,
    `${new URL(input.request.url).origin}/api/dslite/pedido`,
  ]));
  let lastError: string | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, { method: 'POST', headers, body });
      const json = await response.json().catch(() => ({}));
      if (response.ok) return { json, error: null as string | null };
      lastError = json?.error || `HTTP ${response.status}`;
    } catch (err: any) {
      lastError = err?.message || 'fetch failed';
    }
  }

  return {
    json: null as any,
    error: lastError || 'Falha ao retomar o fluxo DSLite após confirmar o pagamento',
  };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));

  const compraId = String(params.id || '').trim();
  if (!compraId) {
    return NextResponse.json({ error: 'ID da compra é obrigatório' }, { status: 422 });
  }

  const parsed = await parsePaymentConfirmationRequest(request);
  const supplierPaymentReference = parsed.supplierPaymentReference;
  const supplierPaymentReceiptUrl = parsed.supplierPaymentReceiptUrl;
  const supplierPaymentNotes = parsed.supplierPaymentNotes;
  const resumeDsliteFlow = Boolean(parsed.resumeDsliteFlow);

  const service = createServiceClient();
  const { data: compra, error: compraError } = await service
    .from('compras')
    .select('id,dsid,fornecedor_id,fornecedor_nome,supplier_payment_mode,supplier_payment_status,status,status_dslite,supplier_payment_amount,produto_descricao,quantidade,supplier_payment_reference,supplier_payment_receipt_url,supplier_payment_receipt_path,supplier_payment_notes,supplier_payment_confirmed_at,supplier_payment_confirmed_by')
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

  const alreadyPaid = compra.supplier_payment_status === 'paid';
  if (!parsed.receiptFile && !(compra as any).supplier_payment_receipt_path) {
    return NextResponse.json({ error: 'Anexe o comprovante para enviar ao fornecedor' }, { status: 422 });
  }

  const confirmedAt = (compra as any).supplier_payment_confirmed_at || new Date().toISOString();
  const confirmedBy = (compra as any).supplier_payment_confirmed_by || user?.email || user?.id || 'dslite_order_flow';
  const nextStatus = String(compra.status_dslite || compra.status || 'Iniciado');
  const uploadedReceipt = parsed.receiptFile
    ? await uploadReceiptFile({
      service,
      compraId,
      dsid: compra.dsid ? String(compra.dsid) : null,
      file: parsed.receiptFile,
    })
    : await downloadReceiptFile({
      service,
      path: (compra as any).supplier_payment_receipt_path || null,
    });

  const { error: updateError } = await service
    .from('compras')
    .update({
      supplier_payment_status: 'paid',
      supplier_payment_confirmed_at: confirmedAt,
      supplier_payment_confirmed_by: confirmedBy,
      supplier_payment_reference: supplierPaymentReference ?? (compra as any).supplier_payment_reference ?? null,
      supplier_payment_receipt_url: supplierPaymentReceiptUrl ?? (compra as any).supplier_payment_receipt_url ?? null,
      supplier_payment_receipt_path: uploadedReceipt?.path || (compra as any).supplier_payment_receipt_path || null,
      supplier_payment_notes: supplierPaymentNotes ?? (compra as any).supplier_payment_notes ?? null,
      status: nextStatus,
    } as any)
    .eq('id', compraId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data: pedido, error: pedidoError } = await service
    .from('pedidos')
    .select('id,ml_order_id,numero,ml_fiscal_release_at')
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
      already_paid: alreadyPaid,
      confirmed_at: confirmedAt,
      confirmed_by: confirmedBy,
      supplier_payment_reference: supplierPaymentReference,
      supplier_payment_receipt_url: supplierPaymentReceiptUrl,
    },
    statusResultante: 'confirmed',
  });

  const { data: fornecedor } = await service
    .from('fornecedores')
    .select('telefone')
    .eq('dslite_id', String(compra.fornecedor_id || ''))
    .maybeSingle();

  let whatsappResult: Record<string, unknown> | null = null;
  try {
    whatsappResult = await sendSupplierPaymentWhatsapp({
      service,
      appBaseUrl: resolveAppBaseUrl(request),
      compra,
      pedido,
      fornecedorTelefone: (fornecedor as any)?.telefone || null,
      receipt: uploadedReceipt,
      reference: supplierPaymentReference,
      notes: supplierPaymentNotes,
    });
    await registrarEventoNfAuditoria({
      pedidoId: String(pedido.id),
      mlOrderId: String(pedido.ml_order_id),
      evento: 'supplier_payment_whatsapp_sent',
      respostaMl: {
        compra_id: compraId,
        dslite_id: compra.dsid,
        fornecedor_id: compra.fornecedor_id || null,
        fornecedor_phone_suffix: String((fornecedor as any)?.telefone || '').replace(/\D/g, '').slice(-4) || null,
        result: whatsappResult,
      },
      statusResultante: whatsappResult?.sent ? 'sent' : 'skipped',
    });
  } catch (err: any) {
    whatsappResult = { sent: false, error: err?.message || 'Erro ao enviar WhatsApp ao fornecedor' };
    await registrarEventoNfAuditoria({
      pedidoId: String(pedido.id),
      mlOrderId: String(pedido.ml_order_id),
      evento: 'supplier_payment_whatsapp_failed',
      respostaMl: {
        compra_id: compraId,
        dslite_id: compra.dsid,
        fornecedor_id: compra.fornecedor_id || null,
        error: err?.message || 'Erro ao enviar WhatsApp ao fornecedor',
      },
      statusResultante: 'failed',
    });
  }

  let resumeJson: any = null;
  let resumeError: string | null = null;
  if (resumeDsliteFlow) {
    const resume = await startDsliteResumeFlow({
      request,
      pedidoId: String(pedido.id),
      mlOrderId: String(pedido.ml_order_id),
    });
    resumeJson = resume.json;
    resumeError = resume.error;
  }

  return NextResponse.json({
    success: true,
    jobId: resumeJson?.jobId || null,
    resume: resumeDsliteFlow ? {
      started: Boolean(resumeJson?.jobId),
      error: resumeError,
    } : null,
    compraId,
    pedidoId: pedido.id,
    mlOrderId: pedido.ml_order_id,
    receiptPath: uploadedReceipt?.path || (compra as any).supplier_payment_receipt_path || null,
    whatsapp: whatsappResult,
  });
}
