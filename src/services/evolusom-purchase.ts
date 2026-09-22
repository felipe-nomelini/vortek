import { createServiceClient } from '@/lib/supabase';
import { buildPublicNfeUrl } from '@/lib/public-nfe-links';
import { createShortLink } from '@/lib/short-links';
import { buildPublicShippingLabelUrl } from '@/lib/public-shipping-label-links';
import { storeShippingLabelForPedido } from '@/lib/shipping-label-storage';
import { isMlShipmentLabelPrintable } from '@/lib/ml/fiscal-release';
import { baixarEtiquetaML, fetchML } from '@/services/integration';
import { evolusomRequest, EvolusomApiError } from '@/services/evolusom';
import { DSLITE_EVOLUSOM_PLACEHOLDER_LABEL_SOURCE } from '@/lib/dslite/placeholder-label';

const EVOLUSOM_SUPPLIER_ID = '133';
const EVOLUSOM_PLACEHOLDER_TRACKING_NUMBER = '99999999999';

type ProductLine = { sku: string; invoiceSku?: string; quantity: number; cost: number; offerId: string | null };
type CreateResult =
  | { state: 'created'; orderId: number; purchaseId: string; status: string; placeholder: boolean; apiResponse?: unknown }
  | { state: 'pending'; reason: string; apiResponse?: unknown }
  | { state: 'uncertain'; reason: string; apiResponse?: unknown };

function tag(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<\\/${name}>`, 'i'))?.[1]?.trim() || '';
}

function block(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '';
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
}

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) throw new Error('CNPJ da empresa inválido para Evolusom');
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatPhone(value: unknown): string | null {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return null;
}

function formatEmail(value: unknown): string | null {
  const email = String(value || '').trim();
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

function formatOrderDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Data de criação da compra Evolusom inválida');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function readEvolusomOrderId(response: {
  codigo?: number;
  data?: { codigo?: number; numero?: number; pedido_lojista?: { numero?: number } };
}): number {
  return Number(response.codigo ?? response.data?.codigo ?? response.data?.numero ?? response.data?.pedido_lojista?.numero);
}

function readEmbeddedErrorStatus(response: { status?: string | number }): number | null {
  const status = Number(response.status);
  return Number.isInteger(status) && status >= 400 ? status : null;
}

function isRetryableEvolusomErrorStatus(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

function isDefinitiveEvolusomRejection(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500 && status !== 429;
}

function appOrigin(): string {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || process.env.INTERNAL_APP_URL || '').trim();
  const url = new URL(configured || 'https://app.bentevi.shop');
  if (url.protocol !== 'https:' || url.hostname !== 'app.bentevi.shop') {
    throw new Error('Domínio público Bentevi inválido para documentos Evolusom');
  }
  return url.origin;
}

export function buildEvolusomTriangularPayload(input: {
  orderCode: number;
  orderedAt: string;
  companyCnpj: string;
  xml: string;
  email: string | null;
  phone: string | null;
  trackingNumber: string;
  labelUrl: string;
  danfeUrl: string;
  products: ProductLine[];
}) {
  const dest = block(input.xml, 'dest');
  const address = block(dest, 'enderDest');
  const ide = block(input.xml, 'ide');
  const total = block(input.xml, 'ICMSTot');
  const key = tag(input.xml, 'chNFe');
  const issuedAt = tag(ide, 'dhEmi') || tag(ide, 'dEmi');
  const invoiceValue = money(tag(total, 'vNF'));
  const addressDto = {
    bairro: tag(address, 'xBairro'),
    cep: tag(address, 'CEP').replace(/\D/g, ''),
    cidade: tag(address, 'xMun'),
    complemento: tag(address, 'xCpl') || null,
    endereco: tag(address, 'xLgr'),
    numero: tag(address, 'nro'),
    uf: tag(address, 'UF'),
  };
  const missing = [
    ['CNPJ', input.companyCnpj], ['chave NF-e', key], ['número NF-e', tag(ide, 'nNF')],
    ['série NF-e', tag(ide, 'serie')], ['nome comprador', tag(dest, 'xNome')],
    ['documento comprador', tag(dest, 'CPF') || tag(dest, 'CNPJ')],
    ['rastreio', input.trackingNumber], ['etiqueta', input.labelUrl],
    ['valor NF-e', invoiceValue > 0 ? invoiceValue : ''],
    ['emissão NF-e', issuedAt],
    ['logradouro', addressDto.endereco], ['número', addressDto.numero],
    ['bairro', addressDto.bairro], ['CEP', addressDto.cep],
    ['cidade', addressDto.cidade], ['UF', addressDto.uf],
  ].filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
  if (missing.length) throw new Error(`Pedido Evolusom pendente: ${missing.join(', ')}`);
  if (addressDto.cep.length !== 8 || !/^\d{11}(?:\d{3})?$/.test(tag(dest, 'CPF') || tag(dest, 'CNPJ'))
    || input.trackingNumber.length > 100 || (input.email !== null && !/^\S+@\S+\.\S+$/.test(input.email))) {
    throw new Error('Pedido Evolusom com CEP, documento, email ou rastreio inválido');
  }

  const invoiceItems = Array.from(input.xml.matchAll(/<det\b[^>]*>([\s\S]*?)<\/det>/gi)).map((match) => {
    const prod = block(match[1], 'prod');
    const tax = block(match[1], 'imposto');
    return {
      sku: tag(prod, 'cProd'),
      saleUnitPrice: Number(tag(prod, 'vUnCom')),
      st: money(tag(tax, 'vST')),
      ipi: money(tag(tax, 'vIPI')),
    };
  });
  const items = input.products.map((product) => {
    const invoice = invoiceItems.find((item) => item.sku === (product.invoiceSku || product.sku));
    if (!invoice || !Number.isFinite(invoice.saleUnitPrice) || invoice.saleUnitPrice <= 0 || product.cost <= 0) {
      throw new Error(`Item Evolusom sem valor fiscal/custo válido: ${product.sku}`);
    }
    return {
      cod_produto: product.sku,
      quantidade: product.quantity,
      preco_revenda: money(product.cost),
      preco_cliente_final: money(invoice.saleUnitPrice),
      st: invoice.st,
      ipi: invoice.ipi,
    };
  });
  if (!items.length) throw new Error('Pedido Evolusom sem itens');

  const dateTime = (value: string) => value.replace('T', ' ').replace(/(?:Z|[+-]\d\d:\d\d)$/, '').slice(0, 19);
  return {
    codigo_pedido: input.orderCode,
    cnpj: input.companyCnpj,
    data_pedido: formatOrderDate(input.orderedAt),
    nfe: {
      url: input.danfeUrl,
      serie: tag(ide, 'serie'),
      numero: tag(ide, 'nNF'),
      chave: key,
      data_emissao: dateTime(issuedAt),
      valor: invoiceValue,
    },
    transporte: { tipo: 0, codrastreio: input.trackingNumber, urletiqueta: input.labelUrl },
    cliente: {
      nome: tag(dest, 'xNome'),
      documento: tag(dest, 'CPF') || tag(dest, 'CNPJ'),
      email: input.email,
      telefone: input.phone,
      celular: input.phone,
      inscricao_estadual: tag(dest, 'IE') || null,
      endereco_entrega: addressDto,
      endereco_cobranca: addressDto,
    },
    itens: items,
  };
}

/** Um único POST por código. Resultado desconhecido exige conferência manual antes de nova tentativa. */
export async function createEvolusomPurchase(input: {
  pedidoId: string;
  orderIds: string[];
  xml: string;
  products: ProductLine[];
  supplierPaymentMode: string;
}): Promise<CreateResult> {
  if (process.env.EVOLUSOM_DIRECT_ENABLED !== 'true') {
    return { state: 'pending', reason: 'Integração direta Evolusom desabilitada' };
  }
  const client = createServiceClient();
  const [{ data: order, error: orderError }, { data: company, error: companyError }] = await Promise.all([
    client.from('pedidos').select('id,numero,ml_order_id,ml_shipment_id,rastreio,ml_label_storage_path,dslite_label_source,billing_documento,buyer_ml_id').eq('id', input.pedidoId).maybeSingle(),
    client.from('empresa').select('cnpj').limit(1).maybeSingle(),
  ]);
  if (orderError || companyError || !order || !company?.cnpj) throw new Error('Dados do pedido ou CNPJ não disponíveis para Evolusom');
  const buyerMlId = String(order.buyer_ml_id || '').trim();
  const buyerDocument = String(order.billing_documento || '').replace(/\D/g, '');
  const { data: buyer, error: buyerError } = buyerMlId
    ? await client.from('clientes').select('email,telefone').eq('ml_id', buyerMlId).limit(1).maybeSingle()
    : buyerDocument
      ? await client.from('clientes').select('email,telefone').eq('documento', buyerDocument).limit(1).maybeSingle()
      : { data: null, error: null };
  if (buyerError) throw new Error('Falha ao consultar contato do comprador');
  const dest = block(input.xml, 'dest');
  const email = formatEmail(buyer?.email) || formatEmail(tag(dest, 'email'));
  const phone = formatPhone(buyer?.telefone) || formatPhone(tag(block(dest, 'enderDest'), 'fone'));
  const { data: existing, error: existingError } = await client.from('compras')
    .select('id,evolusom_order_id,evolusom_request_code,evolusom_request_state,evolusom_attempt_count,data_criacao')
    .eq('pedido_id', input.pedidoId)
    .eq('fornecedor_id', EVOLUSOM_SUPPLIER_ID)
    .maybeSingle();
  if (existingError) throw new Error('Falha ao verificar pedido Evolusom existente');
  if (existing?.evolusom_order_id) {
    return {
      state: 'created', orderId: existing.evolusom_order_id, purchaseId: existing.id,
      status: 'Criado', placeholder: String(order.dslite_label_source || '').startsWith('placeholder_release_window'),
    };
  }
  const existingRequestState = String(existing?.evolusom_request_state || '');
  if (existing && !['prepared', 'rejected', 'uncertain'].includes(existingRequestState)) {
    return { state: 'uncertain', reason: 'Criação anterior está em andamento ou precisa de conferência na Evolusom' };
  }
  const previousAttemptCount = Number(existing?.evolusom_attempt_count || 0);
  const initialAmbiguousResult = existingRequestState === 'uncertain';
  const allowAutomaticRetry = previousAttemptCount === 0
    && (!existing || existingRequestState === 'prepared');
  const shipmentId = String(order.ml_shipment_id || '').trim();
  const shipment = shipmentId
    ? await fetchML<{ status?: string; substatus?: string; tracking_number?: string | null }>(`/shipments/${encodeURIComponent(shipmentId)}`)
    : null;
  if (shipmentId && !shipment && !order.ml_label_storage_path) {
    return { state: 'pending', reason: 'Não foi possível conferir a etiqueta do Mercado Livre' };
  }
  const realTrackingNumber = String(order.rastreio || shipment?.tracking_number || '').trim();
  let realLabelAvailable = Boolean(order.ml_label_storage_path);
  if (!realLabelAvailable && shipmentId && isMlShipmentLabelPrintable(shipment)) {
    const label = await baixarEtiquetaML(shipmentId, { responseType: 'pdf' });
    if (!label.pdf) return { state: 'pending', reason: 'Etiqueta real liberada, mas não foi possível baixá-la do Mercado Livre' };
    const stored = await storeShippingLabelForPedido({
      client, pedidoId: input.pedidoId, pedidoNumero: order.numero,
      mlOrderId: String(order.ml_order_id || '') || null,
      shipmentId, pdf: label.pdf, source: 'evolusom_purchase',
    });
    if (!stored.ok || !stored.storagePath) {
      return { state: 'pending', reason: 'Etiqueta real liberada, mas não foi possível salvá-la no Bentevi' };
    }
    const { data: storedOrder, error: storedOrderError } = await client.from('pedidos')
      .select('ml_label_storage_path').eq('id', input.pedidoId).maybeSingle();
    if (storedOrderError || storedOrder?.ml_label_storage_path !== stored.storagePath) {
      return { state: 'pending', reason: 'Etiqueta real salva sem vínculo confirmado com a venda' };
    }
    realLabelAvailable = true;
  }
  if (realLabelAvailable && !realTrackingNumber) {
    return { state: 'pending', reason: 'Etiqueta real liberada, aguardando código de rastreio do ML' };
  }
  const placeholder = !realLabelAvailable;
  const trackingNumber = realTrackingNumber || EVOLUSOM_PLACEHOLDER_TRACKING_NUMBER;
  const baseUrl = appOrigin();
  const labelUrl = buildPublicShippingLabelUrl(baseUrl, input.pedidoId, placeholder ? 'placeholder_evolusom' : 'pdf');
  const saleNumber = Number(order.numero);
  if (!Number.isSafeInteger(saleNumber) || saleNumber <= 0) {
    throw new Error('Número da venda inválido para reservar código Evolusom');
  }
  const existingCode = String(existing?.evolusom_request_code || '');
  const supplierOrderCode = /^\d{8}$/.test(existingCode)
    ? Number(existingCode)
    : 80_000_000 + (saleNumber % 10_000_000);
  const orderCode = String(supplierOrderCode);
  const orderedAt = existing ? String(existing.data_criacao || '') : new Date().toISOString();
  const danfeTargetUrl = buildPublicNfeUrl(baseUrl, input.pedidoId, 'danfe');
  const danfeShortUrl = await createShortLink({
    client,
    baseUrl,
    targetUrl: danfeTargetUrl,
    purpose: 'danfe',
    metadata: { pedidoId: input.pedidoId, mlOrderId: order.ml_order_id || null },
  });
  const shortCode = danfeShortUrl?.startsWith(`${baseUrl}/s/`)
    ? danfeShortUrl.slice(`${baseUrl}/s/`.length)
    : '';
  if (!danfeShortUrl || !/^[a-zA-Z0-9]{8}$/.test(shortCode)) {
    return { state: 'pending', reason: 'Não foi possível criar o link curto da DANFE; pedido não enviado à Evolusom' };
  }
  const { data: shortLink, error: shortLinkError } = await (client as any).from('short_links')
    .select('target_url').eq('code', shortCode).maybeSingle();
  if (shortLinkError || shortLink?.target_url !== danfeTargetUrl) {
    return { state: 'pending', reason: 'Não foi possível confirmar o link curto da DANFE; pedido não enviado à Evolusom' };
  }
  const payload = buildEvolusomTriangularPayload({
    orderCode: supplierOrderCode,
    orderedAt,
    companyCnpj: formatCnpj(String(company.cnpj)),
    xml: input.xml,
    email,
    phone,
    trackingNumber,
    labelUrl,
    danfeUrl: danfeShortUrl,
    products: input.products,
  });
  const firstOfferId = input.products[0]?.offerId;
  const { data: offer } = firstOfferId
    ? await client.from('produto_fornecedor_ofertas').select('produto_id').eq('id', firstOfferId).maybeSingle()
    : { data: null };
  const { data: product } = offer?.produto_id
    ? await client.from('produtos').select('nome').eq('id', offer.produto_id).maybeSingle()
    : { data: null };
  const productDescription = String(product?.nome || tag(block(input.xml, 'prod'), 'xProd') || input.products[0]?.sku || '').trim();
  const purchaseValues = {
    pedido_id: input.pedidoId,
    evolusom_request_code: orderCode,
    evolusom_request_state: 'prepared',
    evolusom_attempt_count: previousAttemptCount,
    fornecedor_id: EVOLUSOM_SUPPLIER_ID,
    fornecedor_nome: 'Evolusom',
    nf_chave: payload.nfe.chave,
    nf_numero: payload.nfe.numero,
    nf_serie: payload.nfe.serie,
    destinatario_nome: payload.cliente.nome,
    destinatario_documento: payload.cliente.documento,
    produto_descricao: productDescription,
    produto_sku: input.products[0]?.sku || null,
    produto_fornecedor_oferta_id: input.products[0]?.offerId || null,
    rastreio: realTrackingNumber || null,
    quantidade: input.products.reduce((sum, item) => sum + item.quantity, 0),
    valor_total: money(input.products.reduce((sum, item) => sum + item.quantity * item.cost, 0)),
    supplier_payment_mode: input.supplierPaymentMode,
    supplier_payment_status: input.supplierPaymentMode === 'prepaid_pix' ? 'pending' : 'not_applicable',
    supplier_payment_amount: money(input.products.reduce((sum, item) => sum + item.quantity * item.cost, 0)),
    status: 'criacao_pendente',
    status_dslite: '',
    ...(!existing ? { data_criacao: orderedAt } : {}),
  };
  const { data: purchase, error: purchaseError } = existing
    ? await client.from('compras').update(purchaseValues).eq('id', existing.id)
      .eq('evolusom_request_state', existingRequestState)
      .eq('evolusom_attempt_count', previousAttemptCount).select('id').maybeSingle()
    : await client.from('compras').insert(purchaseValues).select('id').single();
  if (purchaseError) throw new Error('Falha ao reservar código do pedido Evolusom');
  if (!purchase) return { state: 'pending', reason: 'Pedido Evolusom já está sendo processado' };
  const { data: reserved, error: sentError } = await client.from('compras')
    .update({ evolusom_request_state: 'sent', evolusom_attempt_count: previousAttemptCount + 1 })
    .eq('id', purchase.id)
    .eq('evolusom_request_state', 'prepared')
    .eq('evolusom_attempt_count', previousAttemptCount)
    .select('id')
    .maybeSingle();
  if (sentError || !reserved) throw new Error('Pedido Evolusom já está em criação; confira antes de repetir');

  type EvolusomCreateResponse = {
    codigo?: number;
    status?: string | number;
    message?: unknown;
    data?: { codigo?: number; numero?: number; status?: string; pedido_lojista?: { numero?: number; status?: string } };
  };
  const requestAttempts: Array<{ attempt: number; result: unknown }> = [];
  let previousFailureWasAmbiguous = initialAmbiguousResult;
  let lastError: string | null = null;
  let lastResponse: EvolusomCreateResponse | null = null;
  let orderId: number | null = null;
  let currentAttemptCount = previousAttemptCount + 1;

  for (let attempt = 1; attempt <= (allowAutomaticRetry ? 2 : 1); attempt += 1) {
    if (attempt > 1) {
      const { data: retryReserved, error: retryReservationError } = await client.from('compras')
        .update({ evolusom_request_state: 'sent', evolusom_attempt_count: currentAttemptCount + 1 })
        .eq('id', purchase.id)
        .eq('evolusom_request_state', 'sent')
        .eq('evolusom_attempt_count', currentAttemptCount)
        .select('id')
        .maybeSingle();
      if (retryReservationError || !retryReserved) {
        return {
          state: 'uncertain',
          reason: 'Não foi possível reservar a retentativa automática; confira antes de repetir',
          apiResponse: requestAttempts.length ? { attempts: requestAttempts } : null,
        };
      }
      currentAttemptCount += 1;
    }

    try {
      const response = await evolusomRequest<EvolusomCreateResponse>('/v1/pedidos/triangular', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      lastResponse = response;
      requestAttempts.push({ attempt: currentAttemptCount, result: response });
      const embeddedErrorStatus = readEmbeddedErrorStatus(response);
      if (embeddedErrorStatus !== null) {
        const retryable = isRetryableEvolusomErrorStatus(embeddedErrorStatus);
        const rejected = isDefinitiveEvolusomRejection(embeddedErrorStatus) && !previousFailureWasAmbiguous;
        previousFailureWasAmbiguous ||= retryable;
        const oracleCode = typeof response.message === 'string'
          ? response.message.match(/ORA-\d{5}/)?.[0]
          : null;
        lastError = `Evolusom retornou erro ${embeddedErrorStatus}${oracleCode ? ` (${oracleCode})` : ''}`;
        if (retryable && allowAutomaticRetry && attempt === 1) continue;
        const { error: stateError } = await client.from('compras').update({
          evolusom_request_state: rejected ? 'rejected' : 'uncertain',
          status: rejected ? 'erro_criacao' : 'criacao_incerta',
        }).eq('id', purchase.id).eq('evolusom_request_state', 'sent').eq('evolusom_attempt_count', currentAttemptCount);
        return {
          state: rejected && !stateError ? 'pending' : 'uncertain',
          reason: stateError ? 'Falha ao registrar o resultado da Evolusom; confira antes de repetir' : lastError,
          apiResponse: requestAttempts.length === 1 ? response : { attempts: requestAttempts },
        };
      }

      const responseOrderId = readEvolusomOrderId(response);
      if (Number.isSafeInteger(responseOrderId) && responseOrderId > 0) {
        orderId = responseOrderId;
        break;
      }
      previousFailureWasAmbiguous = true;
      lastError = 'Evolusom não retornou número de pedido válido';
      if (allowAutomaticRetry && attempt === 1) continue;
    } catch (error) {
      const status = error instanceof EvolusomApiError ? error.status : null;
      const retryable = isRetryableEvolusomErrorStatus(status);
      const rejected = isDefinitiveEvolusomRejection(status) && !previousFailureWasAmbiguous;
      previousFailureWasAmbiguous ||= retryable;
      lastError = error instanceof Error ? error.message : 'Falha ao criar pedido Evolusom';
      requestAttempts.push({
        attempt: currentAttemptCount,
        result: error instanceof EvolusomApiError ? error.responseBody : { status, message: lastError },
      });
      if (retryable && allowAutomaticRetry && attempt === 1) continue;
      const { error: stateError } = await client.from('compras').update({
        evolusom_request_state: rejected ? 'rejected' : 'uncertain',
        status: rejected ? 'erro_criacao' : 'criacao_incerta',
      }).eq('id', purchase.id).eq('evolusom_request_state', 'sent').eq('evolusom_attempt_count', currentAttemptCount);
      return {
        state: rejected && !stateError ? 'pending' : 'uncertain',
        reason: stateError ? 'Falha ao registrar o resultado da Evolusom; confira antes de repetir' : lastError,
        apiResponse: requestAttempts.length === 1 ? requestAttempts[0].result : { attempts: requestAttempts },
      };
    }
  }

  if (orderId === null) {
    const { error: stateError } = await client.from('compras').update({
      evolusom_request_state: 'uncertain',
      status: 'criacao_incerta',
    }).eq('id', purchase.id).eq('evolusom_request_state', 'sent').eq('evolusom_attempt_count', currentAttemptCount);
    return {
      state: 'uncertain',
      reason: stateError ? 'Falha ao registrar o resultado da Evolusom; confira antes de repetir' : lastError || 'Falha ao criar pedido Evolusom',
      apiResponse: requestAttempts.length === 1 ? lastResponse : { attempts: requestAttempts },
    };
  }

  const response = lastResponse!;
  const status = response.data?.pedido_lojista?.status || response.data?.status
    || (typeof response.status === 'string' ? response.status : 'Pendente');
  const { error: saveError } = await client.from('compras').update({
    evolusom_order_id: orderId,
    evolusom_request_state: 'created',
    status,
  }).eq('id', purchase.id).eq('evolusom_request_state', 'sent').eq('evolusom_attempt_count', currentAttemptCount);
  if (saveError) return { state: 'uncertain', reason: 'Pedido criado, mas vínculo local não foi salvo', apiResponse: response };
  const { error: linkError } = await client.from('pedidos').update({
    evolusom_order_id: orderId,
    fulfillment_source: 'supplier',
    dslite_label_source: placeholder ? DSLITE_EVOLUSOM_PLACEHOLDER_LABEL_SOURCE : 'mercado_livre',
    dslite_etiqueta_enviada: true,
    label_type: placeholder ? 'provisional' : 'real',
    label_delivery_channel: 'dslite',
    label_delivered_at: placeholder ? null : new Date().toISOString(),
  }).in('id', input.orderIds);
  if (linkError) return { state: 'uncertain', reason: 'Pedido criado, mas vendas locais não foram vinculadas', apiResponse: response };
  return { state: 'created', orderId, purchaseId: purchase.id, status, placeholder, apiResponse: response };
}

export async function getEvolusomOrderStatus(orderId: number) {
  return evolusomRequest<{
    data?: {
      pedido_lojista?: { numero?: number; status?: string };
      pedido_cliente?: { numero?: number; status?: string } | null;
      bloqueios?: Array<{ motivo?: string }>;
    };
  }>(`/v1/pedidos/triangular/${orderId}/status`);
}
