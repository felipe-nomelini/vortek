import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  baixarEtiquetaML,
  consultarInvoiceDataPorShipmentML,
  upsertInvoiceDataMLByShipment,
} from '@/services/integration';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { normalizeWhatsappChatId, sendWahaFile, sendWahaText } from '@/services/waha';
import {
  createShippingLabelSignedUrl,
  downloadShippingLabelFromStorage,
  storeShippingLabelForPedido,
} from '@/lib/shipping-label-storage';
import { DSLITE_PLACEHOLDER_LABEL_FILE_NAME, loadDslitePlaceholderLabel } from '@/lib/dslite/placeholder-label';
import { buildPublicNfeUrl } from '@/lib/public-nfe-links';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 90;

const LABEL_RETRY_INTERVAL_MS = 5000;
const LABEL_WAIT_TIMEOUT_MS = 60000;

function extractXmlTag(xml: string | null | undefined, tag: string): string | null {
  const raw = String(xml || '');
  if (!raw) return null;
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return raw.match(new RegExp(`<${escaped}>([^<]+)</${escaped}>`))?.[1]?.trim() || null;
}

function extractFiscalKey(xml: string): string | null {
  return extractXmlTag(xml, 'chNFe');
}

function parseInvoiceDateFromXml(xml: string): string | null {
  const dhEmi = extractXmlTag(xml, 'dhEmi');
  if (dhEmi) {
    const parsed = new Date(dhEmi);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const dEmi = extractXmlTag(xml, 'dEmi');
  if (!dEmi) return null;
  const parsed = new Date(`${dEmi}T00:00:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseInvoiceAmountFromXml(xml: string): number | null {
  const value = extractXmlTag(xml, 'vNF');
  if (!value) return null;
  const amount = Number(value.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatCurrencyBRL(value: unknown): string | null {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function limitText(value: unknown, maxLength: number): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function isWahaPlusOnlyError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '').toLowerCase();
  return message.includes('plus version') || message.includes('available only in plus');
}

function resolveAppBaseUrl(request: Request): string {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function resolveShipmentId(client: ReturnType<typeof createServiceClient>, pedido: any): Promise<string | null> {
  const existing = String(pedido?.ml_shipment_id || '').trim();
  if (existing) return existing;

  const mlOrderId = String(pedido?.ml_order_id || '').trim();
  if (!mlOrderId) return null;

  const shipment = await import('@/services/integration')
    .then(({ fetchML }) => fetchML<any>(`/orders/${encodeURIComponent(mlOrderId)}/shipments`))
    .catch(() => null);
  const shipmentId = String(shipment?.id || '').trim();
  if (!shipmentId) return null;

  await client.from('pedidos').update({ ml_shipment_id: shipmentId } as any).eq('id', pedido.id);
  return shipmentId;
}

async function downloadLabelWithRetry(pedidoId: string, mlOrderId: string | null, shipmentId: string) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = 'Falha ao baixar etiqueta do ML';
  let lastStatusCode: number | null = null;
  let lastReason: string | null = null;

  while (Date.now() - startedAt <= LABEL_WAIT_TIMEOUT_MS) {
    attempts += 1;
    const result = await baixarEtiquetaML(shipmentId);
    if (result.pdf) {
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId,
        evento: 'whatsapp_label_download_success',
        respostaMl: {
          ml_shipment_id: shipmentId,
          attempts,
          bytes: result.pdf.length,
          elapsed_ms: Date.now() - startedAt,
          status_http: result.statusCode || null,
        },
        statusResultante: 'success',
      });
      return { pdf: result.pdf, attempts, elapsedMs: Date.now() - startedAt };
    }

    lastError = result.error || lastError;
    lastStatusCode = result.statusCode ?? null;
    lastReason = result.reason || null;

    const canRetry = Boolean(result.retryable);
    const wouldExceed = Date.now() - startedAt + LABEL_RETRY_INTERVAL_MS > LABEL_WAIT_TIMEOUT_MS;
    if (!canRetry || wouldExceed) break;
    await new Promise((resolve) => setTimeout(resolve, LABEL_RETRY_INTERVAL_MS));
  }

  await registrarEventoNfAuditoria({
    pedidoId,
    mlOrderId,
    evento: 'whatsapp_label_download_failed',
    respostaMl: {
      ml_shipment_id: shipmentId,
      attempts,
      elapsed_ms: Date.now() - startedAt,
      status_http: lastStatusCode,
      reason: lastReason,
      error: lastError,
    },
    statusResultante: 'failed',
  });

  throw new Error(lastError || 'Etiqueta ainda indisponível no ML');
}

async function ensureInvoiceDataIfNeeded(params: {
  pedido: any;
  pedidoId: string;
  mlOrderId: string | null;
  shipmentId: string;
}) {
  const { pedido, pedidoId, mlOrderId, shipmentId } = params;
  const xml = String(pedido.nfe_xml || '').trim();
  const invoiceData = await consultarInvoiceDataPorShipmentML(shipmentId, 'MLB');
  const mlFiscalKey = invoiceData.ok ? String(invoiceData.data?.fiscal_key || '').trim() : '';
  const existingInvoiceNumber = invoiceData.ok ? String(invoiceData.data?.invoice_number || '').trim() : '';

  if (!xml && mlFiscalKey) {
    return {
      uploadedInvoice: false,
      invoiceNumber: existingInvoiceNumber || String(pedido.nota_fiscal_numero || '').trim(),
      skippedInvoiceUpload: true,
    };
  }

  if (!xml) throw new Error('Pedido sem XML da NF para liberar etiqueta no ML');

  const fiscalKey = String(pedido.nfe_chave || '').trim() || extractFiscalKey(xml);
  const invoiceNumber = extractXmlTag(xml, 'nNF') || String(pedido.nota_fiscal_numero || '').trim();
  const invoiceSerie = extractXmlTag(xml, 'serie') || '1';
  const invoiceDate = parseInvoiceDateFromXml(xml) || new Date().toISOString();
  const invoiceAmount = parseInvoiceAmountFromXml(xml) || Number(pedido.total || 0);
  const cfop = extractXmlTag(xml, 'CFOP') || String(pedido.nfe_cfop || '').trim() || undefined;

  if (!fiscalKey || !invoiceNumber || !(invoiceAmount > 0)) {
    throw new Error('XML da NF sem chave, número ou valor para upload no ML');
  }

  if (mlFiscalKey === fiscalKey) {
    return { uploadedInvoice: false, invoiceNumber, skippedInvoiceUpload: true };
  }

  const upload = await upsertInvoiceDataMLByShipment({
    shipmentId,
    fiscalKey,
    invoiceNumber,
    invoiceSerie,
    invoiceDate,
    invoiceAmount,
    nfeXml: xml,
    cfop,
  });

  await registrarEventoNfAuditoria({
    pedidoId,
    mlOrderId,
    evento: upload.ok ? 'whatsapp_label_invoice_upload_success' : 'whatsapp_label_invoice_upload_failed',
    respostaMl: {
      ml_shipment_id: shipmentId,
      status_http: upload.statusCode || null,
      error: upload.error || null,
      reason: upload.reason || null,
      attempts: upload.attempts || [],
    },
    statusResultante: upload.ok ? 'success' : 'failed',
  });

  if (!upload.ok) throw new Error(upload.error || 'Falha ao subir XML da NF no ML');
  return { uploadedInvoice: true, invoiceNumber, skippedInvoiceUpload: false };
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { phoneNumber, usePlaceholderLabel } = await request.json().catch(() => ({}));
    const chatId = normalizeWhatsappChatId(String(phoneNumber || ''));
    const client = createServiceClient();

    const { data: pedido, error: pedidoError } = await client
      .from('pedidos')
      .select('id,numero,ml_order_id,ml_shipment_id,nfe_xml,nfe_chave,nota_fiscal_numero,total,nfe_cfop,dslite_id,billing_nome,contato_nome,ml_label_storage_path,ml_label_bytes')
      .eq('id', params.id)
      .maybeSingle();
    if (pedidoError) return NextResponse.json({ error: pedidoError.message }, { status: 500 });
    if (!pedido) return NextResponse.json({ error: 'Pedido de venda não encontrado' }, { status: 404 });

    const pedidoId = String((pedido as any).id);
    const mlOrderId = String((pedido as any).ml_order_id || '').trim() || null;
    const shipmentId = await resolveShipmentId(client, pedido);
    if (!shipmentId) return NextResponse.json({ error: 'Pedido sem shipment ML para baixar etiqueta' }, { status: 422 });

    const dsid = String((pedido as any).dslite_id || '').trim();
    const { data: compra } = dsid
      ? await client.from('compras').select('*').eq('dsid', dsid).maybeSingle()
      : { data: null };

    let labelPdf = usePlaceholderLabel
      ? await loadDslitePlaceholderLabel()
      : await downloadShippingLabelFromStorage(client, (pedido as any).ml_label_storage_path);
    let labelSource: 'storage' | 'mercado_livre' | 'placeholder' = usePlaceholderLabel
      ? 'placeholder'
      : labelPdf ? 'storage' : 'mercado_livre';
    let labelAttempts = 0;
    let uploadedInvoice = false;
    let skippedInvoiceUpload = false;
    let invoiceNumber = String((pedido as any).nota_fiscal_numero || '').trim();
    const nfeKey = String((pedido as any).nfe_chave || '').trim();
    let labelDownloadUrl: string | null = null;

    if (!labelPdf && !usePlaceholderLabel) {
      const invoice = await ensureInvoiceDataIfNeeded({ pedido, pedidoId, mlOrderId, shipmentId });
      uploadedInvoice = invoice.uploadedInvoice;
      skippedInvoiceUpload = invoice.skippedInvoiceUpload;
      invoiceNumber = invoice.invoiceNumber || invoiceNumber;

      const label = await downloadLabelWithRetry(pedidoId, mlOrderId, shipmentId);
      labelPdf = label.pdf;
      labelAttempts = label.attempts;
      const stored = await storeShippingLabelForPedido({
        client,
        pedidoId,
        pedidoNumero: (pedido as any).numero,
        mlOrderId,
        shipmentId,
        pdf: label.pdf,
        source: 'pedidos_whatsapp',
      });
      labelDownloadUrl = stored.signedUrl || null;
    }

    if (!labelPdf) return NextResponse.json({ error: 'Etiqueta não encontrada ou indisponível' }, { status: 422 });

    if (usePlaceholderLabel) {
      labelDownloadUrl = `${resolveAppBaseUrl(request)}/dslite/labels/etiqueta-frete-terceiros-posterior.pdf`;
    } else if (!labelDownloadUrl && (pedido as any).ml_label_storage_path) {
      labelDownloadUrl = await createShippingLabelSignedUrl(client, String((pedido as any).ml_label_storage_path));
    }

    const filename = usePlaceholderLabel
      ? DSLITE_PLACEHOLDER_LABEL_FILE_NAME
      : `etiqueta_ml_${String((pedido as any).numero || mlOrderId || shipmentId)}.pdf`;
    const valorCompra = formatCurrencyBRL((compra as any)?.valor_total);
    const appBaseUrl = resolveAppBaseUrl(request);
    const danfeUrl = invoiceNumber ? buildPublicNfeUrl(appBaseUrl, pedidoId, 'danfe') : null;
    const xmlUrl = nfeKey ? buildPublicNfeUrl(appBaseUrl, pedidoId, 'xml') : null;
    const fornecedorNome = limitText((compra as any)?.fornecedor_nome, 80);
    const clienteNome = limitText((pedido as any).billing_nome || (pedido as any).contato_nome, 80);
    const produtoDescricao = limitText((compra as any)?.produto_descricao, 120);
    const labelStatus = labelSource === 'storage'
      ? 'arquivo ja salvo no sistema'
      : labelSource === 'placeholder'
        ? 'generica para teste'
        : 'baixada do Mercado Livre';
    const caption = [
      '*ETIQUETA MERCADO LIVRE*',
      dsid ? `*Pedido DSLite:* #${dsid}` : '*Pedido DSLite:* nao vinculado',
      labelDownloadUrl ? `*Link da etiqueta:*\n${labelDownloadUrl}` : null,

      '*PEDIDO*',
      `Venda ML: #${(pedido as any).numero}`,
      `Envio ML: ${shipmentId}`,
      fornecedorNome ? `Fornecedor: ${fornecedorNome}` : null,

      '*NOTA FISCAL*',
      invoiceNumber ? `NF: ${invoiceNumber}` : null,
      danfeUrl ? `DANFE PDF:\n${danfeUrl}` : null,
      nfeKey ? `Chave NF-e: ${nfeKey}` : null,
      xmlUrl ? `XML:\n${xmlUrl}` : null,

      '*CLIENTE*',
      clienteNome || null,

      '*PRODUTO*',
      produtoDescricao || null,
      (compra as any)?.quantidade ? `Quantidade: ${(compra as any).quantidade}` : null,
      valorCompra ? `Valor compra: ${valorCompra}` : null,

      '*OBSERVACAO*',
      `Etiqueta: ${labelStatus}`,
    ].filter(Boolean).join('\n\n');

    let wahaResponse: unknown = null;
    let whatsappSendMode: 'file' | 'text_link' = 'file';
    try {
      wahaResponse = await sendWahaFile({
        chatId,
        caption,
        filename,
        mimetype: 'application/pdf',
        data: labelPdf,
      });
    } catch (err) {
      if (!isWahaPlusOnlyError(err)) throw err;
      if (!labelDownloadUrl) throw new Error('WAHA Core não envia arquivos e não foi possível gerar link da etiqueta.');
      whatsappSendMode = 'text_link';
      wahaResponse = await sendWahaText({
        chatId,
        text: caption,
      });
    }

    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: 'whatsapp_label_send_success',
      respostaMl: {
        dsid: dsid || null,
        ml_shipment_id: shipmentId,
        uploaded_invoice: uploadedInvoice,
        skipped_invoice_upload: skippedInvoiceUpload,
        label_source: labelSource,
        test_placeholder_label: Boolean(usePlaceholderLabel),
        whatsapp_send_mode: whatsappSendMode,
        label_download_url_generated: Boolean(labelDownloadUrl),
        label_bytes: labelPdf.length,
        label_attempts: labelAttempts,
        chat_id_suffix: chatId.slice(-8),
        waha_response: wahaResponse || null,
      },
      statusResultante: 'success',
    });

    return NextResponse.json({
      success: true,
      message: 'Etiqueta enviada por WhatsApp.',
      data: {
        dsid: dsid || null,
        shipmentId,
        uploadedInvoice,
        skippedInvoiceUpload,
        labelSource,
        whatsappSendMode,
        labelBytes: labelPdf.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao enviar etiqueta por WhatsApp' }, { status: 500 });
  }
}
