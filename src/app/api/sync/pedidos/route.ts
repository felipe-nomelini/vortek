import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML, fetchMLResult, type MLRequestResult } from '@/services/integration';
import { calculateOrderProfit } from '@/services/orders';
import type { Database } from '@/types/database';

export const maxDuration = 300;

const SYNC_CONCURRENCY = 3;
const TRANSIENT_RETRY_ATTEMPTS = 2;
const TRANSIENT_RETRY_BASE_DELAY_MS = 900;

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMLResultWithRetry<T>(path: string): Promise<{ result: MLRequestResult<T>; retries: number }> {
  let retries = 0;

  for (let attempt = 0; attempt < TRANSIENT_RETRY_ATTEMPTS; attempt++) {
    const result = await fetchMLResult<T>(path);

    if (result.ok) {
      return { result, retries };
    }

    const isRetryable = result.error?.category === 'retryable';
    const hasNextAttempt = attempt < TRANSIENT_RETRY_ATTEMPTS - 1;

    if (!isRetryable || !hasNextAttempt) {
      return { result, retries };
    }

    retries += 1;
    await sleep(TRANSIENT_RETRY_BASE_DELAY_MS * (attempt + 1));
  }

  const fallback = await fetchMLResult<T>(path);
  return { result: fallback, retries };
}

function determinarSituacao(status: string, tags: string[], isDevolvido: boolean): Database['public']['Enums']['pedido_status'] {
  // Prioridade 1: devolução confirmada
  if (isDevolvido) return 'devolvido';
  // Prioridade 2: entregue
  if (tags.includes('delivered')) return 'entregue';
  // Prioridade 3: cancelado
  if (tags.includes('not_delivered') && status === 'cancelled') return 'cancelado';
  if (status === 'cancelled') return 'cancelado';
  return 'aberto';
}

function mapearStatusShipment(shipmentStatus: string, shipmentSubstatus?: string): Database['public']['Enums']['pedido_status'] {
  switch (shipmentStatus) {
    case 'pending':
      return 'pendente';
    case 'handling':
      return 'preparando';
    case 'ready_to_ship':
      if (shipmentSubstatus === 'printed') return 'etiqueta_impressa';
      if (shipmentSubstatus === 'dropped_off') return 'coletado';
      if (shipmentSubstatus === 'picked_up') return 'coletado';
      return 'pronto_envio';
    case 'shipped':
      if (shipmentSubstatus === 'out_for_delivery') return 'saiu_entrega';
      if (shipmentSubstatus === 'receiver_absent') return 'dest_ausente';
      return 'em_transito';
    case 'delivered':
      return 'entregue';
    case 'not_delivered':
      if (shipmentSubstatus === 'refused_delivery') return 'recusado';
      return 'dest_ausente';
    case 'cancelled':
      return 'cancelado';
    default:
      return 'aberto';
  }
}

async function buscarClaims(orderId: string | number): Promise<{ id: string | null; status: string | null; isDevolvido: boolean }> {
  try {
    const search = await fetchML<any>(`/post-purchase/v1/claims/search?resource_id=${orderId}&resource=order`);
    if (search?.data && Array.isArray(search.data) && search.data.length > 0) {
      const claim = search.data[0];
      const isDevolvido = claim.resolution?.reason === 'item_returned' ||
                          claim.resolution?.closed_by === 'mediator' &&
                          claim.resolution?.benefited?.includes('complainant');
      return {
        id: String(claim.id),
        status: claim.status || null,
        isDevolvido,
      };
    }
  } catch (err: any) {
    console.error(`[sync-pedidos] Erro ao buscar claims do pedido ${orderId}:`, err?.message);
  }
  return { id: null, status: null, isDevolvido: false };
}

async function baixarDanfeConsultaDanfe(chave: string): Promise<{ success: boolean; pdf?: Buffer; mensagem?: string }> {
  try {
    const res = await fetch('https://consultadanfe.com/api/v1/consulta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, format: 'json' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, mensagem: err.message || `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (data.status === 'ok' && data.pdf_base64) {
      return { success: true, pdf: Buffer.from(data.pdf_base64, 'base64') };
    }

    return { success: false, mensagem: data.message || 'PDF não disponível' };
  } catch (err: any) {
    return { success: false, mensagem: err?.message || 'Erro ao baixar DANFE' };
  }
}

type SyncOrderResult = {
  salvo: boolean;
  semNf: number;
  semShipment: number;
  authFailures: number;
  retriesTransient: number;
  nfAutorizada: number;
  nfCancelada: number;
  nfPendente: number;
  durationMs: number;
};

function normalizeNfeStatus(status: string | null | undefined): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'authorized' || normalized === 'autorizada') return 'autorizada';
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancelada') return 'cancelada';
  if (!normalized) return 'pendente';
  return normalized;
}

async function upsertCliente(serviceClient: ReturnType<typeof createServiceClient>, payload: {
  buyerId: string;
  nickname: string;
  nome: string;
  documento: string;
  tipoPessoa: string;
  endereco: string;
}) {
  const basePayload = {
    ml_id: payload.buyerId,
    ml_nickname: payload.nickname,
    nome: payload.nome,
    nickname: payload.nickname || null,
    documento: payload.documento,
    tipo_pessoa: payload.tipoPessoa,
    email: '',
    telefone: '',
    endereco: payload.endereco,
  };

  const upsertResult = await serviceClient
    .from('clientes')
    .upsert(basePayload as any, { onConflict: 'ml_id' });

  if (!upsertResult.error) {
    return;
  }

  const { data: existing } = await serviceClient
    .from('clientes')
    .select('id')
    .eq('ml_id', payload.buyerId)
    .maybeSingle();

  if (existing?.id) {
    await serviceClient.from('clientes').update(basePayload as any).eq('id', existing.id);
    return;
  }

  await serviceClient.from('clientes').insert(basePayload as any);
}

async function processOrder(params: {
  order: any;
  meId: number;
  serviceClient: ReturnType<typeof createServiceClient>;
}): Promise<SyncOrderResult> {
  const startedAt = Date.now();
  const { order: o, meId, serviceClient } = params;

  let semNf = 0;
  let semShipment = 0;
  let authFailures = 0;
  let retriesTransient = 0;
  let nfAutorizada = 0;
  let nfCancelada = 0;
  let nfPendente = 0;

  // 1. Detalhes completos do pedido (first_name, last_name)
  const detail = await fetchML<any>(`/orders/${o.id}`).catch(() => null);
  const buyer = detail?.buyer || o.buyer;

  // 2. Nome formatado: Nome Sobrenome (NICKNAME)
  const first = buyer?.first_name || '';
  const last = buyer?.last_name || '';
  const nomePartes = first.toLowerCase() === last.toLowerCase()
    ? [first]
    : [first, last];
  const nome = nomePartes.filter(Boolean).map(titleCase).join(' ').trim();
  const nickname = (buyer?.nickname || '').toUpperCase();
  const contatoNome = nome ? `${nome} (${nickname})` : nickname || 'Desconhecido';

  // 2b. Salvar/atualizar cliente no banco
  try {
    const buyerId = buyer?.id;
    if (buyerId) {
      let billingName = '';
      let billingLastName = '';
      let docNumber = '';
      let streetName = '';
      let streetNumber = '';
      let neighborhood = '';
      let cityName = '';
      let stateName = '';
      let zipCode = '';

      const billingInfoId = detail?.buyer?.billing_info?.id;
      if (billingInfoId) {
        try {
          const billing = await fetchML<any>(`/orders/billing-info/MLB/${billingInfoId}`);
          if (billing?.buyer?.billing_info) {
            const binfo = billing.buyer.billing_info;
            billingName = binfo.name || '';
            billingLastName = binfo.last_name || '';
            docNumber = binfo.identification?.number || '';
            const addr = binfo.address;
            if (addr) {
              streetName = addr.street_name || '';
              streetNumber = addr.street_number || '';
              neighborhood = addr.neighborhood || '';
              cityName = addr.city_name || '';
              stateName = addr.state?.name || '';
              zipCode = addr.zip_code || '';
            }
          }
        } catch {
          // ignora fallback para dados do order
        }
      }

      if (!billingName) billingName = buyer?.first_name || '';
      if (!billingLastName) billingLastName = buyer?.last_name || '';

      const nomeReal = `${billingName} ${billingLastName}`.trim() || nickname || 'Desconhecido';
      const clienteNome = nomeReal ? `${nomeReal} (${nickname})` : nickname || 'Desconhecido';
      const documento = docNumber || '';
      const tipoPessoa = docNumber.length === 14 ? 'J' : docNumber.length === 11 ? 'F' : '';

      const enderecoParts = [streetName, streetNumber, neighborhood, cityName, stateName, zipCode].filter(Boolean);
      const endereco = enderecoParts.length > 0
        ? `${streetName}${streetNumber ? ', ' + streetNumber : ''}${neighborhood ? ' - ' + neighborhood : ''}${cityName ? ', ' + cityName : ''}${stateName ? ' - ' + stateName : ''}${zipCode ? ', CEP ' + zipCode : ''}`
        : '';

      await upsertCliente(serviceClient, {
        buyerId: String(buyerId),
        nickname,
        nome: clienteNome,
        documento,
        tipoPessoa,
        endereco,
      });
    }
  } catch (err: any) {
    console.error(`[sync-pedidos] Erro ao salvar cliente do pedido ${o.id}:`, err?.message || err);
  }

  // 3. Claims: buscar reclamações via endpoint de search
  const { id: claimIdFromSearch, status: claimStatusFromSearch, isDevolvido } = await buscarClaims(o.id);

  // 4. Status: usa tags 'delivered'/'not_delivered' para refinar (considerando devolução)
  const tags: string[] = o.tags || [];
  let situacao = determinarSituacao(o.status, tags, isDevolvido);

  // 5. NF-e: busca invoice se existir
  let notaFiscalNumero: string | null = null;
  let nfeChave: string | null = null;
  let nfeDanfeUrl: string | null = null;
  let nfeStatus: string | undefined;

  try {
    const invoiceFetch = await fetchMLResultWithRetry<any>(`/users/${meId}/invoices/orders/${o.id}`);
    retriesTransient += invoiceFetch.retries;
    const invoiceResult = invoiceFetch.result;

    if (invoiceResult.ok && invoiceResult.data?.invoice_number) {
      const invoice = invoiceResult.data;
      notaFiscalNumero = String(invoice.invoice_number);
      nfeChave = invoice.attributes?.invoice_key || null;
      nfeStatus = normalizeNfeStatus(invoice.status);
      if (nfeStatus === 'autorizada') nfAutorizada++;
      else if (nfeStatus === 'cancelada') nfCancelada++;
      else nfPendente++;

      // Baixar DANFE via consultadanfe.com e salvar no Storage
      if (nfeChave) {
        const danfeResult = await baixarDanfeConsultaDanfe(nfeChave);
        if (danfeResult.success && danfeResult.pdf && danfeResult.pdf.length > 0) {
          const filePath = `${o.id}/${notaFiscalNumero}.pdf`;
          const { error: uploadError } = await serviceClient.storage
            .from('danfes')
            .upload(filePath, danfeResult.pdf, { contentType: 'application/pdf', upsert: true });

          if (!uploadError) {
            const { data: signedData } = await serviceClient.storage
              .from('danfes')
              .createSignedUrl(filePath, 60 * 60 * 24 * 7);

            if (signedData?.signedUrl) {
              nfeDanfeUrl = signedData.signedUrl;
            }
          }
        }
      }
    } else if (!invoiceResult.ok && invoiceResult.error?.status === 404) {
      semNf++;
      nfeStatus = 'pendente';
      nfPendente++;
    } else if (!invoiceResult.ok && invoiceResult.error?.category === 'auth_fatal') {
      authFailures++;
    }
  } catch {
    // ignora falha pontual de invoice
  }

  // 6. Shipment: buscar ml_shipment_id e status detalhado (uma única chamada por pedido)
  let mlShipmentId: string | null = null;
  let shipmentDetail: any = null;

  try {
    const shipmentFetch = await fetchMLResultWithRetry<any>(`/orders/${o.id}/shipments`);
    retriesTransient += shipmentFetch.retries;
    const shipmentResult = shipmentFetch.result;

    if (shipmentResult.ok && shipmentResult.data?.id) {
      shipmentDetail = shipmentResult.data;
      mlShipmentId = String(shipmentDetail.id);

      if (situacao !== 'devolvido') {
        const shipStatus = shipmentDetail.status;
        const shipSubstatus = shipmentDetail.substatus;
        if (shipStatus) {
          situacao = mapearStatusShipment(shipStatus, shipSubstatus);
        }
      }
    } else if (!shipmentResult.ok && shipmentResult.error?.status === 404) {
      semShipment++;
    } else if (!shipmentResult.ok && shipmentResult.error?.category === 'auth_fatal') {
      authFailures++;
    }
  } catch {
    // ignora falha pontual de shipment
  }

  // 7. Lucro real: não refazer chamada de shipment quando já tratada acima
  const { lucro, rastreio } = await calculateOrderProfit(detail, shipmentDetail, { allowShipmentFetch: false });

  // 8. Claim: usar dados da busca ou detalhe do pedido
  let mlClaimId: string | null = claimIdFromSearch;
  let mlClaimStatus: string | null = claimStatusFromSearch;
  try {
    if (!mlClaimId && detail?.claim_id) {
      mlClaimId = String(detail.claim_id);
      const claim = await fetchML<any>(`/post-purchase/v1/claims/${detail.claim_id}`);
      if (claim?.status) {
        mlClaimStatus = claim.status;
      }
    }
  } catch {
    // ignora falha pontual
  }

  const { error } = await serviceClient.from('pedidos').upsert({
    ml_order_id: String(o.id),
    numero: o.id,
    numero_loja: String(o.id),
    data: o.date_created,
    contato_nome: contatoNome,
    total: o.total_amount || 0,
    situacao,
    rastreio,
    lucro: lucro ?? undefined,
    nota_fiscal_numero: notaFiscalNumero,
    nfe_chave: nfeChave,
    nfe_status: nfeStatus,
    nfe_danfe_url: nfeDanfeUrl,
    nota_fiscal_emitida: !!notaFiscalNumero,
    ml_shipment_id: mlShipmentId,
    ml_claim_id: mlClaimId,
    ml_claim_status: mlClaimStatus,
  } as any, { onConflict: 'ml_order_id' });

  return {
    salvo: !error,
    semNf,
    semShipment,
    authFailures,
    retriesTransient,
    nfAutorizada,
    nfCancelada,
    nfPendente,
    durationMs: Date.now() - startedAt,
  };
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const startedAt = Date.now();

  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = 50;

  const me = await fetchML<any>('/users/me');
  if (!me) return NextResponse.json({ erro: 'Erro ao conectar com ML' }, { status: 502 });

  const orders = await fetchML<any>(`/orders/search?seller=${me.id}&limit=${limit}&offset=${offset}`);
  if (!orders) return NextResponse.json({ erro: 'Erro ao buscar pedidos' }, { status: 502 });

  const results = orders.results || [];
  if (results.length === 0) {
    return NextResponse.json({
      ok: true,
      sincronizados: 0,
      total: 0,
      proximo: offset,
      acabou: true,
      sem_nota_fiscal: 0,
      sem_shipment: 0,
      auth_failures: 0,
      retries_transient: 0,
      nf_autorizada: 0,
      nf_cancelada: 0,
      nf_pendente: 0,
      duracao_ms_total: Date.now() - startedAt,
      duracao_media_pedido_ms: 0,
      processed_count: 0,
      shipments_404: 0,
      invoices_404: 0,
    });
  }

  const serviceClient = createServiceClient();

  let cursor = 0;
  const workerCount = Math.min(SYNC_CONCURRENCY, results.length);

  const worker = async (): Promise<SyncOrderResult[]> => {
    const localResults: SyncOrderResult[] = [];

    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= results.length) {
        break;
      }

      const order = results[currentIndex];
      const processed = await processOrder({
        order,
        meId: me.id,
        serviceClient,
      });
      localResults.push(processed);
    }

    return localResults;
  };

  const workerOutputs = await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const processedResults = workerOutputs.flat();

  const salvos = processedResults.filter((r) => r.salvo).length;
  const semNfCount = processedResults.reduce((sum, r) => sum + r.semNf, 0);
  const semShipmentCount = processedResults.reduce((sum, r) => sum + r.semShipment, 0);
  const authFailures = processedResults.reduce((sum, r) => sum + r.authFailures, 0);
  const retriesTransient = processedResults.reduce((sum, r) => sum + r.retriesTransient, 0);
  const nfAutorizada = processedResults.reduce((sum, r) => sum + r.nfAutorizada, 0);
  const nfCancelada = processedResults.reduce((sum, r) => sum + r.nfCancelada, 0);
  const nfPendente = processedResults.reduce((sum, r) => sum + r.nfPendente, 0);
  const totalDurationMs = Date.now() - startedAt;
  const avgDurationMs = processedResults.length > 0
    ? Math.round(processedResults.reduce((sum, r) => sum + r.durationMs, 0) / processedResults.length)
    : 0;

  const total = orders.paging?.total || 0;
  const proximo = offset + limit;
  const acabou = proximo >= total || results.length < limit;

  return NextResponse.json({
    ok: true,
    sincronizados: salvos,
    pagina: Math.floor(offset / limit) + 1,
    total,
    proximo: acabou ? null : proximo,
    acabou,
    sem_nota_fiscal: semNfCount,
    sem_shipment: semShipmentCount,
    auth_failures: authFailures,
    retries_transient: retriesTransient,
    nf_autorizada: nfAutorizada,
    nf_cancelada: nfCancelada,
    nf_pendente: nfPendente,
    duracao_ms_total: totalDurationMs,
    duracao_media_pedido_ms: avgDurationMs,
    processed_count: processedResults.length,
    shipments_404: semShipmentCount,
    invoices_404: semNfCount,
    concurrency: workerCount,
  });
}
