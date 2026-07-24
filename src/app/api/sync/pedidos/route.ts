import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML, fetchMLResult, getMLAuthDiagnostics, type MLRequestResult } from '@/services/integration';
import { calculateOrderProfit } from '@/services/orders';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import type { Database } from '@/types/database';
import { getExpectedCfopByUf } from '@/lib/fiscal/cfop';
import { resolveDestIePolicy } from '@/lib/fiscal/ie-policy';
import { resolveCodMunicipio } from '@/lib/fiscal/municipio-ibge';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { getSyncRuntimeConfigValue, setSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';
import { extractMlFiscalReleaseWindow } from '@/lib/ml/fiscal-release';
import { resolveOrderSaleDate, type SaleDateSource } from '@/lib/ml/order-sale-date';
import { mapearStatusShipment } from '@/lib/ml/shipment-status';
import { getSkuLookupVariants } from '@/lib/sku';
import { alertClaimOpened, alertMlLabelReleased, alertNewSale } from '@/services/whatsapp-alerts';
import { registrarDevolucaoInterna } from '@/lib/estoque-interno';

export const maxDuration = 300;

const SYNC_CONCURRENCY = 3;
const TRANSIENT_RETRY_ATTEMPTS = 2;
const TRANSIENT_RETRY_BASE_DELAY_MS = 900;
const ORDER_SNAPSHOT_V2_ENABLED = String(process.env.ORDER_SNAPSHOT_V2_ENABLED || 'true').toLowerCase() === 'true';
const SNAPSHOT_TOTAL_TOLERANCE = 0.01;

interface BillingSnapshot {
  nome: string;
  documento: string;
  tipoPessoa: string;
  ie: string | null;
  endereco: {
    street_name: string;
    street_number: string;
    neighborhood: string;
    city_name: string;
    city_id?: string;
    cod_municipio?: string;
    state_id: string;
    state_name: string;
    zip_code: string;
    country_id?: string;
    taxpayer_type_ml_raw?: string | null;
    ie_policy_resolved?: 'contribuinte' | 'nao_contribuinte' | null;
  };
}

interface PaymentSnapshot {
  id: string | null;
  status: string | null;
  payment_type: string | null;
  total_paid_amount: number;
  date_approved: string | null;
}

interface OrderItemSnapshot {
  ml_item_id: string | null;
  seller_sku: string | null;
  titulo: string;
  quantidade: number;
  unidade: string | null;
  valor_unitario: number;
  valor_total_bruto: number;
  desconto_item: number;
  frete_rateado_item: number;
  valor_total_liquido: number;
  ncm: string | null;
  cest: string | null;
  gtin: string | null;
  origem_fiscal: string | null;
  csosn: string | null;
  cfop_sugerido: string | null;
}

interface OrderFiscalSnapshot {
  source: 'ml_live' | 'local_fallback';
  buyerMlId: string | null;
  saleDate: {
    value: string | null;
    source: SaleDateSource;
  };
  billing: BillingSnapshot;
  pagamentos: PaymentSnapshot[];
  itens: OrderItemSnapshot[];
  totais: {
    total_produtos: number;
    frete_total: number;
    desconto_total: number;
    total_final: number;
    total_calculado_com_frete: number;
    total_calculado_sem_frete: number;
  };
  incompleto: boolean;
  pendencias: string[];
}

type SourceTag = 'v2_billing' | 'legacy_billing' | 'order' | 'shipment' | 'existing' | 'fallback';
type BillingResolved = {
  nome: string;
  documento: string;
  tipoPessoa: string;
  ie: string;
  endereco: BillingSnapshot['endereco'];
  fieldSources: Record<'documento' | 'uf' | 'city' | 'cep' | 'ie' | 'nome', SourceTag>;
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeDocument(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function detectTipoPessoaFromDoc(doc: string): string {
  if (doc.length === 14) return 'J';
  if (doc.length === 11) return 'F';
  return '';
}

function isValidCpfCnpj(doc: string): boolean {
  return doc.length === 11 || doc.length === 14;
}

const UF_CODES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

function extractUfFromAddress(value: string | null | undefined): string | null {
  const raw = String(value || '').toUpperCase();
  const m = raw.match(/-\s*([A-Z]{2})(?:\b|,)/);
  if (m?.[1] && UF_CODES.has(m[1])) return m[1];
  const end = raw.match(/,\s*([A-Z]{2})\s*$/);
  if (end?.[1] && UF_CODES.has(end[1])) return end[1];
  const tokens = raw
    .replace(/[^\w\s-]/g, ' ')
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (UF_CODES.has(tokens[i])) return tokens[i];
  }
  return null;
}

function normalizeUf(value: string | null | undefined): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('BR-') && raw.length >= 5) return raw.slice(3);
  return raw;
}

function ufFromStateName(value: string | null | undefined): string {
  const raw = String(value || '').trim().toUpperCase();
  const table: Record<string, string> = {
    ACRE: 'AC',
    ALAGOAS: 'AL',
    AMAPA: 'AP',
    AMAZONAS: 'AM',
    BAHIA: 'BA',
    CEARA: 'CE',
    'DISTRITO FEDERAL': 'DF',
    'ESPIRITO SANTO': 'ES',
    GOIAS: 'GO',
    MARANHAO: 'MA',
    'MATO GROSSO': 'MT',
    'MATO GROSSO DO SUL': 'MS',
    'MINAS GERAIS': 'MG',
    PARA: 'PA',
    PARAIBA: 'PB',
    PARANA: 'PR',
    PERNAMBUCO: 'PE',
    PIAUI: 'PI',
    'RIO DE JANEIRO': 'RJ',
    'RIO GRANDE DO NORTE': 'RN',
    'RIO GRANDE DO SUL': 'RS',
    RONDONIA: 'RO',
    RORAIMA: 'RR',
    'SANTA CATARINA': 'SC',
    'SAO PAULO': 'SP',
    SERGIPE: 'SE',
    TOCANTINS: 'TO',
  };
  if (!raw) return '';
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return table[normalized] || '';
}

function normalizeZip(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeIe(value: string | null | undefined): string {
  return String(value || '').trim();
}

function resolveEmitUfForFiscal(empresa: any): { emitUf: string | null; source: 'empresa.uf_fiscal' | 'endereco_fallback' | 'missing' } {
  const ufFiscal = normalizeUf(empresa?.uf_fiscal);
  if (ufFiscal && UF_CODES.has(ufFiscal)) return { emitUf: ufFiscal, source: 'empresa.uf_fiscal' };
  const fromAddress = extractUfFromAddress(empresa?.endereco || null);
  if (fromAddress) return { emitUf: fromAddress, source: 'endereco_fallback' };
  return { emitUf: null, source: 'missing' };
}

function getAdditionalInfoValue(additionalInfo: any[], type: string): string {
  const found = additionalInfo.find((entry) => String(entry?.type || '').toUpperCase() === type.toUpperCase());
  return String(found?.value || '').trim();
}

function parseBillingInfoFromML(input: any): {
  nome: string;
  documento: string;
  tipoPessoa: string;
  ie: string;
  endereco: BillingSnapshot['endereco'];
  fieldSources: Record<string, 'billing_info' | 'order' | 'fallback'>;
} {
  const binfo = input?.billing_info || {};
  const additionalInfo = Array.isArray(binfo?.additional_info) ? binfo.additional_info : [];

  const businessName = getAdditionalInfoValue(additionalInfo, 'BUSINESS_NAME');
  const docType = getAdditionalInfoValue(additionalInfo, 'DOC_TYPE');
  const docNumber = getAdditionalInfoValue(additionalInfo, 'DOC_NUMBER') || String(binfo?.doc_number || '');
  const stateRegistration = getAdditionalInfoValue(additionalInfo, 'STATE_REGISTRATION');
  const cityName = getAdditionalInfoValue(additionalInfo, 'CITY_NAME');
  const cityId = getAdditionalInfoValue(additionalInfo, 'CITY_ID');
  const streetName = getAdditionalInfoValue(additionalInfo, 'STREET_NAME');
  const streetNumber = getAdditionalInfoValue(additionalInfo, 'STREET_NUMBER');
  const neighborhood = getAdditionalInfoValue(additionalInfo, 'NEIGHBORHOOD');
  const stateCode = getAdditionalInfoValue(additionalInfo, 'STATE_CODE');
  const stateName = getAdditionalInfoValue(additionalInfo, 'STATE_NAME');
  const zipCode = getAdditionalInfoValue(additionalInfo, 'ZIP_CODE');
  const countryId = getAdditionalInfoValue(additionalInfo, 'COUNTRY_ID');

  const documentoNormalizado = normalizeDocument(docNumber);
  const tipoPessoa = docType
    ? (docType.toUpperCase() === 'CNPJ' ? 'J' : docType.toUpperCase() === 'CPF' ? 'F' : detectTipoPessoaFromDoc(documentoNormalizado))
    : detectTipoPessoaFromDoc(documentoNormalizado);

  const resolvedUf = normalizeUf(stateCode) || ufFromStateName(stateName);

  return {
    nome: businessName,
    documento: documentoNormalizado,
    tipoPessoa,
    ie: normalizeIe(stateRegistration),
    endereco: {
      street_name: streetName,
      street_number: streetNumber,
      neighborhood,
      city_name: cityName,
      city_id: cityId || undefined,
      state_id: resolvedUf,
      state_name: stateName,
      zip_code: normalizeZip(zipCode),
      country_id: countryId || undefined,
    },
    fieldSources: {
      nome: businessName ? 'billing_info' : 'fallback',
      documento: docNumber ? 'billing_info' : 'fallback',
      tipoPessoa: docType ? 'billing_info' : 'fallback',
      ie: stateRegistration ? 'billing_info' : 'fallback',
      endereco: (streetName || cityName || stateCode || zipCode) ? 'billing_info' : 'fallback',
    },
  };
}

function parseBillingInfoV2FromML(input: any): {
  nome: string;
  documento: string;
  tipoPessoa: string;
  ie: string;
  endereco: BillingSnapshot['endereco'];
  taxpayerType: string | null;
} {
  const b = input?.buyer?.billing_info || {};
  const identification = b?.identification || {};
  const address = b?.address || {};
  const state = address?.state || {};
  const taxes = b?.taxes || {};

  const docType = String(identification?.type || '').trim().toUpperCase();
  const docNumber = normalizeDocument(String(identification?.number || ''));
  const tipoPessoa = docType
    ? (docType === 'CNPJ' ? 'J' : docType === 'CPF' ? 'F' : detectTipoPessoaFromDoc(docNumber))
    : detectTipoPessoaFromDoc(docNumber);

  const stateName = String(state?.name || '').trim();
  const stateCode = String(state?.code || '').trim();
  const resolvedUf = normalizeUf(stateCode) || ufFromStateName(stateName);

  const nome = String(b?.name || '').trim();
  const lastName = String(b?.last_name || '').trim();
  const businessName = String(b?.business_name || '').trim();
  const composedNome = businessName || `${nome} ${lastName}`.trim();

  const ieDirect = normalizeIe(String(b?.state_registration_number || b?.state_registration || ''));
  const ieFromTaxes = normalizeIe(String(taxes?.state_registration?.number || taxes?.state_registration || ''));
  const ie = ieDirect || ieFromTaxes;

  return {
    nome: composedNome,
    documento: docNumber,
    tipoPessoa,
    ie,
    taxpayerType: String(taxes?.taxpayer_type?.description || taxes?.taxpayer_type || '').trim() || null,
    endereco: {
      street_name: String(address?.street_name || '').trim(),
      street_number: String(address?.street_number || '').trim(),
      neighborhood: String(address?.neighborhood || '').trim(),
      city_name: String(address?.city_name || '').trim(),
      city_id: String(address?.city_id || '').trim() || undefined,
      state_id: resolvedUf,
      state_name: stateName,
      zip_code: normalizeZip(String(address?.zip_code || '')),
      country_id: String(address?.country_id || '').trim() || undefined,
    },
  };
}

function pickFirstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

function resolveBillingSnapshot(params: {
  v2: ReturnType<typeof parseBillingInfoV2FromML> | null;
  legacy: ReturnType<typeof parseBillingInfoFromML> | null;
  order: any;
  shipment: any;
  existingAddress: any;
  existingIe: string;
  nickname: string;
}): BillingResolved {
  const { v2, legacy, order, shipment, existingAddress, existingIe, nickname } = params;
  const receiver = shipment?.receiver_address || order?.shipping?.receiver_address || {};
  const receiverStateCode = normalizeUf(receiver?.state?.id || receiver?.state_id || receiver?.state_code || '');
  const receiverStateName = String(receiver?.state?.name || receiver?.state_name || '').trim();
  const receiverUf = receiverStateCode || ufFromStateName(receiverStateName);

  const orderBuyerDoc = normalizeDocument(order?.buyer?.billing_info?.doc_number || order?.buyer?.billing_info?.doc || '');
  const orderBuyerNome = `${String(order?.buyer?.first_name || '').trim()} ${String(order?.buyer?.last_name || '').trim()}`.trim();

  const documento = pickFirstNonEmpty(
    v2?.documento,
    legacy?.documento,
    orderBuyerDoc,
  );
  const tipoPessoa = detectTipoPessoaFromDoc(documento);
  const ie = pickFirstNonEmpty(v2?.ie, legacy?.ie, existingIe);

  const stateId = pickFirstNonEmpty(
    v2?.endereco?.state_id,
    legacy?.endereco?.state_id,
    receiverUf,
    normalizeUf(existingAddress?.state_id),
  );
  const cityName = pickFirstNonEmpty(
    v2?.endereco?.city_name,
    legacy?.endereco?.city_name,
    receiver?.city?.name,
    receiver?.city_name,
    existingAddress?.city_name,
  );
  const zipCode = normalizeZip(pickFirstNonEmpty(
    v2?.endereco?.zip_code,
    legacy?.endereco?.zip_code,
    receiver?.zip_code,
    existingAddress?.zip_code,
  ));

  const nome = pickFirstNonEmpty(
    v2?.nome,
    legacy?.nome,
    orderBuyerNome,
    nickname,
  );

  const fieldSources: BillingResolved['fieldSources'] = {
    documento: v2?.documento ? 'v2_billing' : legacy?.documento ? 'legacy_billing' : orderBuyerDoc ? 'order' : 'fallback',
    uf: v2?.endereco?.state_id ? 'v2_billing' : legacy?.endereco?.state_id ? 'legacy_billing' : receiverUf ? 'shipment' : existingAddress?.state_id ? 'existing' : 'fallback',
    city: v2?.endereco?.city_name ? 'v2_billing' : legacy?.endereco?.city_name ? 'legacy_billing' : (receiver?.city?.name || receiver?.city_name) ? 'shipment' : existingAddress?.city_name ? 'existing' : 'fallback',
    cep: v2?.endereco?.zip_code ? 'v2_billing' : legacy?.endereco?.zip_code ? 'legacy_billing' : receiver?.zip_code ? 'shipment' : existingAddress?.zip_code ? 'existing' : 'fallback',
    ie: v2?.ie ? 'v2_billing' : legacy?.ie ? 'legacy_billing' : existingIe ? 'existing' : 'fallback',
    nome: v2?.nome ? 'v2_billing' : legacy?.nome ? 'legacy_billing' : orderBuyerNome ? 'order' : 'fallback',
  };

  return {
    nome,
    documento,
    tipoPessoa,
    ie,
    endereco: {
      street_name: pickFirstNonEmpty(v2?.endereco?.street_name, legacy?.endereco?.street_name, receiver?.address_line, receiver?.street_name, existingAddress?.street_name),
      street_number: pickFirstNonEmpty(v2?.endereco?.street_number, legacy?.endereco?.street_number, receiver?.street_number, existingAddress?.street_number),
      neighborhood: pickFirstNonEmpty(v2?.endereco?.neighborhood, legacy?.endereco?.neighborhood, receiver?.neighborhood, existingAddress?.neighborhood),
      city_name: cityName,
      city_id: pickFirstNonEmpty(v2?.endereco?.city_id, legacy?.endereco?.city_id, receiver?.city?.id, receiver?.city_id, existingAddress?.city_id) || undefined,
      state_id: stateId,
      state_name: pickFirstNonEmpty(v2?.endereco?.state_name, legacy?.endereco?.state_name, receiverStateName, existingAddress?.state_name),
      zip_code: zipCode,
      country_id: pickFirstNonEmpty(v2?.endereco?.country_id, legacy?.endereco?.country_id, receiver?.country?.id, receiver?.country_id, existingAddress?.country_id) || undefined,
    },
    fieldSources,
  };
}

async function fetchMLResultWithRetry<T>(path: string): Promise<{ result: MLRequestResult<T>; retries: number }> {
  return fetchMLResultWithRetryConfig(path);
}

async function fetchMLResultWithRetryConfig<T>(
  path: string,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<{ result: MLRequestResult<T>; retries: number }> {
  let retries = 0;
  const attempts = Math.max(1, Number(options?.attempts || TRANSIENT_RETRY_ATTEMPTS));
  const baseDelayMs = Math.max(100, Number(options?.baseDelayMs || TRANSIENT_RETRY_BASE_DELAY_MS));

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await fetchMLResult<T>(path);

    if (result.ok) {
      return { result, retries };
    }

    const isRetryable = result.error?.category === 'retryable';
    const hasNextAttempt = attempt < attempts - 1;

    if (!isRetryable || !hasNextAttempt) {
      return { result, retries };
    }

    retries += 1;
    await sleep(baseDelayMs * (attempt + 1));
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

function classificarMotivoDevolucao(raw: unknown): string | null {
  const texto = Array.isArray(raw) ? raw.join(' ') : String(raw || '');
  const normalizado = texto.toLowerCase();
  if (/repentant|changed_mind|return_request|not_expected|desist|arrepende/.test(normalizado)) return 'Desistência';
  if (/damaged|defect|defective|not_working|broken|fault|defeito|avaria/.test(normalizado)) return 'Outro Motivo';
  if (/receiver_absent|destinat[aá]rio[_ ]ausente/.test(normalizado)) return 'Destinatário ausente';
  return null;
}

type DevolucaoMl = {
  status: string;
  destinoEstoqueInterno: boolean;
  entradaElegivelEstoque: boolean;
};

async function buscarClaims(orderId: string | number): Promise<{
  id: string | null;
  status: string | null;
  isDevolvido: boolean;
  motivoDevolucao: string | null;
  devolucao: DevolucaoMl | null;
}> {
  try {
    const search = await fetchML<any>(`/post-purchase/v1/claims/search?resource_id=${orderId}&resource=order`);
    if (search?.data && Array.isArray(search.data) && search.data.length > 0) {
      const claim = search.data[0];
      const claimId = String(claim.id || '').trim();
      const isDevolvido = claim.resolution?.reason === 'item_returned' ||
                          claim.resolution?.closed_by === 'mediator' &&
                          claim.resolution?.benefited?.includes('complainant');
      // A busca resumida de claims nem sempre traz a causa e as entidades relacionadas.
      // Busca o claim completo para classificar a devolução com a informação do ML.
      const claimDetalhado = claimId
        ? await fetchML<any>(`/post-purchase/v1/claims/${encodeURIComponent(claimId)}`).catch(() => null)
        : null;
      const fonteClaim = claimDetalhado || claim;
      let motivoDevolucao = classificarMotivoDevolucao([
        fonteClaim.reason_id,
        fonteClaim.reason?.name,
        fonteClaim.reason?.detail,
        ...(fonteClaim.reason?.settings?.rules_engine_triage || []),
      ]);

      let devolucao: DevolucaoMl | null = null;
      // A devolução é um recurso próprio do ML e pode existir mesmo quando o resumo
      // do claim ainda não marcou `related_entities` nem a resolução final.
      const retorno = claimId
        ? await fetchML<any>(`/post-purchase/v2/claims/${encodeURIComponent(claimId)}/returns`).catch(() => null)
        : null;
      if (retorno?.id && retorno?.status) {
        const enviosRetorno = Array.isArray(retorno?.shipments) ? retorno.shipments : [];
        // Só há estoque interno quando o ML envia para o endereço do seller.
        // Centros logísticos do ML e endereços de fornecedor não representam item recebido pela Vortek.
        const envioRetorno = enviosRetorno.find((envio: any) => envio?.destination?.name === 'seller_address') || enviosRetorno[0];
        const statusEnvio = String(envioRetorno?.status || '').trim();
        const entregueNoCentroLogistico = statusEnvio === 'delivered' && envioRetorno?.destination?.name === 'warehouse';
        const destinoEstoqueInterno = envioRetorno?.destination?.name === 'seller_address';
        devolucao = {
          // `delivered` no retorno pode significar entregue a um centro do ML,
          // e não ao estoque físico da Vortek.
          status: entregueNoCentroLogistico ? 'delivered_warehouse' : (statusEnvio || String(retorno.status)),
          destinoEstoqueInterno,
          entradaElegivelEstoque: destinoEstoqueInterno && !['cancelled', 'failed', 'expired', 'not_delivered', 'return_to_buyer'].includes(statusEnvio),
        };
      }

      const reasonId = String(fonteClaim.reason_id || fonteClaim.reason?.id || '').trim();
      if (devolucao && !motivoDevolucao && reasonId) {
        const reason = await fetchML<any>(`/post-purchase/v1/claims/reasons/${encodeURIComponent(reasonId)}`).catch(() => null);
        motivoDevolucao = classificarMotivoDevolucao([
          reason?.name,
          reason?.detail,
          ...(reason?.settings?.rules_engine_triage || []),
        ]);
      }
      return {
        id: claimId || null,
        status: fonteClaim.status || null,
        isDevolvido,
        motivoDevolucao,
        devolucao,
      };
    }
  } catch (err: any) {
    console.error(`[sync-pedidos] Erro ao buscar claims do pedido ${orderId}:`, err?.message);
  }
  return { id: null, status: null, isDevolvido: false, motivoDevolucao: null, devolucao: null };
}

type SyncOrderResult = {
  salvo: boolean;
  semShipment: number;
  authFailures: number;
  authFatal: boolean;
  retriesTransient: number;
  durationMs: number;
};

async function resolvePackId(params: {
  order: any;
  detail: any;
  existingPackId: string | null;
}): Promise<{ packId: string | null; source: string }> {
  const fromDetail = params.detail?.pack_id ? String(params.detail.pack_id) : null;
  if (fromDetail) return { packId: fromDetail, source: 'order_detail' };

  const fromSearch = params.order?.pack_id ? String(params.order.pack_id) : null;
  if (fromSearch) return { packId: fromSearch, source: 'orders_search' };

  try {
    const detailAlt = await fetchML<any>(`/orders/${params.order.id}`, { headers: { 'x-format-new': 'true' } });
    const fromAlt = detailAlt?.pack_id ? String(detailAlt.pack_id) : null;
    if (fromAlt) return { packId: fromAlt, source: 'order_detail_alt' };
  } catch {
    // ignora
  }

  if (params.existingPackId) return { packId: params.existingPackId, source: 'existing_db' };
  return { packId: null, source: 'not_found' };
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

  const { data: existingRows, error: existingError } = await serviceClient
    .from('clientes')
    .select('id')
    .eq('ml_id', payload.buyerId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (existingError) {
    console.error('[sync-pedidos] Erro ao buscar cliente existente:', existingError.message);
  }

  const existing = existingRows?.[0];

  if (existing?.id) {
    const { error: updateError } = await serviceClient
      .from('clientes')
      .update(basePayload as any)
      .eq('id', existing.id);

    if (updateError) {
      console.error('[sync-pedidos] Erro ao atualizar cliente existente:', updateError.message);
    }
    return;
  }

  const { error: insertError } = await serviceClient
    .from('clientes')
    .insert(basePayload as any);

  if (insertError) {
    console.error('[sync-pedidos] Erro ao inserir cliente:', insertError.message);
  }
}

async function buildOrderItemsSnapshot(params: {
  serviceClient: ReturnType<typeof createServiceClient>;
  orderItems: any[];
  emitUf: string | null;
  destUf: string | null;
  freteTotal: number;
}): Promise<OrderItemSnapshot[]> {
  const { serviceClient, orderItems, emitUf, destUf, freteTotal } = params;
  const itemIds = Array.from(new Set(orderItems.map((it) => String(it?.item?.id || '')).filter(Boolean)));
  const skus = Array.from(new Set(orderItems.map((it) => String(it?.item?.seller_sku || '').trim()).filter(Boolean)));
  const skuLookupVariants = Array.from(new Set(skus.flatMap((sku) => getSkuLookupVariants(sku))));

  let productsByMlItem = new Map<string, any>();
  let productsBySku = new Map<string, any>();

  if (itemIds.length > 0) {
    const { data } = await serviceClient
      .from('produtos')
      .select('ml_item_id,sku,ncm,cest,gtin,origem_fiscal,csosn')
      .in('ml_item_id', itemIds);
    productsByMlItem = new Map((data || []).map((p: any) => [String(p.ml_item_id || ''), p]));
  }
  if (skuLookupVariants.length > 0) {
    const { data } = await serviceClient
      .from('produtos')
      .select('ml_item_id,sku,ncm,cest,gtin,origem_fiscal,csosn')
      .in('sku', skuLookupVariants);
    productsBySku = new Map((data || []).map((p: any) => [String(p.sku || ''), p]));

    const [{ data: offersBySku }, { data: offersBySupplierSku }] = await Promise.all([
      serviceClient
        .from('produto_fornecedor_ofertas')
        .select('produto_id,sku_oferta')
        .in('sku_oferta', skuLookupVariants),
      serviceClient
        .from('produto_fornecedor_ofertas')
        .select('produto_id,sku_fornecedor')
        .in('sku_fornecedor', skuLookupVariants),
    ]);
    const offerProductIds = Array.from(new Set([
      ...((offersBySku || []) as any[]).map((row) => String(row.produto_id || '').trim()),
      ...((offersBySupplierSku || []) as any[]).map((row) => String(row.produto_id || '').trim()),
    ].filter(Boolean)));

    if (offerProductIds.length > 0) {
      const { data: offerProducts } = await serviceClient
        .from('produtos')
        .select('id,ml_item_id,sku,ncm,cest,gtin,origem_fiscal,csosn')
        .in('id', offerProductIds);
      const productsById = new Map((offerProducts || []).map((p: any) => [String(p.id || ''), p]));

      for (const offer of (offersBySku || []) as any[]) {
        const product = productsById.get(String(offer.produto_id || ''));
        if (!product) continue;
        const offerSku = String(offer.sku_oferta || '');
        productsBySku.set(offerSku, product);
        for (const sku of skus) {
          if (getSkuLookupVariants(sku).includes(offerSku)) productsBySku.set(sku, product);
        }
      }
      for (const offer of (offersBySupplierSku || []) as any[]) {
        const product = productsById.get(String(offer.produto_id || ''));
        if (!product) continue;
        const offerSku = String(offer.sku_fornecedor || '');
        productsBySku.set(offerSku, product);
        for (const sku of skus) {
          if (getSkuLookupVariants(sku).includes(offerSku)) productsBySku.set(sku, product);
        }
      }
    }
  }

  const totalQtd = orderItems.reduce((sum, it) => sum + Number(it?.quantity || 0), 0);
  const cfop = getExpectedCfopByUf(emitUf, destUf);

  return orderItems.map((it) => {
    const mlItemId = String(it?.item?.id || '').trim() || null;
    const sellerSku = String(it?.item?.seller_sku || '').trim() || null;
    const quantidade = Number(it?.quantity || 0);
    const valorUnitario = Number(it?.unit_price || 0);
    const valorBase = Number(it?.full_unit_price || valorUnitario);
    const valorTotalBruto = Number((valorBase * quantidade).toFixed(2));
    const valorTotalLiquido = Number((valorUnitario * quantidade).toFixed(2));
    const descontoItem = Number((valorTotalBruto - valorTotalLiquido).toFixed(2));
    const freteRateado = totalQtd > 0
      ? Number(((freteTotal * quantidade) / totalQtd).toFixed(2))
      : 0;

    const skuVariants = getSkuLookupVariants(sellerSku);
    const produto = (mlItemId && productsByMlItem.get(mlItemId))
      || (sellerSku && productsBySku.get(sellerSku))
      || skuVariants.map((variant) => productsBySku.get(variant)).find(Boolean)
      || null;

    return {
      ml_item_id: mlItemId,
      seller_sku: sellerSku,
      titulo: String(it?.item?.title || it?.item?.description || 'Item sem título'),
      quantidade,
      unidade: String(it?.item?.unit || 'UN'),
      valor_unitario: valorUnitario,
      valor_total_bruto: valorTotalBruto,
      desconto_item: descontoItem > 0 ? descontoItem : 0,
      frete_rateado_item: freteRateado,
      valor_total_liquido: Number((valorTotalLiquido + freteRateado).toFixed(2)),
      ncm: produto?.ncm || null,
      cest: produto?.cest || null,
      gtin: produto?.gtin || null,
      origem_fiscal: produto?.origem_fiscal || null,
      csosn: produto?.csosn || null,
      cfop_sugerido: cfop,
    };
  });
}

function buildOrderSnapshot(params: {
  detail: any;
  billingSnapshot: BillingSnapshot;
  items: OrderItemSnapshot[];
  source: 'ml_live' | 'local_fallback';
  freteTotal: number;
  emitUf: string | null;
}): OrderFiscalSnapshot {
  const { detail, billingSnapshot, items, source, freteTotal, emitUf } = params;
  const paymentsRaw = Array.isArray(detail?.payments) ? detail.payments : [];
  const pagamentos: PaymentSnapshot[] = paymentsRaw.map((p: any) => ({
    id: p?.id ? String(p.id) : null,
    status: p?.status ? String(p.status) : null,
    payment_type: p?.payment_type || p?.payment_method_id || null,
    total_paid_amount: Number(p?.total_paid_amount || p?.transaction_amount || 0),
    date_approved: p?.date_approved ? String(p.date_approved) : null,
  }));
  const saleDate = resolveOrderSaleDate(detail);

  const totalProdutos = Number(items.reduce((sum, it) => sum + (it.valor_total_bruto || 0), 0).toFixed(2));
  const descontoTotal = Number(items.reduce((sum, it) => sum + (it.desconto_item || 0), 0).toFixed(2));
  const totalFinal = Number(detail?.total_amount || 0);

  const pendencias: string[] = [];
  if (items.length === 0) pendencias.push('pedido_sem_itens');
  if (items.some((it) => it.quantidade <= 0 || it.valor_unitario <= 0)) pendencias.push('item_quantidade_ou_valor_invalido');
  if (!isValidCpfCnpj(normalizeDocument(billingSnapshot.documento))) pendencias.push('billing_documento_invalido');
  if (!billingSnapshot.endereco?.state_id || !billingSnapshot.endereco?.zip_code || !billingSnapshot.endereco?.city_name) {
    pendencias.push('billing_endereco_incompleto');
  }
  if (!String(billingSnapshot.endereco?.cod_municipio || '').trim()) {
    pendencias.push('billing_cod_municipio_ausente');
  }
  if (!emitUf) {
    pendencias.push('empresa_uf_emitente_ausente');
  }
  if (billingSnapshot.tipoPessoa === 'J' && !billingSnapshot.ie) {
    const iePolicy = resolveDestIePolicy({
      documento: normalizeDocument(billingSnapshot.documento),
      billingIe: billingSnapshot.ie,
      taxpayerTypeMlRaw: billingSnapshot.endereco?.taxpayer_type_ml_raw || null,
    });
    if (iePolicy.ieRequired) {
      pendencias.push('billing_ie_ausente_cnpj');
    }
  }
  if (items.some((it) => !it.ncm)) pendencias.push('item_sem_ncm');

  const totalCalculadoComFrete = Number((items.reduce((sum, it) => sum + (it.valor_total_liquido || 0), 0)).toFixed(2));
  const totalCalculadoSemFrete = Number((items.reduce((sum, it) => sum + ((it.valor_total_liquido || 0) - (it.frete_rateado_item || 0)), 0)).toFixed(2));
  const divergeComFrete = Math.abs(totalCalculadoComFrete - totalFinal) > SNAPSHOT_TOTAL_TOLERANCE;
  const divergeSemFrete = Math.abs(totalCalculadoSemFrete - totalFinal) > SNAPSHOT_TOTAL_TOLERANCE;
  if (divergeComFrete && divergeSemFrete) {
    pendencias.push('divergencia_total');
  }

  return {
    source,
    buyerMlId: detail?.buyer?.id ? String(detail.buyer.id) : null,
    saleDate,
    billing: billingSnapshot,
    pagamentos,
    itens: items,
    totais: {
      total_produtos: totalProdutos,
      frete_total: Number(freteTotal.toFixed(2)),
      desconto_total: descontoTotal,
      total_final: totalFinal,
      total_calculado_com_frete: totalCalculadoComFrete,
      total_calculado_sem_frete: totalCalculadoSemFrete,
    },
    incompleto: pendencias.length > 0,
    pendencias,
  };
}

async function processOrder(params: {
  order: any;
  serviceClient: ReturnType<typeof createServiceClient>;
}): Promise<SyncOrderResult> {
  const startedAt = Date.now();
  const { order: o, serviceClient } = params;

  let semShipment = 0;
  let authFailures = 0;
  let authFatal = false;
  let retriesTransient = 0;
  let existingPackId: string | null = null;
  let existingPedidoId: string | null = null;

  const { data: existingPedido } = await serviceClient
    .from('pedidos')
    .select('id, ml_pack_id, billing_ie, billing_endereco, ml_fiscal_release_at, ml_claim_id')
    .eq('ml_order_id', String(o.id))
    .maybeSingle();
  existingPackId = existingPedido?.ml_pack_id ? String(existingPedido.ml_pack_id) : null;
  existingPedidoId = existingPedido?.id ? String(existingPedido.id) : null;
  const existingBillingIe = normalizeIe((existingPedido as any)?.billing_ie || '');
  const existingBillingEndereco = (existingPedido as any)?.billing_endereco || {};

  // 1. Detalhes completos do pedido (first_name, last_name)
  const detail = await fetchML<any>(`/orders/${o.id}`).catch(() => null);
  const sourceOrder = detail || o;
  const buyer = sourceOrder?.buyer || o.buyer;

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
  const billingSnapshot: BillingSnapshot = {
    nome: '',
    documento: '',
    tipoPessoa: '',
    ie: null,
    endereco: {
      street_name: '',
      street_number: '',
      neighborhood: '',
      city_name: '',
      state_id: '',
      state_name: '',
      zip_code: '',
    },
  };
  try {
    const buyerId = buyer?.id;
    if (buyerId) {
      const billingInfoId = sourceOrder?.buyer?.billing_info?.id || o?.buyer?.billing_info?.id || null;
      const siteId = String(sourceOrder?.site_id || o?.site_id || 'MLB');

      let parsedV2: ReturnType<typeof parseBillingInfoV2FromML> | null = null;
      if (billingInfoId) {
        const billingV2Result = await fetchMLResultWithRetry<any>(`/orders/billing-info/${siteId}/${billingInfoId}`);
        retriesTransient += billingV2Result.retries;
        if (billingV2Result.result.ok && billingV2Result.result.data?.buyer?.billing_info) {
          try {
            parsedV2 = parseBillingInfoV2FromML(billingV2Result.result.data);
          } catch {
            parsedV2 = null;
          }
        }
      }

      const billingLegacyResult = await fetchMLResultWithRetry<any>(`/orders/${o.id}/billing_info`);
      retriesTransient += billingLegacyResult.retries;
      let parsedLegacy: ReturnType<typeof parseBillingInfoFromML> | null = null;
      if (billingLegacyResult.result.ok && billingLegacyResult.result.data?.billing_info) {
        try {
          parsedLegacy = parseBillingInfoFromML(billingLegacyResult.result.data);
        } catch {
          parsedLegacy = null;
        }
      }

      const resolvedBilling = resolveBillingSnapshot({
        v2: parsedV2,
        legacy: parsedLegacy,
        order: sourceOrder,
        shipment: sourceOrder?.shipping || null,
        existingAddress: existingBillingEndereco,
        existingIe: existingBillingIe,
        nickname,
      });

      const nomeReal = resolvedBilling.nome || nickname || 'Desconhecido';
      const clienteNome = nomeReal ? `${nomeReal} (${nickname})` : nickname || 'Desconhecido';
      const documento = normalizeDocument(resolvedBilling.documento);
      const tipoPessoa = resolvedBilling.tipoPessoa || detectTipoPessoaFromDoc(documento);
      const normalizedIe = normalizeIe(resolvedBilling.ie) || existingBillingIe || '';
      const taxpayerTypeMlRaw = String(parsedV2?.taxpayerType || '').trim()
        || String((existingBillingEndereco as any)?.taxpayer_type_ml_raw || '').trim()
        || null;
      const iePolicy = resolveDestIePolicy({
        documento,
        billingIe: normalizedIe,
        taxpayerTypeMlRaw,
      });
      const municipio = await resolveCodMunicipio({
        client: serviceClient as any,
        uf: resolvedBilling.endereco.state_id,
        cityName: resolvedBilling.endereco.city_name,
        zipCode: resolvedBilling.endereco.zip_code,
      });
      billingSnapshot.nome = nomeReal;
      billingSnapshot.documento = documento;
      billingSnapshot.tipoPessoa = tipoPessoa;
      billingSnapshot.ie = normalizedIe || null;
      billingSnapshot.endereco = {
        street_name: resolvedBilling.endereco.street_name,
        street_number: resolvedBilling.endereco.street_number,
        neighborhood: resolvedBilling.endereco.neighborhood,
        city_name: resolvedBilling.endereco.city_name,
        city_id: resolvedBilling.endereco.city_id,
        cod_municipio: municipio.codMunicipio || String(existingBillingEndereco?.cod_municipio || '').trim() || undefined,
        state_id: normalizeUf(resolvedBilling.endereco.state_id),
        state_name: resolvedBilling.endereco.state_name,
        zip_code: normalizeZip(resolvedBilling.endereco.zip_code),
        country_id: resolvedBilling.endereco.country_id,
        taxpayer_type_ml_raw: iePolicy.taxpayerTypeMlRaw,
        ie_policy_resolved: iePolicy.iePolicyResolved,
      };

      const enderecoParts = [
        billingSnapshot.endereco.street_name,
        billingSnapshot.endereco.street_number,
        billingSnapshot.endereco.neighborhood,
        billingSnapshot.endereco.city_name,
        billingSnapshot.endereco.state_name,
        billingSnapshot.endereco.zip_code,
      ].filter(Boolean);
      const endereco = enderecoParts.length > 0
        ? `${billingSnapshot.endereco.street_name}${billingSnapshot.endereco.street_number ? ', ' + billingSnapshot.endereco.street_number : ''}${billingSnapshot.endereco.neighborhood ? ' - ' + billingSnapshot.endereco.neighborhood : ''}${billingSnapshot.endereco.city_name ? ', ' + billingSnapshot.endereco.city_name : ''}${billingSnapshot.endereco.state_name ? ' - ' + billingSnapshot.endereco.state_name : ''}${billingSnapshot.endereco.zip_code ? ', CEP ' + billingSnapshot.endereco.zip_code : ''}`
        : '';

      await upsertCliente(serviceClient, {
        buyerId: String(buyerId),
        nickname,
        nome: clienteNome,
        documento,
        tipoPessoa,
        endereco,
      });

      await registrarEventoNfAuditoria({
        pedidoId: existingPedidoId,
        mlOrderId: String(o.id),
        evento: 'sync_snapshot_start',
        respostaMl: {
          billing_info_id: billingInfoId || null,
          fieldSources: {
            documento_source: resolvedBilling.fieldSources.documento,
            uf_source: resolvedBilling.fieldSources.uf,
            city_source: resolvedBilling.fieldSources.city,
            cep_source: resolvedBilling.fieldSources.cep,
            ie_source: resolvedBilling.fieldSources.ie,
            cod_municipio_source: municipio.source,
            cod_municipio_reason: municipio.reason || null,
            taxpayer_type_ml_raw: iePolicy.taxpayerTypeMlRaw,
            ie_policy_resolved: iePolicy.iePolicyResolved,
          },
        },
        statusResultante: 'billing_resolved',
      });
    }
  } catch (err: any) {
    console.error(`[sync-pedidos] Erro ao salvar cliente do pedido ${o.id}:`, err?.message || err);
  }

  if (!billingSnapshot.nome) {
    billingSnapshot.nome = `${buyer?.first_name || ''} ${buyer?.last_name || ''}`.trim() || nickname || 'Desconhecido';
  }
  if (!billingSnapshot.documento) {
    billingSnapshot.documento = normalizeDocument(String(sourceOrder?.buyer?.billing_info?.doc_number || ''));
  }
  if (!billingSnapshot.tipoPessoa) {
    billingSnapshot.tipoPessoa = detectTipoPessoaFromDoc(normalizeDocument(billingSnapshot.documento));
  }
  if (!billingSnapshot.ie && existingBillingIe) {
    billingSnapshot.ie = existingBillingIe;
  }
  if (!billingSnapshot.endereco?.taxpayer_type_ml_raw) {
    billingSnapshot.endereco.taxpayer_type_ml_raw = String((existingBillingEndereco as any)?.taxpayer_type_ml_raw || '').trim() || null;
  }
  if (!billingSnapshot.endereco?.ie_policy_resolved) {
    const iePolicy = resolveDestIePolicy({
      documento: normalizeDocument(billingSnapshot.documento),
      billingIe: billingSnapshot.ie,
      taxpayerTypeMlRaw: billingSnapshot.endereco?.taxpayer_type_ml_raw || null,
    });
    billingSnapshot.endereco.ie_policy_resolved = iePolicy.iePolicyResolved;
  }

  // 3. Claims: buscar reclamações via endpoint de search
  const {
    id: claimIdFromSearch,
    status: claimStatusFromSearch,
    isDevolvido,
    motivoDevolucao: motivoClaim,
    devolucao: devolucaoMl,
  } = await buscarClaims(o.id);

  // 4. Status: usa tags 'delivered'/'not_delivered' para refinar (considerando devolução)
  const tags: string[] = sourceOrder?.tags || o.tags || [];
  let situacao = determinarSituacao(sourceOrder?.status || o.status, tags, isDevolvido);

  // 5. NF-e via ML desativada por política: sync não importa nem sobrescreve campos fiscais.
  const packResolution = await resolvePackId({
    order: o,
    detail,
    existingPackId,
  });
  const mlPackId = packResolution.packId;
  await registrarEventoNfAuditoria({
    pedidoId: existingPedidoId,
    mlOrderId: String(o.id),
    mlPackId,
    evento: 'ml_fiscal_sync_ignored',
    respostaMl: {
      motivo: 'fiscal_ml_desativado_por_politica',
      escopo: 'sync_pedidos',
    },
    statusResultante: 'ignored',
  });

  // 6. Shipment: buscar ml_shipment_id e status detalhado (uma única chamada por pedido)
  let mlShipmentId: string | null = null;
  let shipmentDetail: any = null;
  let motivoDevolucao = motivoClaim;
  let releaseWindowCheckOk = false;
  let releaseWindow = extractMlFiscalReleaseWindow({ shipment: null, leadTime: null });
  const situacaoAnteriorShipment = situacao;

  try {
    const shipmentFetch = await fetchMLResultWithRetry<any>(`/orders/${o.id}/shipments`);
    retriesTransient += shipmentFetch.retries;
    const shipmentResult = shipmentFetch.result;

    if (shipmentResult.ok && shipmentResult.data?.id) {
      shipmentDetail = shipmentResult.data;
      mlShipmentId = String(shipmentDetail.id);
      if (shipmentDetail?.substatus === 'receiver_absent') {
        motivoDevolucao = 'Destinatário ausente';
      }

      const leadTimeFetch = await fetchMLResultWithRetry<any>(`/shipments/${mlShipmentId}/lead_time`);
      retriesTransient += leadTimeFetch.retries;
      const leadTimeResult = leadTimeFetch.result;
      if (leadTimeResult.ok) {
        releaseWindowCheckOk = true;
        releaseWindow = extractMlFiscalReleaseWindow({
          shipment: shipmentDetail,
          leadTime: leadTimeResult.data,
        });
      } else {
        console.error(
          `[sync-pedidos] Falha ao consultar lead_time do shipment ${mlShipmentId} (order ${o.id}): status=${leadTimeResult.status || 0} message=${leadTimeResult.error?.message || 'erro_desconhecido'}`,
        );
      }

      if (situacao !== 'devolvido') {
        const shipStatus = shipmentDetail.status;
        const shipSubstatus = shipmentDetail.substatus;
        if (shipStatus) {
          situacao = mapearStatusShipment(shipStatus, shipSubstatus);
          if (situacao !== situacaoAnteriorShipment) {
            console.log(JSON.stringify({
              event: 'sync_pedidos_shipment_status_transition',
              pedido: String(o.id),
              shipment_id: mlShipmentId,
              shipment_status: shipStatus,
              shipment_substatus: shipSubstatus || null,
              situacao_anterior: situacaoAnteriorShipment,
              situacao_nova: situacao,
              timestamp_utc: new Date().toISOString(),
            }));
          }
        }
      }
    } else if (!shipmentResult.ok && shipmentResult.error?.status === 404) {
      semShipment++;
    } else if (!shipmentResult.ok && shipmentResult.error?.category === 'auth_fatal') {
      authFailures++;
      authFatal = true;
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

  const freteTotal = Number(shipmentDetail?.shipping_option?.cost || sourceOrder?.shipping_cost || o.shipping_cost || 0);
  const destUf = String(billingSnapshot.endereco.state_id || '').trim().toUpperCase() || null;
  const { data: empresaData } = await serviceClient
    .from('empresa')
    .select('endereco,uf_fiscal')
    .limit(1)
    .maybeSingle();
  const emitUfDecision = resolveEmitUfForFiscal(empresaData || null);
  const emitUf = emitUfDecision.emitUf;
  if (emitUfDecision.source === 'endereco_fallback') {
    await registrarEventoNfAuditoria({
      pedidoId: existingPedidoId,
      mlOrderId: String(o.id),
      mlPackId,
      evento: 'empresa_uf_fallback_endereco',
      respostaMl: {
        emit_uf_source: 'endereco_fallback',
        emit_uf_value: emitUf,
        dest_uf_value: destUf,
      },
      statusResultante: 'warning',
    });
  } else if (!emitUf) {
    await registrarEventoNfAuditoria({
      pedidoId: existingPedidoId,
      mlOrderId: String(o.id),
      mlPackId,
      evento: 'empresa_fiscal_config_missing',
      respostaMl: {
        campo: 'empresa.uf_fiscal',
        emit_uf_source: 'missing',
        emit_uf_value: null,
        dest_uf_value: destUf,
      },
      statusResultante: 'missing_emit_uf',
    });
  }

  let snapshot: OrderFiscalSnapshot | null = null;
  if (ORDER_SNAPSHOT_V2_ENABLED) {
    const orderItems = Array.isArray(detail?.order_items) ? detail.order_items : [];
    const itemsSnapshot = await buildOrderItemsSnapshot({
      serviceClient,
      orderItems,
      emitUf,
      destUf,
      freteTotal,
    });
    snapshot = buildOrderSnapshot({
      detail,
      billingSnapshot,
      items: itemsSnapshot,
      source: 'ml_live',
      freteTotal,
      emitUf,
    });
    await registrarEventoNfAuditoria({
      mlOrderId: String(o.id),
      mlPackId,
      evento: 'sync_snapshot_start',
      respostaMl: {
        items_count: itemsSnapshot.length,
        source: snapshot.source,
        emit_uf_source: emitUfDecision.source,
        emit_uf_value: emitUf,
        dest_uf_value: destUf,
        fields_source: {
          billing: 'billing_info',
          order: 'orders',
        },
        totais_diagnostico: {
          total_calculado_com_frete: snapshot.totais.total_calculado_com_frete,
          total_calculado_sem_frete: snapshot.totais.total_calculado_sem_frete,
          total_final_ml: snapshot.totais.total_final,
          tolerancia: SNAPSHOT_TOTAL_TOLERANCE,
        },
        data_venda: {
          value: snapshot.saleDate.value,
          source: snapshot.saleDate.source,
        },
        destinatario_ie_policy: {
          taxpayer_type_ml_raw: snapshot.billing.endereco?.taxpayer_type_ml_raw || null,
          ie_policy_resolved: snapshot.billing.endereco?.ie_policy_resolved || null,
          ie_present: Boolean(snapshot.billing.ie),
        },
      },
      statusResultante: 'started',
    });
  }

  const hasFutureRelease = Boolean(releaseWindow.releaseAt && releaseWindow.isBlockedNow);
  const hadReleaseBefore = Boolean((existingPedido as any)?.ml_fiscal_release_at);

  const { data: upsertedPedido, error } = await serviceClient.from('pedidos').upsert({
    ml_order_id: String(o.id),
    ...(mlPackId ? { ml_pack_id: mlPackId } : {}),
    numero: sourceOrder?.id || o.id,
    numero_loja: String(sourceOrder?.id || o.id),
    data: sourceOrder?.date_created || o.date_created,
    data_venda: snapshot?.saleDate.value || sourceOrder?.date_closed || sourceOrder?.date_created || o.date_closed || o.date_created || null,
    data_venda_source: snapshot?.saleDate.source || resolveOrderSaleDate(sourceOrder || o).source,
    contato_nome: contatoNome,
    total: sourceOrder?.total_amount || o.total_amount || 0,
    situacao,
    rastreio,
    lucro: lucro ?? undefined,
    ml_shipment_id: mlShipmentId,
    ml_claim_id: mlClaimId,
    ml_claim_status: mlClaimStatus,
    ...(releaseWindowCheckOk
      ? {
          ml_fiscal_release_at: hasFutureRelease ? releaseWindow.releaseAt : null,
          ml_fiscal_release_reason: hasFutureRelease ? (releaseWindow.reason || 'buffered') : null,
          ml_fiscal_release_source: hasFutureRelease ? (releaseWindow.sourcePath || 'sync_pedidos') : null,
          ml_fiscal_release_checked_at: new Date().toISOString(),
        }
      : {}),
    ...(snapshot ? {
      snapshot_source: snapshot.source,
      snapshot_version: 1,
      snapshot_incompleto: snapshot.incompleto,
      snapshot_pendencias: snapshot.pendencias,
      buyer_ml_id: snapshot.buyerMlId,
      billing_nome: snapshot.billing.nome || null,
      billing_documento: snapshot.billing.documento || null,
      billing_tipo_pessoa: snapshot.billing.tipoPessoa || null,
      billing_ie: snapshot.billing.ie || ((existingPedido as any)?.billing_ie ?? null),
      billing_endereco: snapshot.billing.endereco,
      pagamento_resumo: snapshot.pagamentos,
      totais_snapshot: snapshot.totais,
      sincronizado_em: new Date().toISOString(),
      frete: snapshot.totais.frete_total,
    } : {}),
  } as any, { onConflict: 'ml_order_id' }).select('id').maybeSingle();

  if (!error && upsertedPedido?.id && !existingPedidoId) {
    void alertNewSale({
      id: String(upsertedPedido.id),
      numero: sourceOrder?.id || o.id,
      ml_order_id: String(o.id),
      ml_pack_id: mlPackId,
      contato_nome: contatoNome,
      total: Number(sourceOrder?.total_amount || o.total_amount || 0),
    });
  }

  if (!error && upsertedPedido?.id && mlClaimId && !(existingPedido as any)?.ml_claim_id) {
    void alertClaimOpened({
      id: String(upsertedPedido.id),
      numero: sourceOrder?.id || o.id,
      ml_order_id: String(o.id),
      ml_claim_id: mlClaimId,
      ml_claim_status: mlClaimStatus,
      contato_nome: contatoNome,
    });
  }

  if (!mlPackId) {
    await registrarEventoNfAuditoria({
      pedidoId: upsertedPedido?.id || existingPedidoId || null,
      mlOrderId: String(o.id),
      evento: 'pack_id_pendente',
      respostaMl: {
        motivo: 'pack_id_nao_encontrado_no_sync',
        source: packResolution.source,
      },
      statusResultante: 'warning',
    });
  }

  if (!error && upsertedPedido?.id && releaseWindowCheckOk) {
    if (hasFutureRelease) {
      await registrarEventoNfAuditoria({
        pedidoId: String(upsertedPedido.id),
        mlOrderId: String(o.id),
        mlPackId,
        evento: hadReleaseBefore ? 'ml_fiscal_release_window_updated' : 'ml_fiscal_release_window_detected',
        respostaMl: {
          release_at: releaseWindow.releaseAt,
          reason: releaseWindow.reason || null,
          source_path: releaseWindow.sourcePath,
          checked_at: new Date().toISOString(),
          now_utc: new Date().toISOString(),
          blocked_now: true,
          source: 'sync_pedidos',
        },
        statusResultante: 'blocked',
      });
    } else if (hadReleaseBefore) {
      await registrarEventoNfAuditoria({
        pedidoId: String(upsertedPedido.id),
        mlOrderId: String(o.id),
        mlPackId,
        evento: 'ml_fiscal_release_window_cleared',
        respostaMl: {
          release_at: null,
          reason: releaseWindow.reason || null,
          source_path: releaseWindow.sourcePath,
          checked_at: new Date().toISOString(),
          now_utc: new Date().toISOString(),
          blocked_now: false,
          source: 'sync_pedidos',
        },
        statusResultante: 'cleared',
      });
      void alertMlLabelReleased({
        id: String(upsertedPedido.id),
        numero: sourceOrder?.id || o.id,
        ml_order_id: String(o.id),
        ml_shipment_id: mlShipmentId,
        ml_fiscal_release_at: (existingPedido as any)?.ml_fiscal_release_at || null,
        contato_nome: contatoNome,
        total: Number(sourceOrder?.total_amount || o.total_amount || 0),
        situacao,
      });
    }
  }

  if (!error && snapshot && upsertedPedido?.id) {
    const pedidoId = upsertedPedido.id;
    const items = snapshot.itens;
    const mapped = items.map((it) => ({
      pedido_id: pedidoId,
      ml_order_id: String(o.id),
      ml_item_id: it.ml_item_id,
      seller_sku: it.seller_sku,
      titulo: it.titulo,
      quantidade: it.quantidade,
      unidade: it.unidade,
      valor_unitario: it.valor_unitario,
      valor_total_bruto: it.valor_total_bruto,
      desconto_item: it.desconto_item,
      frete_rateado_item: it.frete_rateado_item,
      valor_total_liquido: it.valor_total_liquido,
      ncm: it.ncm,
      cest: it.cest,
      gtin: it.gtin,
      origem_fiscal: it.origem_fiscal,
      csosn: it.csosn,
      cfop_sugerido: it.cfop_sugerido,
    }));

    await serviceClient.from('pedido_itens').delete().eq('pedido_id', pedidoId);
    if (mapped.length > 0) {
      await serviceClient.from('pedido_itens').insert(mapped as any);
    }
    if (devolucaoMl?.entradaElegivelEstoque) {
      await registrarDevolucaoInterna(
        pedidoId,
        motivoDevolucao || 'Outro Motivo',
        devolucaoMl?.status || 'aguardando_confirmacao',
      );
    } else {
      const shipmentStatus = String(shipmentDetail?.status || '').toLowerCase();
      const shipmentSubstatus = String(shipmentDetail?.substatus || '').toLowerCase();
      if (
        shipmentStatus === 'not_delivered' &&
        ['returning_to_sender', 'returned'].includes(shipmentSubstatus)
      ) {
        await registrarDevolucaoInterna(
          pedidoId,
          motivoDevolucao || 'Entrega não realizada',
          shipmentSubstatus,
        );
      }
    }

    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId: String(o.id),
      mlPackId,
      evento: snapshot.incompleto ? 'sync_snapshot_partial' : 'sync_snapshot_success',
      respostaMl: {
        items_count: mapped.length,
        pendencias: snapshot.pendencias,
        source: snapshot.source,
      },
      statusResultante: snapshot.incompleto ? 'partial' : 'success',
    });
  } else if (snapshot) {
    await registrarEventoNfAuditoria({
      mlOrderId: String(o.id),
      mlPackId,
      evento: 'sync_snapshot_failed',
      respostaMl: { error: error?.message || 'upsert_pedido_failed' },
      statusResultante: 'failed',
    });
  }

  return {
    salvo: !error,
    semShipment,
    authFailures,
    authFatal,
    retriesTransient,
    durationMs: Date.now() - startedAt,
  };
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const startedAt = Date.now();
  const domain = 'pedidos:ml_ingest';
  let lockOwnerToken = '';
  let lockAcquired = false;

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_orders_ingest',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/pedidos' },
    });
    lockOwnerToken = lock.ownerToken;
    lockAcquired = lock.acquired;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_ml_orders_ingest',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { seen: 0, synced: 0, failed: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = 50;
  const forcedMlOrderId = String(searchParams.get('mlOrderId') || body?.mlOrderId || '').trim();
  const watermarkParam = String(searchParams.get('lastUpdatedFrom') || body?.lastUpdatedFrom || '').trim();
  const safetyWindowMinutes = Math.max(1, Math.min(120, Number(body?.safetyWindowMinutes || 15)));

  const meCheck = await fetchMLResultWithRetryConfig<any>('/users/me', { attempts: 3, baseDelayMs: 800 });
  const meResult = meCheck.result;
  if (!meResult.ok || !meResult.data) {
    if (meResult.error?.category === 'auth_fatal') {
      const auth = await getMLAuthDiagnostics();
      return NextResponse.json({
        ok: false,
        error: 'Integração ML requer reconexão para sincronizar pedidos',
        failure_reason: 'auth_fatal',
        auth_state: auth.state,
        auth_blocked_until: auth.blocked_until,
      }, { status: 401 });
    }

    const diagnosticError = {
      code: meResult.error?.code || 'ml_users_me_failed',
      category: meResult.error?.category || 'error',
      upstream_status: meResult.status,
      message: meResult.error?.message || 'Erro ao conectar com ML',
      endpoint: '/users/me',
      retries: meCheck.retries,
    };

    return NextResponse.json({
      ok: false,
      success: false,
      domain,
      erro: diagnosticError.message,
      error: diagnosticError.message,
      failure_reason: 'ml_upstream_error',
      code: diagnosticError.code,
      category: diagnosticError.category,
      upstream_status: diagnosticError.upstream_status,
      errors: [diagnosticError],
      retries_transient: meCheck.retries,
    }, { status: 424 });
  }
  const me = meResult.data;

  let results: any[] = [];
  let total = 0;
  if (forcedMlOrderId) {
    const forcedOrder = await fetchML<any>(`/orders/${encodeURIComponent(forcedMlOrderId)}`);
    if (!forcedOrder?.id) {
      return NextResponse.json({
        ok: false,
        erro: 'Pedido não encontrado no Mercado Livre para sincronização pontual',
        ml_order_id: forcedMlOrderId,
      }, { status: 404 });
    }
    results = [forcedOrder];
    total = 1;
  } else {
    const watermarkKey = 'sync_ml_orders_ingest_watermark';
    const watermarkStored = await getSyncRuntimeConfigValue(watermarkKey);
    const baseFrom = watermarkParam || watermarkStored || '';
    const from = baseFrom
      ? new Date(new Date(baseFrom).getTime() - safetyWindowMinutes * 60 * 1000).toISOString()
      : '';
    const to = new Date().toISOString();

    const query = new URLSearchParams({
      seller: String(me.id),
      limit: String(limit),
      offset: String(offset),
      sort: 'date_asc',
      ...(from ? { 'order.date_last_updated.from': from } : {}),
      ...(to ? { 'order.date_last_updated.to': to } : {}),
    });

    const ordersCheck = await fetchMLResultWithRetryConfig<any>(`/orders/search?${query.toString()}`, { attempts: 3, baseDelayMs: 800 });
    const ordersResult = ordersCheck.result;

    if (!ordersResult.ok || !ordersResult.data) {
      const diagnosticError = {
        code: ordersResult.error?.code || 'ml_orders_search_failed',
        category: ordersResult.error?.category || 'error',
        upstream_status: ordersResult.status,
        message: ordersResult.error?.message || 'Erro ao buscar pedidos',
        endpoint: '/orders/search',
        retries: ordersCheck.retries,
      };

      return NextResponse.json({
        ok: false,
        success: false,
        domain,
        erro: diagnosticError.message,
        error: diagnosticError.message,
        failure_reason: 'ml_upstream_error',
        code: diagnosticError.code,
        category: diagnosticError.category,
        upstream_status: diagnosticError.upstream_status,
        errors: [diagnosticError],
        retries_transient: ordersCheck.retries,
      }, { status: 424 });
    }

    const orders = ordersResult.data;
    results = orders.results || [];
    total = orders.paging?.total || 0;
  }

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
  let abortedByAuth = false;

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
      if (abortedByAuth) {
        break;
      }

      const order = results[currentIndex];
      const processed = await processOrder({
        order,
        serviceClient,
      });
      localResults.push(processed);
      if (processed.authFatal) {
        abortedByAuth = true;
        break;
      }
    }

    return localResults;
  };

  const workerOutputs = await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const processedResults = workerOutputs.flat();

  const salvos = processedResults.filter((r) => r.salvo).length;
  const semShipmentCount = processedResults.reduce((sum, r) => sum + r.semShipment, 0);
  const authFailures = processedResults.reduce((sum, r) => sum + r.authFailures, 0);
  const retriesTransient = processedResults.reduce((sum, r) => sum + r.retriesTransient, 0);
  const semNfCount = 0;
  const nfAutorizada = 0;
  const nfCancelada = 0;
  const nfPendente = 0;
  const totalDurationMs = Date.now() - startedAt;
  const avgDurationMs = processedResults.length > 0
    ? Math.round(processedResults.reduce((sum, r) => sum + r.durationMs, 0) / processedResults.length)
    : 0;

  const proximo = forcedMlOrderId ? null : offset + limit;
  const acabou = forcedMlOrderId ? true : (proximo! >= total || results.length < limit);
  const maxLastUpdated = !forcedMlOrderId
    ? results
        .map((order: any) => String(order?.date_last_updated || order?.last_updated || '').trim())
        .filter(Boolean)
        .sort()
        .pop() || null
    : null;

  if (maxLastUpdated) {
    await setSyncRuntimeConfigValue('sync_ml_orders_ingest_watermark', maxLastUpdated);
  }

  let syncDiagnostico: any = null;
  if (forcedMlOrderId) {
    const { data: pedidoSync } = await serviceClient
      .from('pedidos')
      .select('id,ml_order_id,snapshot_incompleto,snapshot_pendencias,sincronizado_em')
      .eq('ml_order_id', forcedMlOrderId)
      .maybeSingle();
    let itensCount = 0;
    if (pedidoSync?.id) {
      const { count } = await serviceClient
        .from('pedido_itens')
        .select('*', { head: true, count: 'exact' })
        .eq('pedido_id', pedidoSync.id);
      itensCount = count || 0;
    }
    syncDiagnostico = {
      ml_order_id: forcedMlOrderId,
      pedido_id: pedidoSync?.id || null,
      itens_count: itensCount,
      snapshot_incompleto: pedidoSync?.snapshot_incompleto ?? null,
      snapshot_pendencias: pedidoSync?.snapshot_pendencias ?? [],
      sincronizado_em: pedidoSync?.sincronizado_em || null,
    };
  }

  if (abortedByAuth) {
    const auth = await getMLAuthDiagnostics();
    return NextResponse.json({
      ok: false,
      success: false,
      domain,
      error: 'Sincronização abortada por falha de autenticação com ML',
      failure_reason: 'auth_fatal',
      auth_state: auth.state,
      auth_blocked_until: auth.blocked_until,
      sincronizados: salvos,
      auth_failures: authFailures,
      retries_transient: retriesTransient,
      nf_autorizada: nfAutorizada,
      nf_cancelada: nfCancelada,
      nf_pendente: nfPendente,
      duracao_ms_total: totalDurationMs,
      duracao_media_pedido_ms: avgDurationMs,
      processed_count: processedResults.length,
      aborted_by_auth: true,
      job: {
        key: 'sync_ml_orders_ingest',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
    }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    success: true,
    domain,
    job: {
      key: 'sync_ml_orders_ingest',
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      lock_acquired: true,
    },
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
    aborted_by_auth: false,
    cursor: acabou ? null : { offset: proximo, limit },
    records: {
      seen: results.length,
      synced: salvos,
      failed: results.length - salvos,
      sem_shipment: semShipmentCount,
      retries_transient: retriesTransient,
    },
    errors: [],
    duration: { ms: totalDurationMs },
    watermark: maxLastUpdated,
    ...(syncDiagnostico ? { sync_diagnostico: syncDiagnostico } : {}),
  });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      job: {
        key: 'sync_ml_orders_ingest',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      records: { seen: 0, synced: 0, failed: 0 },
      errors: [{ code: 'ml_orders_sync_unexpected_error', message: err?.message || 'Erro inesperado no sync de pedidos ML' }],
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
