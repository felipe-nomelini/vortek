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
  downloadShippingLabelFromStorage,
  storeShippingLabelForPedido,
} from '@/lib/shipping-label-storage';
import { DSLITE_PLACEHOLDER_LABEL_FILE_NAME, loadDslitePlaceholderLabel } from '@/lib/dslite/placeholder-label';
import { buildPublicNfeUrl } from '@/lib/public-nfe-links';
import { buildPublicShippingLabelUrl } from '@/lib/public-shipping-label-links';
import { createShortLink } from '@/lib/short-links';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 90;

const LABEL_RETRY_INTERVAL_MS = 5000;
const LABEL_WAIT_TIMEOUT_MS = 60000;

type WhatsappLabelStepStatus = 'pending' | 'loading' | 'success' | 'error' | 'warning';

type WhatsappLabelStep = {
  key: string;
  label: string;
  status: WhatsappLabelStepStatus;
  detail?: string;
  error?: string;
};

function initWhatsappLabelSteps(): WhatsappLabelStep[] {
  return [
    { key: 'validate_input', label: 'Validando pedido e WhatsApp', status: 'pending' },
    { key: 'resolve_shipment', label: 'Localizando envio Mercado Livre', status: 'pending' },
    { key: 'load_purchase', label: 'Buscando pedido de compra vinculado', status: 'pending' },
    { key: 'load_label', label: 'Localizando etiqueta salva', status: 'pending' },
    { key: 'upload_invoice_ml', label: 'Vinculando XML da NF no Mercado Livre', status: 'pending' },
    { key: 'download_label_ml', label: 'Baixando etiqueta do Mercado Livre', status: 'pending' },
    { key: 'store_label', label: 'Salvando etiqueta no sistema', status: 'pending' },
    { key: 'build_links', label: 'Gerando links públicos da etiqueta e NF', status: 'pending' },
    { key: 'send_whatsapp', label: 'Enviando mensagem pelo WhatsApp', status: 'pending' },
  ];
}

function updateStep(
  steps: WhatsappLabelStep[],
  key: string,
  status: WhatsappLabelStepStatus,
  detail?: string,
  error?: string,
) {
  const idx = steps.findIndex((step) => step.key === key);
  if (idx < 0) return;
  steps[idx] = { ...steps[idx], status, detail, error };
}

function failPendingSteps(steps: WhatsappLabelStep[]) {
  for (const step of steps) {
    if (step.status === 'pending') {
      step.status = 'warning';
      step.detail = 'Não executada por encerramento antecipado';
    }
  }
}

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
  const steps = initWhatsappLabelSteps();
  let pedidoIdForError: string | null = null;
  let mlOrderIdForError: string | null = null;
  try {
    updateStep(steps, 'validate_input', 'loading', 'Validando número de destino e pedido de venda');
    const { phoneNumber, usePlaceholderLabel } = await request.json().catch(() => ({}));
    const chatId = normalizeWhatsappChatId(String(phoneNumber || ''));
    updateStep(steps, 'validate_input', 'success', `Destino normalizado: ${chatId.slice(-8)}`);
    const client = createServiceClient();

    const { data: pedido, error: pedidoError } = await client
      .from('pedidos')
      .select('id,numero,ml_order_id,ml_shipment_id,nfe_xml,nfe_chave,nota_fiscal_numero,total,nfe_cfop,dslite_id,billing_nome,contato_nome,ml_label_storage_path,ml_label_bytes')
      .eq('id', params.id)
      .maybeSingle();
    if (pedidoError) {
      updateStep(steps, 'validate_input', 'error', undefined, pedidoError.message);
      failPendingSteps(steps);
      return NextResponse.json({ error: pedidoError.message, steps }, { status: 500 });
    }
    if (!pedido) {
      updateStep(steps, 'validate_input', 'error', undefined, 'Pedido de venda não encontrado');
      failPendingSteps(steps);
      return NextResponse.json({ error: 'Pedido de venda não encontrado', steps }, { status: 404 });
    }

    const pedidoId = String((pedido as any).id);
    const mlOrderId = String((pedido as any).ml_order_id || '').trim() || null;
    pedidoIdForError = pedidoId;
    mlOrderIdForError = mlOrderId;

    updateStep(steps, 'resolve_shipment', 'loading', 'Verificando ml_shipment_id no pedido');
    const shipmentId = await resolveShipmentId(client, pedido);
    if (!shipmentId) {
      updateStep(steps, 'resolve_shipment', 'error', undefined, 'Pedido sem shipment ML para baixar etiqueta');
      failPendingSteps(steps);
      return NextResponse.json({ error: 'Pedido sem shipment ML para baixar etiqueta', steps }, { status: 422 });
    }
    updateStep(steps, 'resolve_shipment', 'success', `Envio ML ${shipmentId}`);

    const dsid = String((pedido as any).dslite_id || '').trim();
    updateStep(steps, 'load_purchase', 'loading', dsid ? `Buscando compra DSLite #${dsid}` : 'Pedido sem DSLite vinculado');
    const { data: compra } = dsid
      ? await client.from('compras').select('*').eq('dsid', dsid).maybeSingle()
      : { data: null };
    updateStep(
      steps,
      'load_purchase',
      dsid ? (compra ? 'success' : 'warning') : 'warning',
      dsid ? (compra ? `Compra #${dsid} encontrada` : `Compra #${dsid} não encontrada localmente`) : 'Sem pedido DSLite vinculado',
    );

    updateStep(steps, 'load_label', 'loading', usePlaceholderLabel ? 'Carregando etiqueta genérica de teste' : 'Procurando etiqueta já salva');
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
    let labelStoragePath = String((pedido as any).ml_label_storage_path || '').trim();
    updateStep(
      steps,
      'load_label',
      labelPdf ? 'success' : 'warning',
      labelPdf
        ? (usePlaceholderLabel ? 'Etiqueta genérica carregada' : 'Etiqueta já estava salva no sistema')
        : 'Etiqueta ainda não salva; será necessário baixar no ML',
    );

    if (!labelPdf && !usePlaceholderLabel) {
      updateStep(steps, 'upload_invoice_ml', 'loading', 'Consultando vínculo fiscal e enviando XML se necessário');
      const invoice = await ensureInvoiceDataIfNeeded({ pedido, pedidoId, mlOrderId, shipmentId });
      uploadedInvoice = invoice.uploadedInvoice;
      skippedInvoiceUpload = invoice.skippedInvoiceUpload;
      invoiceNumber = invoice.invoiceNumber || invoiceNumber;
      updateStep(
        steps,
        'upload_invoice_ml',
        'success',
        skippedInvoiceUpload ? 'Etapa pulada: XML/NF já vinculado no ML' : 'XML da NF vinculado no Mercado Livre',
      );

      updateStep(steps, 'download_label_ml', 'loading', 'Baixando PDF da etiqueta liberada no Mercado Livre');
      const label = await downloadLabelWithRetry(pedidoId, mlOrderId, shipmentId);
      labelPdf = label.pdf;
      labelAttempts = label.attempts;
      updateStep(steps, 'download_label_ml', 'success', `Etiqueta baixada após ${labelAttempts} tentativa(s)`);
      updateStep(steps, 'store_label', 'loading', 'Salvando PDF no bucket de etiquetas');
      const stored = await storeShippingLabelForPedido({
        client,
        pedidoId,
        pedidoNumero: (pedido as any).numero,
        mlOrderId,
        shipmentId,
        pdf: label.pdf,
        source: 'pedidos_whatsapp',
      });
      labelStoragePath = stored.storagePath || labelStoragePath;
      updateStep(steps, 'store_label', 'success', 'Etiqueta salva no sistema');
    } else {
      updateStep(steps, 'upload_invoice_ml', 'warning', usePlaceholderLabel ? 'Pulada: envio de teste com etiqueta genérica' : 'Pulada: etiqueta já salva');
      updateStep(steps, 'download_label_ml', 'warning', usePlaceholderLabel ? 'Pulada: envio de teste' : 'Pulada: usando etiqueta salva');
      updateStep(steps, 'store_label', 'warning', usePlaceholderLabel ? 'Pulada: etiqueta genérica não é salva como etiqueta ML' : 'Pulada: arquivo já salvo');
    }

    if (!labelPdf) {
      updateStep(steps, 'download_label_ml', 'error', undefined, 'Etiqueta não encontrada ou indisponível');
      failPendingSteps(steps);
      return NextResponse.json({ error: 'Etiqueta não encontrada ou indisponível', steps }, { status: 422 });
    }

    updateStep(steps, 'build_links', 'loading', 'Criando links curtos públicos para WhatsApp');
    const appBaseUrl = resolveAppBaseUrl(request);
    if (usePlaceholderLabel) {
      labelDownloadUrl = `${appBaseUrl}/dslite/labels/etiqueta-frete-terceiros-posterior.pdf`;
    } else if (labelStoragePath) {
      labelDownloadUrl = buildPublicShippingLabelUrl(appBaseUrl, pedidoId);
    }

    const filename = usePlaceholderLabel
      ? DSLITE_PLACEHOLDER_LABEL_FILE_NAME
      : `etiqueta_ml_${String((pedido as any).numero || mlOrderId || shipmentId)}.pdf`;
    const valorCompra = formatCurrencyBRL((compra as any)?.valor_total);
    const danfeUrlRaw = invoiceNumber ? buildPublicNfeUrl(appBaseUrl, pedidoId, 'danfe') : null;
    const xmlUrlRaw = nfeKey ? buildPublicNfeUrl(appBaseUrl, pedidoId, 'xml') : null;
    const labelShortUrl = await createShortLink({
      client,
      baseUrl: appBaseUrl,
      targetUrl: labelDownloadUrl,
      purpose: 'ml_label',
      metadata: { pedidoId, mlOrderId, shipmentId },
    });
    const danfeUrl = await createShortLink({
      client,
      baseUrl: appBaseUrl,
      targetUrl: danfeUrlRaw,
      purpose: 'danfe',
      metadata: { pedidoId, mlOrderId, invoiceNumber },
    });
    const xmlUrl = await createShortLink({
      client,
      baseUrl: appBaseUrl,
      targetUrl: xmlUrlRaw,
      purpose: 'xml',
      metadata: { pedidoId, mlOrderId, nfeKey },
    });
    updateStep(steps, 'build_links', 'success', 'Links públicos gerados');
    const fornecedorNome = limitText((compra as any)?.fornecedor_nome, 80);
    const clienteNome = limitText((pedido as any).billing_nome || (pedido as any).contato_nome, 80);
    const labelStatus = labelSource === 'storage'
      ? 'arquivo ja salvo no sistema'
      : labelSource === 'placeholder'
        ? 'generica para teste'
        : 'baixada do Mercado Livre';
    const pedidoCompraLabel = dsid ? `#${dsid}` : 'sem pedido DSLite vinculado';
    const caption = [
      '*Etiqueta Liberada!*',
      `A etiqueta do pedido *${pedidoCompraLabel}* foi liberada e está no link abaixo:`,
      labelShortUrl,
      '------------------------',
      '*DADOS DA NOTA*',
      invoiceNumber ? `NF: ${invoiceNumber}` : null,
      nfeKey ? `Chave: ${nfeKey}` : null,
      danfeUrl ? `DANFE: ${danfeUrl}` : null,
      xmlUrl ? `XML: ${xmlUrl}` : null,
      '------------------------',
      '*PEDIDO DE COMPRA*',
      dsid ? `DSLite: #${dsid}` : 'DSLite: nao vinculado',
      fornecedorNome ? `Fornecedor: ${fornecedorNome}` : null,
      valorCompra ? `Valor compra: ${valorCompra}` : null,
      '------------------------',
      '*PEDIDO DE VENDA*',
      `Venda ML: #${(pedido as any).numero}`,
      `Envio ML: ${shipmentId}`,
      clienteNome ? `Cliente: ${clienteNome}` : null,
      (compra as any)?.quantidade ? `Quantidade: ${(compra as any).quantidade}` : null,
      `Origem da etiqueta: ${labelStatus}`,
    ].filter(Boolean).join('\n\n');

    let wahaResponse: unknown = null;
    let whatsappSendMode: 'file' | 'text_link' = 'file';
    updateStep(steps, 'send_whatsapp', 'loading', 'Enviando PDF pelo WAHA');
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
      if (!labelShortUrl) throw new Error('WAHA Core não envia arquivos e não foi possível gerar link da etiqueta.');
      whatsappSendMode = 'text_link';
      updateStep(steps, 'send_whatsapp', 'loading', 'WAHA Core não envia arquivo; enviando mensagem com link');
      wahaResponse = await sendWahaText({
        chatId,
        text: caption,
      });
    }
    updateStep(
      steps,
      'send_whatsapp',
      'success',
      whatsappSendMode === 'file' ? 'Mensagem com PDF enviada' : 'Mensagem com link enviada',
    );

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
        steps,
      },
    });
  } catch (err: any) {
    const message = err?.message || 'Erro ao enviar etiqueta por WhatsApp';
    const loadingIdx = steps.findIndex((step) => step.status === 'loading');
    const pendingIdx = steps.findIndex((step) => step.status === 'pending');
    const idx = loadingIdx >= 0 ? loadingIdx : pendingIdx;
    if (idx >= 0) {
      steps[idx] = { ...steps[idx], status: 'error', error: message };
    }
    failPendingSteps(steps);
    if (pedidoIdForError || mlOrderIdForError) {
      await registrarEventoNfAuditoria({
        pedidoId: pedidoIdForError || undefined,
        mlOrderId: mlOrderIdForError,
        evento: 'whatsapp_label_send_failed',
        respostaMl: { error: message, steps },
        statusResultante: 'failed',
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: message, steps }, { status: 500 });
  }
}
