import { fetchML, fetchMLRaw, fetchMLResult, getValidMLToken } from './integration';
import { createServiceClient } from '@/lib/supabase';
import { normalizeMlSaleTerms } from '@/lib/ml-sale-terms';

export interface MLCategoryPrediction {
  domain_id: string;
  domain_name: string;
  category_id: string;
  category_name: string;
  attributes: Array<{ id: string; value_id?: string; value_name?: string }>;
}

export interface MLAttribute {
  id: string;
  name: string;
  tags: { required?: boolean; catalog_required?: boolean; fixed?: boolean; hidden?: boolean };
  value_type: 'list' | 'number' | 'string' | 'boolean' | 'number_unit';
  values?: Array<{ id: string; name: string }>;
  allowed_units?: Array<{ id: string; name: string }>;
  default_unit?: string;
  hierarchy?: string;
}

export interface MLCreateItemInput {
  title?: string;
  familyName?: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: 'new' | 'used';
  listingTypeId: 'gold_special' | 'gold_pro';
  description: string;
  pictures: string[];
  attributes: Array<{ id: string; value_name?: string; value_id?: string }>;
  sellerCustomField?: string;
  saleTerms?: Array<{ id: string; value_name?: string; value_id?: string }>;
  fiscalData?: {
    gtin?: string;
    ncm?: string;
    cest?: string;
    csosn?: string;
    net_weight?: number;
    gross_weight?: number;
    measurement_unit?: string;
    origem_fiscal?: string;
    fci?: string;
    ex_tipi?: string;
    cost?: number;
  };
  shipping?: {
    mode?: string;
    localPickUp?: boolean;
    freeShipping?: boolean;
  };
}

export interface MLCreateItemResult {
  id: string;
  title: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  permalink: string;
  thumbnail: string;
  status: string;
}

function sanitizeMlAttributes(
  attrs: Array<{ id: string; value_name?: string; value_id?: string }>,
): Array<{ id: string; value_name?: string; value_id?: string }> {
  const byId = new Map<string, { id: string; value_name?: string; value_id?: string }>();
  for (const attr of attrs || []) {
    const id = String(attr?.id || '').trim().toUpperCase();
    if (!id) continue;

    const valueId = attr?.value_id !== undefined && attr?.value_id !== null
      ? String(attr.value_id).trim()
      : '';
    const valueName = attr?.value_name !== undefined && attr?.value_name !== null
      ? String(attr.value_name).trim()
      : '';
    if (!valueId && !valueName) continue;

    byId.set(id, {
      id,
      ...(valueId ? { value_id: valueId } : {}),
      ...(valueName ? { value_name: valueName } : {}),
    });
  }
  return Array.from(byId.values());
}

function sanitizeMlSaleTerms(
  terms: Array<{ id: string; value_name?: string; value_id?: string }>,
): Array<{ id: string; value_name?: string; value_id?: string }> {
  const sanitized = (terms || [])
    .map((term) => {
      const id = String(term?.id || '').trim().toUpperCase();
      const valueId = term?.value_id !== undefined && term?.value_id !== null ? String(term.value_id).trim() : '';
      const valueName = term?.value_name !== undefined && term?.value_name !== null ? String(term.value_name).trim() : '';
      if (!id || (!valueId && !valueName)) return null;
      return {
        id,
        ...(valueId ? { value_id: valueId } : {}),
        ...(valueName ? { value_name: valueName } : {}),
      };
    })
    .filter(Boolean) as Array<{ id: string; value_name?: string; value_id?: string }>;

  return normalizeMlSaleTerms(sanitized);
}

export async function predictCategory(title: string, limit: number = 3): Promise<MLCategoryPrediction[] | null> {
  const encoded = encodeURIComponent(title);
  return fetchML<MLCategoryPrediction[]>(
    `/sites/MLB/domain_discovery/search?q=${encoded}&limit=${limit}`
  );
}

export async function getCategoryAttributes(categoryId: string): Promise<MLAttribute[] | null> {
  const data = await fetchML<any>(`/categories/${categoryId}/attributes`);
  if (!data) return null;
  return data.filter((a: any) => !a.tags?.hidden);
}

export async function createListing(input: MLCreateItemInput): Promise<MLCreateItemResult | null> {
  const attributes = [...input.attributes];
  const hasSellerSku = attributes.some((a) => a.id.toUpperCase() === 'SELLER_SKU');
  if (!hasSellerSku && input.sellerCustomField) {
    attributes.push({ id: 'SELLER_SKU', value_name: input.sellerCustomField });
  }
  const saleTerms: Array<{ id: string; value_name?: string; value_id?: string }> = [...(input.saleTerms || [])];

  if (input.fiscalData) {
    if (input.fiscalData.gtin) attributes.push({ id: 'GTIN', value_name: input.fiscalData.gtin });
    if (!saleTerms.find((term) => term.id === 'INVOICE')) {
      saleTerms.push({ id: 'INVOICE', value_name: 'Factura A' });
    }
  }

  const sanitizedAttributes = sanitizeMlAttributes(attributes);
  const sanitizedSaleTerms = sanitizeMlSaleTerms(saleTerms);

  const payload: Record<string, any> = {
    category_id: input.categoryId,
    price: input.price,
    currency_id: 'BRL',
    available_quantity: input.availableQuantity,
    buying_mode: 'buy_it_now',
    listing_type_id: input.listingTypeId,
    condition: input.condition,
    description: { plain_text: input.description },
    pictures: input.pictures.map(url => ({ source: url })),
    attributes: sanitizedAttributes,
    seller_custom_field: input.sellerCustomField || undefined,
    sale_terms: sanitizedSaleTerms.length > 0 ? sanitizedSaleTerms : undefined,
    shipping: input.shipping
      ? {
          mode: input.shipping.mode || 'me2',
          local_pick_up: input.shipping.localPickUp ?? false,
          free_shipping: input.shipping.freeShipping ?? true,
        }
      : { mode: 'me2', local_pick_up: false, free_shipping: true },
  };

  if (input.familyName) {
    payload.family_name = input.familyName;
  } else {
    payload.title = input.title;
  }

  console.log('[ML createListing] payload:', JSON.stringify(payload, null, 2));

  return fetchML<MLCreateItemResult>('/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function upsertItemFiscalData(data: FiscalDataInput): Promise<FiscalApiResult<any>> {
  const result = await sendItemFiscalData(data);
  if (!result.success && result.status === 409) {
    return fiscalApiFetch(`/items/fiscal_information/${encodeURIComponent(data.sku)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
  return result;
}

export interface UpdateFiscalDataInput {
  itemId: string;
  sku: string;
  title: string;
  ncm: string;
  origin_type: 'manufacturer' | 'reseller' | 'imported';
  origin_detail: string;
  gtin?: string;
  cest?: string;
  csosn?: string;
  net_weight?: number;
  gross_weight?: number;
  measurement_unit?: string;
  cost?: number;
  fci?: string;
  ex_tipi?: string;
  tax_rule_id?: number;
}

export async function updateListingFiscalData(
  data: UpdateFiscalDataInput
): Promise<{ success: boolean; step?: string; error?: string; fields?: Array<{ field: string; message: string; error_code: string }> }> {
  const fiscalPayload: FiscalDataInput = {
    sku: data.sku,
    title: data.title,
    type: 'single',
    measurement_unit: data.measurement_unit || 'UN',
    cost: data.cost,
    tax_information: {
      ncm: data.ncm,
      origin_type: data.origin_type,
      origin_detail: data.origin_detail,
      ean: data.gtin,
      cest: data.cest,
      csosn: data.csosn,
      net_weight: data.net_weight,
      gross_weight: data.gross_weight,
      fci: data.fci,
      ex_tipi: data.ex_tipi,
      tax_rule_id: data.tax_rule_id,
    },
  };

  const upsertResult = await upsertItemFiscalData(fiscalPayload);
  if (!upsertResult.success) {
    return { success: false, step: 'criar_dados_fiscais', error: upsertResult.error, fields: upsertResult.fields };
  }

  const linkResult = await linkFiscalDataToItem(data.sku, data.itemId);
  if (!linkResult.success) {
    return { success: false, step: 'vincular_sku', error: linkResult.error };
  }

  const invoiceResult = await setItemInvoiceSaleTerm(data.itemId);
  if (!invoiceResult) {
    return { success: false, step: 'invoice_term', error: 'Falha ao setar INVOICE sale_term' };
  }

  return { success: true };
}

export interface FiscalDataInput {
  sku: string;
  title: string;
  type: 'single' | 'bundle';
  measurement_unit?: string;
  cost?: number;
  tax_information: {
    ncm: string;
    origin_type: 'manufacturer' | 'reseller' | 'imported';
    origin_detail: string;
    ean?: string;
    cest?: string;
    csosn?: string;
    tax_rule_id?: number;
    fci?: string;
    ex_tipi?: string;
    net_weight?: number;
    gross_weight?: number;
    med_anvisa_code?: string;
    med_exemption_reason?: string;
  };
}

export type FiscalApiResult<T> =
  | { success: true; data: T }
  | { success: false; status: number; error: string; fields?: Array<{ field: string; message: string; error_code: string }> };

async function fiscalApiFetch<T>(path: string, options: RequestInit): Promise<FiscalApiResult<T>> {
  const token = await getValidMLToken();
  if (!token) return { success: false, status: 401, error: 'Token ML não disponível' };

  const doFetch = async (tok: string) => {
    return fetch(`https://api.mercadolibre.com${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/json',
      },
    });
  };

  let res = await doFetch(token);

  if (res.status === 401) {
    console.warn(JSON.stringify({
      event: 'ml_auth_retry',
      attempt: 'retry_after_forced_refresh',
      path,
      method: options.method || 'GET',
      status: 401,
      timestamp_utc: new Date().toISOString(),
    }));
    const freshToken = await getValidMLToken(true);
    if (!freshToken) return { success: false, status: 401, error: 'Token expirado - refresh falhou' };
    res = await doFetch(freshToken);
    if (res.status === 401) {
      return { success: false, status: 401, error: 'Falha de autenticação no Mercado Livre após refresh forçado' };
    }
  }

  const body = await res.json();

  if (!res.ok) {
    return {
      success: false,
      status: res.status,
      error: body.message || `HTTP ${res.status}`,
      fields: body.fields,
    };
  }

  return { success: true, data: body as T };
}

export async function sendItemFiscalData(data: FiscalDataInput): Promise<FiscalApiResult<any>> {
  return fiscalApiFetch('/items/fiscal_information', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function linkFiscalDataToItem(
  sku: string,
  itemId: string,
  variationId?: string
): Promise<FiscalApiResult<any>> {
  return fiscalApiFetch('/items/fiscal_information/items', {
    method: 'POST',
    body: JSON.stringify({ sku, item_id: itemId, variation_id: variationId || '' }),
  });
}

export async function getItemFiscalData(itemId: string): Promise<FiscalApiResult<any>> {
  return fiscalApiFetch(`/items/${itemId}/fiscal_information/detail`, {
    method: 'GET',
  });
}

export async function checkCanInvoice(itemId: string): Promise<FiscalApiResult<{ item_id: string; seller_id: string; variation_id: string; status: boolean }>> {
  return fiscalApiFetch(`/can_invoice/items/${itemId}`, {
    method: 'GET',
  });
}

export async function searchItemBySellerSku(sku: string): Promise<string | null> {
  const me = await fetchML<{ id: number }>('/users/me');
  if (!me) return null;
  const data = await fetchML<{ results: string[] }>(`/users/${me.id}/items/search?seller_sku=${encodeURIComponent(sku)}`);
  if (!data?.results?.length) return null;
  return data.results[0];
}

export async function setItemInvoiceSaleTerm(itemId: string): Promise<boolean> {
  const result = await fetchML(`/items/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sale_terms: [{ id: 'INVOICE', value_name: 'Factura A' }] }),
  });
  return result !== null;
}

export interface QuantityPriceTier {
  minPurchaseUnit: number;
  amount: number;
}

export interface QuantityPricingApplyResult {
  ok: boolean;
  error: string | null;
  code: string | null;
  httpStatus: number | null;
  providerBody: any;
  tiersExpected: QuantityPriceTier[];
  tiersFound: QuantityPriceTier[];
}

export interface MLItemStatus {
  id: string;
  status: string;
  available_quantity: number;
}

type SyncReasonCode =
  | 'ok'
  | 'manual_block'
  | 'already_paused'
  | 'not_paused_after_update'
  | 'activation_without_stock'
  | 'network_error'
  | 'rate_limited'
  | 'optimistic_lock'
  | 'ml_server_error'
  | 'under_review'
  | 'field_not_updatable'
  | 'forbidden'
  | 'auth_error'
  | 'bad_request'
  | 'blocked_cooldown'
  | 'unknown_error';

interface MlRequestResult<T = any> {
  success: boolean;
  data?: T;
  status?: number;
  error?: string;
  reason_code: SyncReasonCode;
  transient: boolean;
}

const STOCK_SYNC_DELAY_MS = 1000;
const STOCK_SYNC_RETRY_BASE_MS = 1200;
const STOCK_SYNC_MAX_RETRIES = 4;
const ML_BLOCK_COOLDOWN_HOURS = 6;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getMlManualBlockSet(
  produtos: Array<{ ml_item_id: string; sku?: string }>
): Promise<{ byMlItemId: Map<string, string>; bySku: Map<string, string> }> {
  const byMlItemId = new Map<string, string>();
  const bySku = new Map<string, string>();
  const serviceClient = createServiceClient();

  const itemIds = Array.from(new Set(produtos.map((p) => String(p.ml_item_id || '').trim()).filter(Boolean)));
  const skus = Array.from(new Set(produtos.map((p) => String(p.sku || '').trim().toUpperCase()).filter(Boolean)));

  let query = serviceClient
    .from('ml_manual_blocklist')
    .select('sku, ml_item_id, motivo')
    .eq('ativo', true);

  if (itemIds.length > 0 && skus.length > 0) {
    query = query.or(`ml_item_id.in.(${itemIds.join(',')}),sku.in.(${skus.join(',')})`);
  } else if (itemIds.length > 0) {
    query = query.in('ml_item_id', itemIds);
  } else if (skus.length > 0) {
    query = query.in('sku', skus);
  } else {
    return { byMlItemId, bySku };
  }

  const { data } = await query;
  for (const row of data || []) {
    const reason = String(row.motivo || 'Bloqueio manual temporário');
    const mlItemId = String(row.ml_item_id || '').trim();
    const sku = String(row.sku || '').trim().toUpperCase();
    if (mlItemId) byMlItemId.set(mlItemId, reason);
    if (sku) bySku.set(sku, reason);
  }

  return { byMlItemId, bySku };
}

function parseJsonSafe(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function classifyMlItemError(status: number | undefined, parsedBody: any, fallback: string): MlRequestResult {
  if (!status) {
    return {
      success: false,
      error: fallback || 'Falha de rede/comunicação',
      reason_code: 'network_error',
      transient: true,
    };
  }

  const message = String(parsedBody?.message || fallback || `HTTP ${status}`);
  const lowerMessage = message.toLowerCase();
  const causes = Array.isArray(parsedBody?.cause) ? parsedBody.cause : [];
  const causeCodes = causes.map((c: any) => String(c?.code || '').toLowerCase());

  if (status === 429) {
    return { success: false, status, error: message, reason_code: 'rate_limited', transient: true };
  }
  if (status === 409) {
    return { success: false, status, error: message, reason_code: 'optimistic_lock', transient: true };
  }
  if (status === 401) {
    return { success: false, status, error: message, reason_code: 'auth_error', transient: false };
  }
  if (status === 403) {
    return { success: false, status, error: message, reason_code: 'forbidden', transient: false };
  }
  if (status >= 500) {
    return { success: false, status, error: message, reason_code: 'ml_server_error', transient: true };
  }
  if (status === 400 && (lowerMessage.includes('under_review') || lowerMessage.includes('moderat'))) {
    return { success: false, status, error: message, reason_code: 'under_review', transient: false };
  }
  if (status === 400 && causeCodes.includes('field_not_updatable')) {
    return { success: false, status, error: message, reason_code: 'field_not_updatable', transient: false };
  }
  if (status === 400) {
    return { success: false, status, error: message, reason_code: 'bad_request', transient: false };
  }
  return { success: false, status, error: message, reason_code: 'unknown_error', transient: false };
}

async function mlItemRequest<T = any>(path: string, options?: RequestInit): Promise<MlRequestResult<T>> {
  const raw = await fetchMLRaw(path, options);

  if (!raw) {
    return {
      success: false,
      error: 'Falha de comunicação com o Mercado Livre',
      reason_code: 'network_error',
      transient: true,
    };
  }

  const parsed = parseJsonSafe(raw.body);
  if (raw.status >= 200 && raw.status < 300) {
    return {
      success: true,
      data: parsed as T,
      status: raw.status,
      reason_code: 'ok',
      transient: false,
    };
  }

  return classifyMlItemError(raw.status, parsed, raw.body.substring(0, 400));
}

async function withMlRetry<T>(fn: () => Promise<MlRequestResult<T>>): Promise<MlRequestResult<T> & { attempts: number }> {
  let attempt = 0;
  let last: MlRequestResult<T> = {
    success: false,
    error: 'Não executado',
    reason_code: 'unknown_error',
    transient: false,
  };

  while (attempt < STOCK_SYNC_MAX_RETRIES) {
    attempt++;
    const result = await fn();
    last = result;

    if (result.success) {
      return { ...result, attempts: attempt };
    }

    if (!result.transient || attempt >= STOCK_SYNC_MAX_RETRIES) {
      return { ...result, attempts: attempt };
    }

    await delay(STOCK_SYNC_RETRY_BASE_MS * attempt);
  }

  return { ...last, attempts: attempt };
}

async function obterStatusItemML(itemId: string): Promise<MlRequestResult<MLItemStatus> & { attempts: number }> {
  return withMlRetry<MLItemStatus>(() => mlItemRequest<MLItemStatus>(`/items/${itemId}`, { method: 'GET' }));
}

async function atualizarQuantidadeItemML(
  itemId: string,
  quantidade: number
): Promise<MlRequestResult<MLItemStatus> & { attempts: number }> {
  return withMlRetry<MLItemStatus>(() =>
    mlItemRequest<MLItemStatus>(`/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available_quantity: quantidade }),
    })
  );
}

async function pausarItemML(itemId: string): Promise<MlRequestResult<MLItemStatus> & { attempts: number }> {
  return withMlRetry<MLItemStatus>(() =>
    mlItemRequest<MLItemStatus>(`/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })
  );
}

async function reativarItemML(itemId: string): Promise<MlRequestResult<MLItemStatus> & { attempts: number }> {
  return withMlRetry<MLItemStatus>(() =>
    mlItemRequest<MLItemStatus>(`/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
  );
}

export async function atualizarEstoqueML(
  itemId: string,
  quantidade: number
): Promise<{ success: boolean; status?: string; error?: string }> {
  const result = await atualizarQuantidadeItemML(itemId, quantidade);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, status: result.data?.status };
}

export async function reativarAnuncioML(
  itemId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  const result = await reativarItemML(itemId);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, status: result.data?.status };
}

export async function sincronizarEstoqueComML(
  produtos: Array<{ ml_item_id: string; sku?: string; estoque: number; ml_status?: string }>
): Promise<{
  sucessos: number;
  erros: number;
  pausados: number;
  reativados: number;
  pausa_confirmada: number;
  pausa_pendente: number;
  erros_bloqueio_ml: number;
  bloqueios_ml_regra: number;
  ativacao_bloqueada_sem_estoque: number;
  skipped_blocked_cooldown: number;
  erros_transitorios: number;
  erros_nao_recuperaveis: number;
  skipped_manual_block: number;
  manual_block_items: Array<{ ml_item_id: string; sku?: string; motivo: string }>;
  detalhes: Array<{
    ml_item_id: string;
    sku?: string;
    estoque: number;
    acao: string;
    sucesso: boolean;
    erro?: string;
    status?: string;
    verified_status?: string;
    reason_code?: SyncReasonCode;
    blocked_until?: string;
    is_blocked_by_ml_rule?: boolean;
    attempts?: number;
    http_status?: number;
  }>;
}> {
  const blockedReasonCodes: SyncReasonCode[] = ['under_review', 'field_not_updatable'];
  const isBlockedByMlRule = (reasonCode?: SyncReasonCode) =>
    !!reasonCode && blockedReasonCodes.includes(reasonCode);
  const serviceClient = createServiceClient();
  const manualBlockSet = await getMlManualBlockSet(produtos);
  const mlItemIds = produtos.map((p) => p.ml_item_id).filter(Boolean);
  const blockStateByItemId = new Map<string, {
    blockedUntil: string | null;
    reason: string | null;
    lastError: string | null;
  }>();

  if (mlItemIds.length > 0) {
    const { data: blockRows } = await serviceClient
      .from('anuncios_ml')
      .select('ml_item_id, ml_sync_blocked_until, ml_sync_block_reason, ml_sync_last_error')
      .in('ml_item_id', mlItemIds);

    for (const row of blockRows || []) {
      blockStateByItemId.set(row.ml_item_id, {
        blockedUntil: row.ml_sync_blocked_until,
        reason: row.ml_sync_block_reason,
        lastError: row.ml_sync_last_error,
      });
    }
  }

  const setBlockedCooldown = async (mlItemId: string, reasonCode: SyncReasonCode, errorMessage?: string) => {
    const blockedUntil = new Date(Date.now() + ML_BLOCK_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    await serviceClient
      .from('anuncios_ml')
      .update({
        ml_sync_blocked_until: blockedUntil,
        ml_sync_block_reason: reasonCode,
        ml_sync_last_error: errorMessage || null,
      })
      .eq('ml_item_id', mlItemId);
    blockStateByItemId.set(mlItemId, { blockedUntil, reason: reasonCode, lastError: errorMessage || null });
    return blockedUntil;
  };

  const clearBlockedCooldown = async (mlItemId: string) => {
    await serviceClient
      .from('anuncios_ml')
      .update({
        ml_sync_blocked_until: null,
        ml_sync_block_reason: null,
        ml_sync_last_error: null,
      })
      .eq('ml_item_id', mlItemId);
    blockStateByItemId.set(mlItemId, { blockedUntil: null, reason: null, lastError: null });
  };

  const resultado = {
    sucessos: 0,
    erros: 0,
    pausados: 0,
    reativados: 0,
    pausa_confirmada: 0,
    pausa_pendente: 0,
    erros_bloqueio_ml: 0,
    bloqueios_ml_regra: 0,
    ativacao_bloqueada_sem_estoque: 0,
    skipped_blocked_cooldown: 0,
    skipped_manual_block: 0,
    manual_block_items: [] as Array<{ ml_item_id: string; sku?: string; motivo: string }>,
    erros_transitorios: 0,
    erros_nao_recuperaveis: 0,
    detalhes: [] as Array<{
      ml_item_id: string;
      sku?: string;
      estoque: number;
      acao: string;
      sucesso: boolean;
      erro?: string;
      status?: string;
      verified_status?: string;
      reason_code?: SyncReasonCode;
      blocked_until?: string;
      is_blocked_by_ml_rule?: boolean;
      attempts?: number;
      http_status?: number;
    }>,
  };
  const skipRetryForItem = new Set<string>();

  for (const produto of produtos) {
    if (!produto.ml_item_id) continue;
    if (skipRetryForItem.has(produto.ml_item_id)) {
      continue;
    }

    const skuUpper = String(produto.sku || '').trim().toUpperCase();
    const manualReason = manualBlockSet.byMlItemId.get(produto.ml_item_id) || (skuUpper ? manualBlockSet.bySku.get(skuUpper) : undefined);
    if (manualReason) {
      const detalheBlocked = {
        ml_item_id: produto.ml_item_id,
        sku: produto.sku,
        estoque: produto.estoque || 0,
        acao: 'skip_manual_block',
        sucesso: false,
        erro: manualReason,
        reason_code: 'manual_block' as SyncReasonCode,
      };
      resultado.skipped_manual_block++;
      if (resultado.manual_block_items.length < 20) {
        resultado.manual_block_items.push({ ml_item_id: produto.ml_item_id, sku: produto.sku, motivo: manualReason });
      }
      console.warn(JSON.stringify({
        event: 'sync_ml_manual_block_skip',
        ml_item_id: produto.ml_item_id,
        sku: produto.sku,
        motivo: manualReason,
        timestamp_utc: new Date().toISOString(),
      }));
      resultado.detalhes.push(detalheBlocked);
      continue;
    }

    const estoque = produto.estoque || 0;
    const mlStatus = produto.ml_status || 'sem_anuncio';
    let detalhe: {
      ml_item_id: string;
      sku?: string;
      estoque: number;
      acao: string;
      sucesso: boolean;
      erro?: string;
      status?: string;
      verified_status?: string;
      reason_code?: SyncReasonCode;
      blocked_until?: string;
      is_blocked_by_ml_rule?: boolean;
      attempts?: number;
      http_status?: number;
    } = {
      ml_item_id: produto.ml_item_id,
      sku: produto.sku,
      estoque,
      acao: 'atualizar_estoque',
      sucesso: false,
    };

    const blockState = blockStateByItemId.get(produto.ml_item_id);
    const blockedUntil = blockState?.blockedUntil ? new Date(blockState.blockedUntil) : null;
    const isBlockedNow = blockedUntil && blockedUntil.getTime() > Date.now();
    if (isBlockedNow) {
      detalhe = {
        ...detalhe,
        acao: 'skip_blocked_cooldown',
        sucesso: false,
        erro: blockState?.lastError || `Item em cooldown de bloqueio ML até ${blockedUntil.toISOString()}`,
        reason_code: 'blocked_cooldown',
        blocked_until: blockedUntil.toISOString(),
        is_blocked_by_ml_rule: true,
      };
      resultado.skipped_blocked_cooldown++;
      resultado.detalhes.push(detalhe);
      continue;
    }

    if (estoque === 0) {
      detalhe.acao = 'pausar_estoque_zero';

      const updateZero = await atualizarQuantidadeItemML(produto.ml_item_id, 0);
      const statusDepoisUpdate = await obterStatusItemML(produto.ml_item_id);
      let totalAttempts = updateZero.attempts + statusDepoisUpdate.attempts;
      let reasonCode: SyncReasonCode = updateZero.reason_code;

      let statusFinal = statusDepoisUpdate.data?.status || updateZero.data?.status;
      if (statusFinal !== 'paused') {
        const forcePause = await pausarItemML(produto.ml_item_id);
        const statusFinalCheck = await obterStatusItemML(produto.ml_item_id);
        totalAttempts += forcePause.attempts + statusFinalCheck.attempts;
        statusFinal = statusFinalCheck.data?.status || forcePause.data?.status || statusFinal;
        reasonCode = forcePause.reason_code;
      }

      const confirmadoPausado = statusFinal === 'paused';
      if (confirmadoPausado) {
        await clearBlockedCooldown(produto.ml_item_id);
        detalhe = {
          ...detalhe,
          sucesso: true,
          status: statusFinal,
          verified_status: statusFinal,
          reason_code: 'ok',
          attempts: totalAttempts,
          http_status: updateZero.status || statusDepoisUpdate.status,
        };
        resultado.pausados++;
        resultado.pausa_confirmada++;
        resultado.sucessos++;
      } else {
        const fallbackReason = reasonCode || 'not_paused_after_update';
        const blockedUntilIso = isBlockedByMlRule(fallbackReason)
          ? await setBlockedCooldown(produto.ml_item_id, fallbackReason, updateZero.error || statusDepoisUpdate.error || undefined)
          : undefined;
        detalhe = {
          ...detalhe,
          sucesso: false,
          erro: updateZero.error || statusDepoisUpdate.error || 'Item não pausou após atualização de estoque zero',
          status: updateZero.data?.status || statusDepoisUpdate.data?.status,
          verified_status: statusFinal || undefined,
          reason_code: fallbackReason,
          blocked_until: blockedUntilIso,
          is_blocked_by_ml_rule: isBlockedByMlRule(fallbackReason),
          attempts: totalAttempts,
          http_status: updateZero.status || statusDepoisUpdate.status,
        };
        resultado.erros++;
        resultado.pausa_pendente++;
        if (isBlockedByMlRule(fallbackReason)) {
          resultado.erros_bloqueio_ml++;
          resultado.bloqueios_ml_regra++;
          console.warn(
            `[sync-ml-estoque] Bloqueio de regra ML para ${produto.ml_item_id}: ${fallbackReason} | ${detalhe.erro}`
          );
        }
        if (updateZero.transient || statusDepoisUpdate.transient) {
          resultado.erros_transitorios++;
        } else {
          resultado.erros_nao_recuperaveis++;
        }
      }
    } else if (mlStatus === 'pausado') {
      detalhe.acao = 'reativar';
      const updateBeforeReactivate = await atualizarQuantidadeItemML(produto.ml_item_id, estoque);
      const statusBeforeReactivate = await obterStatusItemML(produto.ml_item_id);
      const quantityInMl = Number(statusBeforeReactivate.data?.available_quantity ?? updateBeforeReactivate.data?.available_quantity ?? 0);
      let totalAttempts = updateBeforeReactivate.attempts + statusBeforeReactivate.attempts;

      if (!updateBeforeReactivate.success && !updateBeforeReactivate.transient) {
        const reasonCode = updateBeforeReactivate.reason_code || statusBeforeReactivate.reason_code;
        const blockedUntilIso = isBlockedByMlRule(reasonCode)
          ? await setBlockedCooldown(produto.ml_item_id, reasonCode, updateBeforeReactivate.error || statusBeforeReactivate.error || undefined)
          : undefined;
        detalhe = {
          ...detalhe,
          sucesso: false,
          erro: updateBeforeReactivate.error || statusBeforeReactivate.error || 'Falha ao preparar anúncio para reativação',
          status: updateBeforeReactivate.data?.status || statusBeforeReactivate.data?.status,
          verified_status: statusBeforeReactivate.data?.status,
          reason_code: reasonCode,
          blocked_until: blockedUntilIso,
          is_blocked_by_ml_rule: isBlockedByMlRule(reasonCode),
          attempts: totalAttempts,
          http_status: updateBeforeReactivate.status || statusBeforeReactivate.status,
        };
        resultado.erros++;
        skipRetryForItem.add(produto.ml_item_id);
        if (isBlockedByMlRule(reasonCode)) {
          resultado.erros_bloqueio_ml++;
          resultado.bloqueios_ml_regra++;
          console.warn(
            `[sync-ml-estoque] Bloqueio de regra ML para ${produto.ml_item_id}: ${reasonCode} | ${detalhe.erro}`
          );
        }
        if (updateBeforeReactivate.transient || statusBeforeReactivate.transient) {
          resultado.erros_transitorios++;
        } else {
          resultado.erros_nao_recuperaveis++;
        }
      } else if (!Number.isFinite(quantityInMl) || quantityInMl <= 0) {
        detalhe = {
          ...detalhe,
          sucesso: false,
          erro: 'Reativação bloqueada: anúncio segue sem estoque no ML após atualização de quantidade',
          status: statusBeforeReactivate.data?.status || updateBeforeReactivate.data?.status,
          verified_status: statusBeforeReactivate.data?.status,
          reason_code: 'activation_without_stock',
          is_blocked_by_ml_rule: false,
          attempts: totalAttempts,
          http_status: updateBeforeReactivate.status || statusBeforeReactivate.status,
        };
        resultado.erros++;
        resultado.ativacao_bloqueada_sem_estoque++;
        resultado.erros_nao_recuperaveis++;
      } else {
        const reactivate = await reativarItemML(produto.ml_item_id);
        const statusCheck = await obterStatusItemML(produto.ml_item_id);
        const verifiedStatus = statusCheck.data?.status || reactivate.data?.status;
        totalAttempts += reactivate.attempts + statusCheck.attempts;

        if (reactivate.success && verifiedStatus === 'active') {
          await clearBlockedCooldown(produto.ml_item_id);
          detalhe = {
            ...detalhe,
            sucesso: true,
            status: reactivate.data?.status || verifiedStatus,
            verified_status: verifiedStatus,
            reason_code: 'ok',
            attempts: totalAttempts,
            http_status: reactivate.status || statusCheck.status,
          };
          resultado.reativados++;
          resultado.sucessos++;
        } else {
          const reasonCode = reactivate.reason_code || statusCheck.reason_code;
          const blockedUntilIso = isBlockedByMlRule(reasonCode)
            ? await setBlockedCooldown(produto.ml_item_id, reasonCode, reactivate.error || statusCheck.error || undefined)
            : undefined;
          detalhe = {
            ...detalhe,
            sucesso: false,
            erro: reactivate.error || statusCheck.error || 'Não foi possível reativar anúncio',
            status: reactivate.data?.status || undefined,
            verified_status: verifiedStatus,
            reason_code: reasonCode,
            blocked_until: blockedUntilIso,
            is_blocked_by_ml_rule: isBlockedByMlRule(reasonCode),
            attempts: totalAttempts,
            http_status: reactivate.status || statusCheck.status,
          };
          resultado.erros++;
          if (isBlockedByMlRule(reasonCode)) {
            resultado.erros_bloqueio_ml++;
            resultado.bloqueios_ml_regra++;
            console.warn(
              `[sync-ml-estoque] Bloqueio de regra ML para ${produto.ml_item_id}: ${reasonCode} | ${detalhe.erro}`
            );
          }
          if (reactivate.transient || statusCheck.transient) {
            resultado.erros_transitorios++;
          } else {
            resultado.erros_nao_recuperaveis++;
          }
        }
      }
    } else {
      detalhe.acao = 'atualizar_estoque';
      const updateStock = await atualizarQuantidadeItemML(produto.ml_item_id, estoque);
      const statusCheck = await obterStatusItemML(produto.ml_item_id);
      const verifiedStatus = statusCheck.data?.status || updateStock.data?.status;

      if (updateStock.success) {
        await clearBlockedCooldown(produto.ml_item_id);
        detalhe = {
          ...detalhe,
          sucesso: true,
          status: updateStock.data?.status || verifiedStatus,
          verified_status: verifiedStatus,
          reason_code: 'ok',
          attempts: updateStock.attempts + statusCheck.attempts,
          http_status: updateStock.status || statusCheck.status,
        };
        resultado.sucessos++;
      } else {
        const reasonCode = updateStock.reason_code || statusCheck.reason_code;
        const blockedUntilIso = isBlockedByMlRule(reasonCode)
          ? await setBlockedCooldown(produto.ml_item_id, reasonCode, updateStock.error || statusCheck.error || undefined)
          : undefined;
        detalhe = {
          ...detalhe,
          sucesso: false,
          erro: updateStock.error || statusCheck.error || 'Falha ao atualizar estoque no ML',
          status: updateStock.data?.status || undefined,
          verified_status: verifiedStatus,
          reason_code: reasonCode,
          blocked_until: blockedUntilIso,
          is_blocked_by_ml_rule: isBlockedByMlRule(reasonCode),
          attempts: updateStock.attempts + statusCheck.attempts,
          http_status: updateStock.status || statusCheck.status,
        };
        resultado.erros++;
        if (!updateStock.transient) {
          skipRetryForItem.add(produto.ml_item_id);
        }
        if (isBlockedByMlRule(updateStock.reason_code || statusCheck.reason_code)) {
          resultado.erros_bloqueio_ml++;
          resultado.bloqueios_ml_regra++;
          console.warn(
            `[sync-ml-estoque] Bloqueio de regra ML para ${produto.ml_item_id}: ${updateStock.reason_code || statusCheck.reason_code} | ${detalhe.erro}`
          );
        }
        if (updateStock.transient || statusCheck.transient) {
          resultado.erros_transitorios++;
        } else {
          resultado.erros_nao_recuperaveis++;
        }
      }
    }

    resultado.detalhes.push(detalhe);
    await delay(STOCK_SYNC_DELAY_MS);
  }

  return resultado;
}

export async function reconciliarPausasEstoqueZero(
  produtos: Array<{ ml_item_id: string; sku?: string; estoque: number; ml_status?: string }>
) {
  const detalhes: Array<{ ml_item_id: string; sku?: string; current_status?: string; acao: string; sucesso: boolean; erro?: string }> = [];
  const candidatos: Array<{ ml_item_id: string; sku?: string; estoque: number; ml_status?: string }> = [];
  const manualBlockSet = await getMlManualBlockSet(produtos);
  const manualBlockedDetalhes: Array<{ ml_item_id: string; sku?: string; current_status?: string; acao: string; sucesso: boolean; erro?: string }> = [];
  const manualBlockItems: Array<{ ml_item_id: string; sku?: string; motivo: string }> = [];
  let skippedManualBlock = 0;

  for (const produto of produtos) {
    if (!produto.ml_item_id) continue;
    const skuUpper = String(produto.sku || '').trim().toUpperCase();
    const manualReason = manualBlockSet.byMlItemId.get(produto.ml_item_id) || (skuUpper ? manualBlockSet.bySku.get(skuUpper) : undefined);
    if (manualReason) {
      skippedManualBlock++;
      if (manualBlockItems.length < 20) {
        manualBlockItems.push({ ml_item_id: produto.ml_item_id, sku: produto.sku, motivo: manualReason });
      }
      manualBlockedDetalhes.push({
        ml_item_id: produto.ml_item_id,
        sku: produto.sku,
        acao: 'skip_manual_block',
        sucesso: false,
        erro: manualReason,
      });
      console.warn(JSON.stringify({
        event: 'sync_ml_manual_block_skip',
        ml_item_id: produto.ml_item_id,
        sku: produto.sku,
        motivo: manualReason,
        timestamp_utc: new Date().toISOString(),
      }));
      continue;
    }

    const status = await obterStatusItemML(produto.ml_item_id);
    const currentStatus = status.data?.status;

    if (status.success && currentStatus === 'paused') {
      detalhes.push({
        ml_item_id: produto.ml_item_id,
        sku: produto.sku,
        current_status: currentStatus,
        acao: 'verificar_status',
        sucesso: true,
      });
      continue;
    }

    candidatos.push(produto);
  }

  const sync = await sincronizarEstoqueComML(candidatos);
  return {
    verificados: produtos.length,
    candidatos: candidatos.length,
    pausa_confirmada: sync.pausa_confirmada,
    pausa_pendente: sync.pausa_pendente,
    erros_bloqueio_ml: sync.erros_bloqueio_ml,
    skipped_manual_block: sync.skipped_manual_block + skippedManualBlock,
    manual_block_items: [...manualBlockItems, ...(sync.manual_block_items || [])].slice(0, 20),
    bloqueios_ml_regra: sync.bloqueios_ml_regra,
    ativacao_bloqueada_sem_estoque: sync.ativacao_bloqueada_sem_estoque,
    erros_transitorios: sync.erros_transitorios,
    erros_nao_recuperaveis: sync.erros_nao_recuperaveis,
    detalhes: [...detalhes, ...manualBlockedDetalhes, ...sync.detalhes.map((d) => ({
      ml_item_id: d.ml_item_id,
      sku: d.sku,
      current_status: d.verified_status || d.status,
      acao: d.acao,
      sucesso: d.sucesso,
      erro: d.erro,
    }))],
  };
}

export async function setItemQuantityPricing(
  itemId: string,
  basePrice: number
): Promise<QuantityPricingApplyResult> {
  const tiersExpected: QuantityPriceTier[] = [
    { minPurchaseUnit: 3, amount: Math.round(basePrice * 0.97 * 100) / 100 },
    { minPurchaseUnit: 5, amount: Math.round(basePrice * 0.96 * 100) / 100 },
    { minPurchaseUnit: 10, amount: Math.round(basePrice * 0.95 * 100) / 100 },
  ];

  const payload = {
    prices: tiersExpected.map(tier => ({
      type: 'standard',
      amount: tier.amount,
      currency_id: 'BRL',
      conditions: {
        context_restrictions: ['channel_marketplace', 'user_type_business'],
        min_purchase_unit: tier.minPurchaseUnit,
      },
    })),
  };

  const parseBusinessTiers = (raw: any): QuantityPriceTier[] => {
    const prices = Array.isArray(raw?.prices) ? raw.prices : [];
    const tiers: QuantityPriceTier[] = [];
    for (const price of prices) {
      const contexts = Array.isArray(price?.conditions?.context_restrictions)
        ? price.conditions.context_restrictions.map((value: unknown) => String(value || '').toLowerCase())
        : [];
      const isBusiness = contexts.includes('user_type_business');
      const minPurchaseUnit = Number(price?.conditions?.min_purchase_unit);
      const amount = Number(price?.amount);
      if (!isBusiness || !Number.isFinite(minPurchaseUnit) || minPurchaseUnit <= 0 || !Number.isFinite(amount)) {
        continue;
      }
      tiers.push({
        minPurchaseUnit: Math.trunc(minPurchaseUnit),
        amount: Math.round(amount * 100) / 100,
      });
    }
    return tiers.sort((a, b) => a.minPurchaseUnit - b.minPurchaseUnit);
  };

  const tiersMatch = (found: QuantityPriceTier[], expected: QuantityPriceTier[]): boolean => {
    if (found.length < expected.length) return false;
    const tolerance = 0.01;
    for (const tier of expected) {
      const match = found.find((value) => value.minPurchaseUnit === tier.minPurchaseUnit);
      if (!match) return false;
      if (Math.abs(match.amount - tier.amount) > tolerance) return false;
    }
    return true;
  };

  try {
    const postResult = await fetchMLResult<any>(`/items/${itemId}/prices/standard/quantity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!postResult.ok) {
      const errorMessage = postResult.error?.message || 'Falha ao publicar preços de atacado no ML';
      const code = postResult.error?.code || null;
      console.warn(`[setItemQuantityPricing] Rejeitado para ${itemId}: ${errorMessage}`);
      return {
        ok: false,
        error: errorMessage,
        code: code || 'quantity_pricing_provider_rejected',
        httpStatus: postResult.status,
        providerBody: postResult.error,
        tiersExpected,
        tiersFound: [],
      };
    }

    const verifyResult = await fetchMLResult<any>(`/items/${itemId}/prices`, {
      method: 'GET',
      headers: {
        'show-all-prices': 'TRUE',
      },
    });

    if (!verifyResult.ok) {
      const errorMessage = verifyResult.error?.message || 'Falha ao validar preços de atacado após publicação';
      return {
        ok: false,
        error: errorMessage,
        code: verifyResult.error?.code || 'quantity_pricing_validation_failed',
        httpStatus: verifyResult.status,
        providerBody: verifyResult.error,
        tiersExpected,
        tiersFound: [],
      };
    }

    const tiersFound = parseBusinessTiers(verifyResult.data);
    const isEffective = tiersMatch(tiersFound, tiersExpected);
    console.log(JSON.stringify({
      event: 'ml_quantity_pricing_validation',
      timestamp_utc: new Date().toISOString(),
      ml_item_id: itemId,
      base_price: Math.round(basePrice * 100) / 100,
      tiers_expected: tiersExpected,
      tiers_found: tiersFound,
      result: isEffective ? 'ok' : 'quantity_pricing_not_effective',
    }));

    if (!isEffective) {
      return {
        ok: false,
        error: 'Faixas de atacado não ficaram ativas após publicação no ML.',
        code: 'quantity_pricing_not_effective',
        httpStatus: verifyResult.status,
        providerBody: verifyResult.data,
        tiersExpected,
        tiersFound,
      };
    }

    return {
      ok: true,
      error: null,
      code: null,
      httpStatus: verifyResult.status,
      providerBody: verifyResult.data,
      tiersExpected,
      tiersFound,
    };
  } catch (err: any) {
    console.error(`[setItemQuantityPricing] Erro para ${itemId}:`, err.message || err);
    return {
      ok: false,
      error: err?.message || 'Erro inesperado ao publicar preços de atacado',
      code: 'quantity_pricing_exception',
      httpStatus: null,
      providerBody: null,
      tiersExpected,
      tiersFound: [],
    };
  }
}

export async function updateItemPrice(itemId: string, price: number): Promise<boolean> {
  try {
    const result = await fetchML<any>(`/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price }),
    });

    const ok = Boolean(result && result.id);
    if (ok) {
      console.log(`[updateItemPrice] Sucesso item=${itemId} price=${price}`);
      return true;
    }

    console.warn(`[updateItemPrice] Resposta inesperada item=${itemId}`, result);
    return false;
  } catch (err: any) {
    console.error(`[updateItemPrice] Falha item=${itemId}:`, err?.message || err);
    return false;
  }
}
