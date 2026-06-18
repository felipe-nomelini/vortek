import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  baixarEtiquetaML,
  consultarInvoiceDataPorShipmentML,
  upsertInvoiceDataMLByShipment,
} from '@/services/integration';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { normalizeWhatsappChatId, sendWahaFile } from '@/services/waha';

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

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { phoneNumber } = await request.json().catch(() => ({}));
    const chatId = normalizeWhatsappChatId(String(phoneNumber || process.env.WAHA_TEST_RECIPIENT_PHONE || ''));
    const client = createServiceClient();

    const { data: compra, error: compraError } = await client
      .from('compras')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();
    if (compraError) return NextResponse.json({ error: compraError.message }, { status: 500 });
    if (!compra) return NextResponse.json({ error: 'Compra não encontrada' }, { status: 404 });

    const fornecedorNome = String((compra as any).fornecedor_nome || '').toLowerCase();
    if (!fornecedorNome.includes('hayamax')) {
      return NextResponse.json({ error: 'Ação permitida apenas para pedidos Hayamax' }, { status: 422 });
    }

    const dsid = String((compra as any).dsid || '').trim();
    const { data: pedido, error: pedidoError } = await client
      .from('pedidos')
      .select('id,numero,ml_order_id,ml_shipment_id,nfe_xml,nfe_chave,nota_fiscal_numero,total,nfe_cfop,dslite_id')
      .eq('dslite_id', dsid)
      .maybeSingle();
    if (pedidoError) return NextResponse.json({ error: pedidoError.message }, { status: 500 });
    if (!pedido) return NextResponse.json({ error: 'Pedido de venda vinculado à compra não encontrado' }, { status: 404 });

    const pedidoId = String((pedido as any).id);
    const mlOrderId = String((pedido as any).ml_order_id || '').trim() || null;
    const shipmentId = await resolveShipmentId(client, pedido);
    if (!shipmentId) return NextResponse.json({ error: 'Pedido sem shipment ML para baixar etiqueta' }, { status: 422 });

    const xml = String((pedido as any).nfe_xml || '').trim();
    if (!xml) return NextResponse.json({ error: 'Pedido sem XML da NF para liberar etiqueta no ML' }, { status: 422 });

    const fiscalKey = String((pedido as any).nfe_chave || '').trim() || extractFiscalKey(xml);
    const invoiceNumber = extractXmlTag(xml, 'nNF') || String((pedido as any).nota_fiscal_numero || '').trim();
    const invoiceSerie = extractXmlTag(xml, 'serie') || '1';
    const invoiceDate = parseInvoiceDateFromXml(xml) || new Date().toISOString();
    const invoiceAmount = parseInvoiceAmountFromXml(xml) || Number((pedido as any).total || 0);
    const cfop = extractXmlTag(xml, 'CFOP') || String((pedido as any).nfe_cfop || '').trim() || undefined;

    if (!fiscalKey || !invoiceNumber || !(invoiceAmount > 0)) {
      return NextResponse.json({ error: 'XML da NF sem chave, número ou valor para upload no ML' }, { status: 422 });
    }

    const invoiceData = await consultarInvoiceDataPorShipmentML(shipmentId, 'MLB');
    const mlFiscalKey = invoiceData.ok ? String(invoiceData.data?.fiscal_key || '').trim() : '';
    let uploadedInvoice = false;

    if (mlFiscalKey !== fiscalKey) {
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

      if (!upload.ok) {
        return NextResponse.json({ error: upload.error || 'Falha ao subir XML da NF no ML' }, { status: 502 });
      }
      uploadedInvoice = true;
    }

    const label = await downloadLabelWithRetry(pedidoId, mlOrderId, shipmentId);
    const filename = `etiqueta_ml_${String((pedido as any).numero || mlOrderId || shipmentId)}.pdf`;
    const caption = [
      `Etiqueta ML - pedido de compra #${dsid}`,
      mlOrderId ? `Pedido ML: ${mlOrderId}` : null,
      `Shipment: ${shipmentId}`,
    ].filter(Boolean).join('\n');

    const wahaResponse = await sendWahaFile({
      chatId,
      caption,
      filename,
      mimetype: 'application/pdf',
      data: label.pdf,
    });

    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: 'whatsapp_label_send_success',
      respostaMl: {
        dsid,
        ml_shipment_id: shipmentId,
        uploaded_invoice: uploadedInvoice,
        label_bytes: label.pdf.length,
        label_attempts: label.attempts,
        chat_id_suffix: chatId.slice(-8),
        waha_response: wahaResponse || null,
      },
      statusResultante: 'success',
    });

    return NextResponse.json({
      success: true,
      message: 'Etiqueta enviada por WhatsApp.',
      data: {
        dsid,
        shipmentId,
        uploadedInvoice,
        labelBytes: label.pdf.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao enviar etiqueta por WhatsApp' }, { status: 500 });
  }
}
