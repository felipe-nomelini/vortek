import { createServiceClient } from '@/lib/supabase';
import { buildPublicNfeUrl } from '@/lib/public-nfe-links';
import { buildPublicShippingLabelUrl } from '@/lib/public-shipping-label-links';
import { fetchML } from '@/services/integration';
import { evolusomRequest, EvolusomApiError } from '@/services/evolusom';
import { DSLITE_EVOLUSOM_PLACEHOLDER_LABEL_SOURCE } from '@/lib/dslite/placeholder-label';

const EVOLUSOM_SUPPLIER_ID = '133';
const EVOLUSOM_PLACEHOLDER_TRACKING_NUMBER = '99999999999';

type ProductLine = { sku: string; quantity: number; cost: number; offerId: string | null };
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
    const invoice = invoiceItems.find((item) => item.sku === product.sku);
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
  placeholder: boolean;
  supplierPaymentMode: string;
}): Promise<CreateResult> {
  if (process.env.EVOLUSOM_DIRECT_ENABLED !== 'true') {
    return { state: 'pending', reason: 'Integração direta Evolusom desabilitada' };
  }
  const client = createServiceClient();
  const [{ data: order, error: orderError }, { data: company, error: companyError }] = await Promise.all([
    client.from('pedidos').select('id,numero,ml_order_id,ml_shipment_id,rastreio,ml_label_storage_path,billing_documento,buyer_ml_id').eq('id', input.pedidoId).maybeSingle(),
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
  const shipmentId = String(order.ml_shipment_id || '').trim();
  const shipment = shipmentId ? await fetchML<{ tracking_number?: string | null }>(`/shipments/${encodeURIComponent(shipmentId)}`) : null;
  const realTrackingNumber = String(order.rastreio || shipment?.tracking_number || '').trim();
  const trackingNumber = realTrackingNumber || (input.placeholder ? EVOLUSOM_PLACEHOLDER_TRACKING_NUMBER : '');
  if (!trackingNumber) return { state: 'pending', reason: 'Aguardando código de rastreio do ML' };
  const baseUrl = appOrigin();
  const labelUrl = input.placeholder
    ? buildPublicShippingLabelUrl(baseUrl, input.pedidoId, 'placeholder_evolusom')
    : buildPublicShippingLabelUrl(baseUrl, input.pedidoId);
  if (!input.placeholder && !order.ml_label_storage_path) {
    return { state: 'pending', reason: 'Etiqueta real ainda não disponível no Bentevi' };
  }
  const orderCode = `BNT-${order.numero}`;
  const supplierOrderCode = Number(order.numero);
  if (!Number.isSafeInteger(supplierOrderCode) || supplierOrderCode <= 0) {
    throw new Error('Número da venda inválido para o código numérico exigido pela Evolusom');
  }
  const { data: existing, error: existingError } = await client.from('compras')
    .select('id,evolusom_order_id,evolusom_request_state,data_criacao')
    .eq('evolusom_request_code', orderCode).maybeSingle();
  if (existingError) throw new Error('Falha ao verificar pedido Evolusom existente');
  if (existing?.evolusom_order_id) {
    return { state: 'created', orderId: existing.evolusom_order_id, purchaseId: existing.id, status: 'Criado', placeholder: input.placeholder };
  }
  const existingRequestState = String(existing?.evolusom_request_state || '');
  if (existing && !['prepared', 'rejected'].includes(existingRequestState)) {
    return { state: 'uncertain', reason: 'Criação anterior precisa de conferência na Evolusom antes de repetir' };
  }
  const orderedAt = existing ? String(existing.data_criacao || '') : new Date().toISOString();
  const payload = buildEvolusomTriangularPayload({
    orderCode: supplierOrderCode,
    orderedAt,
    companyCnpj: formatCnpj(String(company.cnpj)),
    xml: input.xml,
    email,
    phone,
    trackingNumber,
    labelUrl,
    danfeUrl: buildPublicNfeUrl(baseUrl, input.pedidoId, 'danfe'),
    products: input.products,
  });
  const purchaseValues = {
    pedido_id: input.pedidoId,
    evolusom_request_code: orderCode,
    evolusom_request_state: 'prepared',
    fornecedor_id: EVOLUSOM_SUPPLIER_ID,
    fornecedor_nome: 'Evolusom',
    nf_chave: payload.nfe.chave,
    nf_numero: payload.nfe.numero,
    nf_serie: payload.nfe.serie,
    destinatario_nome: payload.cliente.nome,
    destinatario_documento: payload.cliente.documento,
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
      .eq('evolusom_request_state', existingRequestState).select('id').maybeSingle()
    : await client.from('compras').insert(purchaseValues).select('id').single();
  if (purchaseError) throw new Error('Falha ao reservar código do pedido Evolusom');
  if (!purchase) return { state: 'pending', reason: 'Pedido Evolusom já está sendo processado' };
  const { data: reserved, error: sentError } = await client.from('compras')
    .update({ evolusom_request_state: 'sent' })
    .eq('id', purchase.id)
    .eq('evolusom_request_state', 'prepared')
    .select('id')
    .maybeSingle();
  if (sentError || !reserved) throw new Error('Pedido Evolusom já está em criação; confira antes de repetir');

  let response: {
    codigo?: number;
    status?: string | number;
    message?: unknown;
    data?: { codigo?: number; numero?: number; status?: string; pedido_lojista?: { numero?: number; status?: string } };
  };
  try {
    response = await evolusomRequest<typeof response>('/v1/pedidos/triangular', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const rejected = error instanceof EvolusomApiError && [400, 422].includes(error.status || 0);
    await client.from('compras').update({
      evolusom_request_state: rejected ? 'rejected' : 'uncertain',
      status: rejected ? 'erro_criacao' : 'criacao_incerta',
    }).eq('id', purchase.id);
    return {
      state: rejected ? 'pending' : 'uncertain',
      reason: error instanceof Error ? error.message : 'Falha ao criar pedido Evolusom',
      apiResponse: error instanceof EvolusomApiError ? error.responseBody : null,
    };
  }
  const embeddedStatus = Number(response.status);
  if (Number.isInteger(embeddedStatus) && embeddedStatus >= 400) {
    const rejected = [400, 422].includes(embeddedStatus);
    await client.from('compras').update({
      evolusom_request_state: rejected ? 'rejected' : 'uncertain',
      status: rejected ? 'erro_criacao' : 'criacao_incerta',
    }).eq('id', purchase.id);
    const oracleCode = typeof response.message === 'string'
      ? response.message.match(/ORA-\d{5}/)?.[0]
      : null;
    return {
      state: rejected ? 'pending' : 'uncertain',
      reason: `Evolusom retornou erro ${embeddedStatus}${oracleCode ? ` (${oracleCode})` : ''}`,
      apiResponse: response,
    };
  }
  const orderId = Number(response.codigo ?? response.data?.codigo ?? response.data?.numero ?? response.data?.pedido_lojista?.numero);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    await client.from('compras').update({ evolusom_request_state: 'uncertain', status: 'criacao_incerta' }).eq('id', purchase.id);
    return { state: 'uncertain', reason: 'Evolusom não retornou número de pedido válido', apiResponse: response };
  }
  const status = response.data?.pedido_lojista?.status || response.data?.status
    || (typeof response.status === 'string' ? response.status : 'Pendente');
  const { error: saveError } = await client.from('compras').update({
    evolusom_order_id: orderId,
    evolusom_request_state: 'created',
    status,
  }).eq('id', purchase.id);
  if (saveError) return { state: 'uncertain', reason: 'Pedido criado, mas vínculo local não foi salvo', apiResponse: response };
  const { error: linkError } = await client.from('pedidos').update({
    evolusom_order_id: orderId,
    fulfillment_source: 'supplier',
    dslite_label_source: input.placeholder ? DSLITE_EVOLUSOM_PLACEHOLDER_LABEL_SOURCE : 'evolusom_direct',
    dslite_etiqueta_enviada: true,
    label_type: input.placeholder ? 'provisional' : 'real',
    label_delivery_channel: 'dslite',
    label_delivered_at: input.placeholder ? null : new Date().toISOString(),
  }).in('id', input.orderIds);
  if (linkError) return { state: 'uncertain', reason: 'Pedido criado, mas vendas locais não foram vinculadas', apiResponse: response };
  return { state: 'created', orderId, purchaseId: purchase.id, status, placeholder: input.placeholder, apiResponse: response };
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
