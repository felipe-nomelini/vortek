import { createServiceClient } from '@/lib/supabase';
import {
  baixarEtiquetaML,
  consultarInvoiceDataPorShipmentML,
  fetchML,
  upsertInvoiceDataMLByShipment,
} from '@/services/integration';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import {
  getWahaNewMessageId,
  normalizeWhatsappChatId,
  sendWahaFile,
  sendWahaText,
} from '@/services/waha';
import {
  downloadShippingLabelFromStorage,
  storeShippingLabelForPedido,
} from '@/lib/shipping-label-storage';
import {
  DSLITE_PLACEHOLDER_LABEL_FILE_NAME,
  loadDslitePlaceholderLabel,
} from '@/lib/dslite/placeholder-label';
import { buildPublicNfeUrl } from '@/lib/public-nfe-links';
import { buildPublicShippingLabelUrl } from '@/lib/public-shipping-label-links';
import { createShortLink } from '@/lib/short-links';
import { buildSupplierLabelWhatsapp } from '@/lib/notifications/templates';

const LABEL_RETRY_INTERVAL_MS = 5000;
const LABEL_WAIT_TIMEOUT_MS = 60000;

type StepStatus = 'pending' | 'loading' | 'success' | 'error' | 'warning';

type WhatsappLabelStep = {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  error?: string;
  updatedAt?: string;
};

type JobState = 'running' | 'success' | 'warning' | 'error' | 'on_hold';

export type WhatsappLabelJobRequest = {
  pedidoId: string;
  phoneNumber: string;
  usePlaceholderLabel?: boolean;
  appBaseUrl: string;
};

const WHATSAPP_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

const now = () => new Date().toISOString();

class WhatsappLabelDownloadError extends Error {
  retryable: boolean;
  reason: string | null;
  statusCode: number | null;

  constructor(params: {
    message: string;
    retryable: boolean;
    reason: string | null;
    statusCode: number | null;
  }) {
    super(params.message);
    this.name = 'WhatsappLabelDownloadError';
    this.retryable = params.retryable;
    this.reason = params.reason;
    this.statusCode = params.statusCode;
  }
}

function isDeliveredNonPrintableError(error: WhatsappLabelDownloadError): boolean {
  const message = error.message.toLowerCase();
  return !error.retryable
    && error.reason === 'http_error'
    && (
      message.includes('status is delivered')
      || message.includes('"status":"delivered"')
    );
}

export function parseWhatsappLabelJobLog(log: unknown): any[] {
  if (Array.isArray(log)) return log;
  if (typeof log !== 'string') return [];
  try {
    const parsed = JSON.parse(log || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getWhatsappLabelJobRequest(log: unknown): WhatsappLabelJobRequest | null {
  const entry = parseWhatsappLabelJobLog(log)
    .find((item: any) => item?.event === 'request_received');
  const payload = entry?.payload;
  if (!payload?.pedidoId || !payload?.phoneNumber || !payload?.appBaseUrl) return null;
  return {
    pedidoId: String(payload.pedidoId),
    phoneNumber: String(payload.phoneNumber),
    usePlaceholderLabel: Boolean(payload.usePlaceholderLabel),
    appBaseUrl: String(payload.appBaseUrl),
  };
}

export function getWhatsappLabelRetry(log: unknown) {
  const holds = parseWhatsappLabelJobLog(log)
    .filter((item: any) => item?.event === 'queue_hold');
  const latest = holds.length ? holds[holds.length - 1] : null;
  return {
    attempt: Number(latest?.retry_attempt || holds.length || 0),
    nextRetryAt: String(latest?.next_retry_at || '') || null,
  };
}

export function isWhatsappLabelJobDue(log: unknown, at = Date.now()): boolean {
  const { nextRetryAt } = getWhatsappLabelRetry(log);
  if (!nextRetryAt) return true;
  const dueAt = new Date(nextRetryAt).getTime();
  return !Number.isFinite(dueAt) || dueAt <= at;
}

function nextRetry(attempt: number) {
  const delay = WHATSAPP_RETRY_DELAYS_MS[
    Math.min(Math.max(attempt - 1, 0), WHATSAPP_RETRY_DELAYS_MS.length - 1)
  ];
  return new Date(Date.now() + delay).toISOString();
}

export function initWhatsappLabelJobSteps(): WhatsappLabelStep[] {
  return [
    { key: 'validate_input', label: 'Validando pedido e WhatsApp', status: 'loading', detail: 'Validando número de destino e pedido de venda', updatedAt: now() },
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

function extractXmlTag(xml: string | null | undefined, tag: string): string | null {
  const raw = String(xml || '');
  if (!raw) return null;
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return raw.match(new RegExp(`<${escaped}>([^<]+)</${escaped}>`))?.[1]?.trim() || null;
}

function extractFiscalKey(xml: string): string | null {
  return extractXmlTag(xml, 'chNFe');
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

function isWahaPlusOnlyError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '').toLowerCase();
  return message.includes('plus version') || message.includes('available only in plus');
}

async function resolveShipmentId(client: ReturnType<typeof createServiceClient>, pedido: any): Promise<string | null> {
  const existing = String(pedido?.ml_shipment_id || '').trim();
  if (existing) return existing;

  const mlOrderId = String(pedido?.ml_order_id || '').trim();
  if (!mlOrderId) return null;

  const shipment = await fetchML<any>(`/orders/${encodeURIComponent(mlOrderId)}/shipments`).catch(() => null);
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
  let lastRetryable = false;

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
    lastRetryable = Boolean(result.retryable);

    const canRetry = lastRetryable;
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

  throw new WhatsappLabelDownloadError({
    message: lastError || 'Etiqueta ainda indisponível no ML',
    retryable: lastRetryable,
    reason: lastReason,
    statusCode: lastStatusCode,
  });
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
  const invoiceAmount = parseInvoiceAmountFromXml(xml) || Number(pedido.total || 0);

  if (!fiscalKey || !invoiceNumber || !(invoiceAmount > 0)) {
    throw new Error('XML da NF sem chave, número ou valor para upload no ML');
  }

  if (mlFiscalKey === fiscalKey) {
    return { uploadedInvoice: false, invoiceNumber, skippedInvoiceUpload: true };
  }

  const upload = await upsertInvoiceDataMLByShipment({
    shipmentId,
    fiscalKey,
    nfeXml: xml,
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

function failPendingSteps(steps: WhatsappLabelStep[]) {
  for (const step of steps) {
    if (step.status === 'pending') {
      step.status = 'warning';
      step.detail = 'Não executada por encerramento antecipado';
      step.updatedAt = now();
    }
  }
}

export async function runWhatsappLabelJob(input: {
  jobId: string;
} & WhatsappLabelJobRequest) {
  const client = createServiceClient();
  const steps = initWhatsappLabelJobSteps();
  const { data: claimedJob, error: claimError } = await client
    .from('jobs')
    .update({ status: 'rodando' })
    .eq('id', input.jobId)
    .eq('tipo', 'whatsapp_label_send')
    .in('status', ['pendente', 'on_hold'])
    .select('id,log')
    .maybeSingle();

  if (claimError) throw new Error(`Falha ao assumir job de WhatsApp: ${claimError.message}`);
  if (!claimedJob?.id) return;

  const logEntries = parseWhatsappLabelJobLog(claimedJob.log);
  const priorRetry = getWhatsappLabelRetry(logEntries);
  if (priorRetry.attempt > 0) {
    logEntries.push({
      event: 'queue_retry_started',
      at: now(),
      retry_attempt: priorRetry.attempt,
    });
  }
  let state: JobState = 'running';
  let result: any = null;
  let pedidoIdForError: string | null = input.pedidoId;
  let mlOrderIdForError: string | null = null;

  const syncJob = async () => {
    const done = steps.filter((s) => s.status === 'success' || s.status === 'warning').length;
    const progress = Math.round((done / steps.length) * 100);
    logEntries.push({ event: 'progress_snapshot', at: now(), state, steps, result });

    const { error } = await client
      .from('jobs')
      .update({
        status: state === 'success'
          ? 'completo'
          : state === 'warning'
            ? 'completo_parcial'
            : state === 'error'
              ? 'erro'
              : state === 'on_hold'
                ? 'on_hold'
                : 'rodando',
        progresso: progress,
        total: steps.length,
        processados: done,
        log: JSON.parse(JSON.stringify(logEntries)),
        finished_at: state === 'running' || state === 'on_hold' ? null : now(),
      })
      .eq('id', input.jobId);
    if (error) throw new Error(`Falha ao atualizar job de WhatsApp: ${error.message}`);
  };

  const setStep = async (key: string, status: StepStatus, detail?: string, error?: string) => {
    const idx = steps.findIndex((step) => step.key === key);
    if (idx < 0) return;
    steps[idx] = { ...steps[idx], status, detail, error, updatedAt: now() };
    await syncJob();
  };

  try {
    await syncJob();
    const chatId = normalizeWhatsappChatId(String(input.phoneNumber || ''));
    await setStep('validate_input', 'success', `Destino normalizado: ${chatId.slice(-8)}`);

    const { data: pedido, error: pedidoError } = await client
      .from('pedidos')
      .select('id,numero,ml_order_id,ml_shipment_id,nfe_xml,nfe_chave,nota_fiscal_numero,total,nfe_cfop,dslite_id,billing_nome,contato_nome,ml_label_storage_path,ml_label_bytes,situacao')
      .eq('id', input.pedidoId)
      .maybeSingle();
    if (pedidoError) throw new Error(pedidoError.message);
    if (!pedido) throw new Error('Pedido de venda não encontrado');

    const pedidoId = String((pedido as any).id);
    const mlOrderId = String((pedido as any).ml_order_id || '').trim() || null;
    pedidoIdForError = pedidoId;
    mlOrderIdForError = mlOrderId;

    if ((pedido as any).situacao === 'concretizada_ml') {
      for (const step of steps) {
        if (step.status === 'pending' || step.status === 'loading') {
          step.status = 'warning';
          step.detail = 'Não aplicável: venda concretizada pelo Mercado Livre';
          step.updatedAt = now();
        }
      }
      result = {
        queued: false,
        queueStatus: 'not_applicable',
        reason: 'order_concretized_by_ml',
      };
      state = 'warning';
      await registrarEventoNfAuditoria({
        pedidoId,
        mlOrderId,
        evento: 'whatsapp_label_send_not_applicable',
        respostaMl: {
          job_id: input.jobId,
          queue_status: 'not_applicable',
          reason: 'order_concretized_by_ml',
        },
        statusResultante: 'not_applicable',
      });
      await syncJob();
      return;
    }

    await setStep('resolve_shipment', 'loading', 'Verificando ml_shipment_id no pedido');
    const shipmentId = await resolveShipmentId(client, pedido);
    if (!shipmentId) throw new Error('Pedido sem shipment ML para baixar etiqueta');
    await setStep('resolve_shipment', 'success', `Envio ML ${shipmentId}`);

    const dsid = String((pedido as any).dslite_id || '').trim();
    await setStep('load_purchase', 'loading', dsid ? `Buscando compra DSLite #${dsid}` : 'Pedido sem DSLite vinculado');
    const { data: compra } = dsid
      ? await client.from('compras').select('*').eq('dsid', dsid).maybeSingle()
      : { data: null };
    await setStep(
      'load_purchase',
      dsid ? (compra ? 'success' : 'warning') : 'warning',
      dsid ? (compra ? `Compra #${dsid} encontrada` : `Compra #${dsid} não encontrada localmente`) : 'Sem pedido DSLite vinculado',
    );

    await setStep('load_label', 'loading', input.usePlaceholderLabel ? 'Carregando etiqueta genérica de teste' : 'Procurando etiqueta já salva');
    let labelPdf = input.usePlaceholderLabel
      ? await loadDslitePlaceholderLabel()
      : await downloadShippingLabelFromStorage(client, (pedido as any).ml_label_storage_path);
    let labelSource: 'storage' | 'mercado_livre' | 'placeholder' = input.usePlaceholderLabel
      ? 'placeholder'
      : labelPdf ? 'storage' : 'mercado_livre';
    let labelAttempts = 0;
    let uploadedInvoice = false;
    let skippedInvoiceUpload = false;
    let invoiceNumber = String((pedido as any).nota_fiscal_numero || '').trim();
    const nfeKey = String((pedido as any).nfe_chave || '').trim();
    let labelDownloadUrl: string | null = null;
    let labelStoragePath = String((pedido as any).ml_label_storage_path || '').trim();
    await setStep(
      'load_label',
      labelPdf ? 'success' : 'warning',
      labelPdf
        ? (input.usePlaceholderLabel ? 'Etiqueta genérica carregada' : 'Etiqueta já estava salva no sistema')
        : 'Etiqueta ainda não salva; será necessário baixar no ML',
    );

    if (!labelPdf && !input.usePlaceholderLabel) {
      await setStep('upload_invoice_ml', 'loading', 'Consultando vínculo fiscal e enviando XML se necessário');
      const invoice = await ensureInvoiceDataIfNeeded({ pedido, pedidoId, mlOrderId, shipmentId });
      uploadedInvoice = invoice.uploadedInvoice;
      skippedInvoiceUpload = invoice.skippedInvoiceUpload;
      invoiceNumber = invoice.invoiceNumber || invoiceNumber;
      await setStep(
        'upload_invoice_ml',
        'success',
        skippedInvoiceUpload ? 'Etapa pulada: XML/NF já vinculado no ML' : 'XML da NF vinculado no Mercado Livre',
      );

      await setStep('download_label_ml', 'loading', 'Baixando PDF da etiqueta liberada no Mercado Livre');
      const label = await downloadLabelWithRetry(pedidoId, mlOrderId, shipmentId);
      labelPdf = label.pdf;
      labelAttempts = label.attempts;
      await setStep('download_label_ml', 'success', `Etiqueta baixada após ${labelAttempts} tentativa(s)`);

      await setStep('store_label', 'loading', 'Salvando PDF no bucket de etiquetas');
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
      await setStep('store_label', 'success', 'Etiqueta salva no sistema');
    } else {
      await setStep('upload_invoice_ml', 'warning', input.usePlaceholderLabel ? 'Pulada: envio de teste com etiqueta genérica' : 'Pulada: etiqueta já salva');
      await setStep('download_label_ml', 'warning', input.usePlaceholderLabel ? 'Pulada: envio de teste' : 'Pulada: usando etiqueta salva');
      await setStep('store_label', 'warning', input.usePlaceholderLabel ? 'Pulada: etiqueta genérica não é salva como etiqueta ML' : 'Pulada: arquivo já salvo');
    }

    if (!labelPdf) throw new Error('Etiqueta não encontrada ou indisponível');

    await setStep('build_links', 'loading', 'Criando links curtos públicos para WhatsApp');
    if (input.usePlaceholderLabel) {
      labelDownloadUrl = `${input.appBaseUrl}/dslite/labels/etiqueta-frete-terceiros-posterior.pdf`;
    } else if (labelStoragePath) {
      labelDownloadUrl = buildPublicShippingLabelUrl(input.appBaseUrl, pedidoId);
    }

    const filename = input.usePlaceholderLabel
      ? DSLITE_PLACEHOLDER_LABEL_FILE_NAME
      : `etiqueta_ml_${String((pedido as any).numero || mlOrderId || shipmentId)}.pdf`;
    const valorCompra = formatCurrencyBRL((compra as any)?.valor_total);
    const danfeUrlRaw = invoiceNumber ? buildPublicNfeUrl(input.appBaseUrl, pedidoId, 'danfe') : null;
    const xmlUrlRaw = nfeKey ? buildPublicNfeUrl(input.appBaseUrl, pedidoId, 'xml') : null;
    const labelShortUrl = await createShortLink({
      client,
      baseUrl: input.appBaseUrl,
      targetUrl: labelDownloadUrl,
      purpose: 'ml_label',
      metadata: { pedidoId, mlOrderId, shipmentId },
    });
    const danfeUrl = await createShortLink({
      client,
      baseUrl: input.appBaseUrl,
      targetUrl: danfeUrlRaw,
      purpose: 'danfe',
      metadata: { pedidoId, mlOrderId, invoiceNumber },
    });
    const xmlUrl = await createShortLink({
      client,
      baseUrl: input.appBaseUrl,
      targetUrl: xmlUrlRaw,
      purpose: 'xml',
      metadata: { pedidoId, mlOrderId, nfeKey },
    });
    await setStep('build_links', 'success', 'Links públicos gerados');

    const labelStatus = labelSource === 'storage'
      ? 'Arquivo salvo no Bentevi'
      : labelSource === 'placeholder'
        ? 'Amostra de homologação'
        : 'Mercado Livre';
    const caption = buildSupplierLabelWhatsapp({
      dsliteId: dsid,
      labelUrl: labelShortUrl,
      invoiceNumber,
      nfeKey,
      danfeUrl,
      xmlUrl,
      mlOrderId: (pedido as any).numero,
      shipmentId,
      product: (compra as any)?.produto_descricao,
      quantity: (compra as any)?.quantidade,
      purchaseAmount: valorCompra,
      labelSource: labelStatus,
    });

    let wahaResponse: unknown = null;
    let whatsappSendMode: 'file' | 'text_link' = 'file';
    let messageId = String(
      [...logEntries].reverse().find((entry: any) => entry?.event === 'whatsapp_message_id_allocated')?.message_id || '',
    ).trim();
    if (!messageId) {
      messageId = await getWahaNewMessageId();
      logEntries.push({ event: 'whatsapp_message_id_allocated', at: now(), message_id: messageId });
      await syncJob();
    }
    await setStep('send_whatsapp', 'loading', 'Enviando PDF pelo WAHA');
    try {
      wahaResponse = await sendWahaFile({
        chatId,
        caption,
        filename,
        mimetype: 'application/pdf',
        data: labelPdf,
        messageId,
      });
    } catch (err) {
      if (!isWahaPlusOnlyError(err)) throw err;
      if (!labelShortUrl) throw new Error('WAHA Core não envia arquivos e não foi possível gerar link da etiqueta.');
      whatsappSendMode = 'text_link';
      await setStep('send_whatsapp', 'loading', 'WAHA Core não envia arquivo; enviando mensagem com link');
      wahaResponse = await sendWahaText({ chatId, text: caption, messageId });
    }
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId,
      evento: 'whatsapp_label_send_success',
      respostaMl: {
        job_id: input.jobId,
        dsid: dsid || null,
        ml_shipment_id: shipmentId,
        uploaded_invoice: uploadedInvoice,
        skipped_invoice_upload: skippedInvoiceUpload,
        label_source: labelSource,
        test_placeholder_label: Boolean(input.usePlaceholderLabel),
        whatsapp_send_mode: whatsappSendMode,
        whatsapp_message_id: messageId,
        label_download_url_generated: Boolean(labelDownloadUrl),
        label_bytes: labelPdf.length,
        label_attempts: labelAttempts,
        chat_id_suffix: chatId.slice(-8),
        waha_response: wahaResponse || null,
      },
      statusResultante: 'success',
    });

    await setStep('send_whatsapp', 'success', whatsappSendMode === 'file' ? 'Mensagem com PDF enviada' : 'Mensagem com link enviada');

    if (!input.usePlaceholderLabel) {
      const { error: pedidoUpdateError } = await client
        .from('pedidos')
        .update({
          ml_label_storage_path: labelStoragePath || undefined,
          ml_label_bytes: labelPdf.length,
        } as any)
        .eq('id', pedidoId);
      if (pedidoUpdateError) throw new Error(`Mensagem enviada, mas falhou ao salvar a etiqueta no pedido: ${pedidoUpdateError.message}`);
    }

    result = {
      dsid: dsid || null,
      shipmentId,
      uploadedInvoice,
      skippedInvoiceUpload,
      labelSource,
      whatsappSendMode,
      labelBytes: labelPdf.length,
      message: 'Etiqueta enviada por WhatsApp.',
    };
    state = 'success';
    await syncJob();
  } catch (err: any) {
    const message = err?.message || 'Erro ao enviar etiqueta por WhatsApp';
    const loadingIdx = steps.findIndex((step) => step.status === 'loading');
    const pendingIdx = steps.findIndex((step) => step.status === 'pending');
    const idx = loadingIdx >= 0 ? loadingIdx : pendingIdx;
    const terminalDownloadError =
      err instanceof WhatsappLabelDownloadError && !err.retryable;
    const deliveredNonPrintable =
      terminalDownloadError && isDeliveredNonPrintableError(err);

    if (idx >= 0) {
      steps[idx] = {
        ...steps[idx],
        status: deliveredNonPrintable ? 'warning' : 'error',
        ...(deliveredNonPrintable
          ? { detail: 'Envio já entregue; etiqueta não pode mais ser reemitida pelo Mercado Livre' }
          : { error: message }),
        updatedAt: now(),
      };
    }
    failPendingSteps(steps);

    if (terminalDownloadError) {
      if (deliveredNonPrintable && pedidoIdForError) {
        await client
          .from('pedidos')
          .update({ situacao: 'entregue' } as any)
          .eq('id', pedidoIdForError);
      }

      result = {
        error: message,
        queued: false,
        queueStatus: deliveredNonPrintable ? 'not_applicable' : 'failed',
        reason: deliveredNonPrintable
          ? 'shipment_delivered'
          : err.reason || 'non_retryable_ml_label_error',
      };
      state = deliveredNonPrintable ? 'warning' : 'error';
      await registrarEventoNfAuditoria({
        pedidoId: pedidoIdForError || undefined,
        mlOrderId: mlOrderIdForError,
        evento: deliveredNonPrintable
          ? 'whatsapp_label_send_not_applicable'
          : 'whatsapp_label_send_failed',
        respostaMl: {
          job_id: input.jobId,
          error: message,
          steps,
          queue_status: result.queueStatus,
          retryable: false,
          reason: result.reason,
          status_http: err.statusCode,
        },
        statusResultante: deliveredNonPrintable ? 'not_applicable' : 'failed',
      }).catch(() => undefined);
      await syncJob().catch((syncError: any) => {
        console.error('[whatsapp-label-job] Falha ao registrar encerramento terminal:', syncError?.message || syncError);
      });
      return;
    }

    const retryAttempt = priorRetry.attempt + 1;
    const nextRetryAt = nextRetry(retryAttempt);
    logEntries.push({
      event: 'queue_hold',
      at: now(),
      retry_attempt: retryAttempt,
      next_retry_at: nextRetryAt,
      error: message,
    });
    result = {
      error: message,
      queued: true,
      queueStatus: 'on_hold',
      retryAttempt,
      nextRetryAt,
    };
    state = 'on_hold';
    await registrarEventoNfAuditoria({
      pedidoId: pedidoIdForError || undefined,
      mlOrderId: mlOrderIdForError,
      evento: 'whatsapp_label_send_failed',
      respostaMl: {
        job_id: input.jobId,
        error: message,
        steps,
        queue_status: 'on_hold',
        retry_attempt: retryAttempt,
        next_retry_at: nextRetryAt,
      },
      statusResultante: 'on_hold',
    }).catch(() => undefined);
    await syncJob().catch((syncError: any) => {
      console.error('[whatsapp-label-job] Falha ao registrar encerramento:', syncError?.message || syncError);
    });
  }
}
