import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult, getMLAuthDiagnostics, type MLRequestResult } from '@/services/integration';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { getSyncRuntimeConfigValue, setSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';
import { buildCatalogEnrichment } from '@/lib/catalogo/no-catalogo';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { detachDeletedMlListing, isMlListingDeleted } from '@/lib/ml/listing-deletion';
import { getConfiguredMlShippingCost } from '@/lib/ml/shipping-cost';
import { calculateSuggestedPrice } from '@/services/pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { persistSingleAnuncioBySku } from '@/lib/ml/persist-single-anuncio';
import { mapMlStatusToLocalStatus } from '@/lib/ml/status';
import { syncProdutoOperationalListing } from '@/lib/ml/operational-listing';
import { extractMlItemSku } from '@/lib/ml/item-sku';
import { findMlProductIdentityConflicts } from '@/lib/ml-critical-attributes';
import {
  ML_OBSERVED_BATCH_SIZE,
  normalizeMlObservedItemIds,
  resolveMlObservedScrollId,
} from '@/lib/ml/observed-scan-batch';

export const maxDuration = 300;

const CONCURRENCY = 3;
const CATALOG_ENRICH_CONCURRENCY = 4;
const VISITS_CONCURRENCY = 3;
const TRANSIENT_RETRY_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 800;
const ML_SCAN_PAGE_SIZE = 100;
const CATALOG_REFRESH_TRIGGER_KEY = 'catalog_no_catalogo_refresh_last_trigger_at';
const CATALOG_REFRESH_TRIGGER_INTERVAL_MS = 10 * 60 * 1000;
const PERFORMANCE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function ensureMlIdentityManualBlock(
  client: ReturnType<typeof createServiceClient>,
  itemId: string,
  reason: string,
) {
  const { data: existing, error: lookupError } = await client
    .from('ml_manual_blocklist')
    .select('id')
    .eq('ml_item_id', itemId)
    .eq('ativo', true)
    .limit(1)
    .maybeSingle();
  if (lookupError) return { ok: false as const, error: lookupError.message };
  if (existing?.id) return { ok: true as const };

  const { error } = await client.from('ml_manual_blocklist').insert({
    ml_item_id: itemId,
    // O bloqueio é por item incorreto. Bloquear o SKU impediria a publicação
    // da oferta corrigida do mesmo produto.
    sku: null,
    ativo: true,
    motivo: reason,
    created_by: 'ml_identity_gate',
  });
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const };
}

type MlPerformance = {
  entity_id?: string;
  score?: number;
  level?: string;
  level_wording?: string;
  calculated_at?: string;
  buckets?: any[];
};

function normalizePerformanceScore(value: unknown): number | null {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score);
}

function shouldRefreshPerformance(qualidadeInfo: unknown, now: number): boolean {
  if (!qualidadeInfo || typeof qualidadeInfo !== 'object' || Array.isArray(qualidadeInfo)) return true;
  const info = qualidadeInfo as Record<string, unknown>;
  if (info.source !== 'mercado_livre_performance') return true;
  const refreshedAt = new Date(String(info.refreshed_at || '')).getTime();
  return !Number.isFinite(refreshedAt) || (now - refreshedAt) >= PERFORMANCE_REFRESH_INTERVAL_MS;
}

function buildPerformanceInfo(performance: MlPerformance, refreshedAt: string) {
  const variables = (performance.buckets || []).flatMap((bucket: any) => (
    Array.isArray(bucket?.variables) ? bucket.variables : []
  ));
  const itens = variables.map((variable: any) => ({
    nome: String(variable?.title || variable?.key || 'Objetivo do Mercado Livre'),
    ok: String(variable?.status || '').toUpperCase() === 'COMPLETED',
    pontos: Math.round(Number(variable?.score || 0)),
    max: 100,
  }));
  const pending = itens.find((item: any) => !item.ok);

  return {
    source: 'mercado_livre_performance',
    entity_id: String(performance.entity_id || '') || null,
    level: String(performance.level || '') || null,
    level_wording: String(performance.level_wording || '') || null,
    calculated_at: String(performance.calculated_at || '') || null,
    refreshed_at: refreshedAt,
    itens,
    dica: pending?.nome || '',
  };
}

async function fetchListingPerformance(itemId: string, userProductId: string | null): Promise<{
  result: MLRequestResult<MlPerformance>;
  retries: number;
  endpoint: string;
}> {
  const endpoints = [
    userProductId ? `/user-product/${encodeURIComponent(userProductId)}/performance` : null,
    `/item/${encodeURIComponent(itemId)}/performance`,
  ].filter((endpoint): endpoint is string => Boolean(endpoint));

  let last: { result: MLRequestResult<MlPerformance>; retries: number; endpoint: string } | null = null;
  for (const endpoint of endpoints) {
    const check = await fetchMLResultWithRetry<MlPerformance>(endpoint);
    if (check.result.ok && normalizePerformanceScore(check.result.data?.score) !== null) {
      return { ...check, endpoint };
    }
    last = { ...check, endpoint };
  }

  return last!;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMLResultWithRetry<T>(path: string): Promise<{ result: MLRequestResult<T>; retries: number }> {
  let retries = 0;

  for (let attempt = 0; attempt < TRANSIENT_RETRY_ATTEMPTS; attempt += 1) {
    const result = await fetchMLResult<T>(path);
    if (result.ok) return { result, retries };

    const isRetryable = result.error?.category === 'retryable';
    const hasNextAttempt = attempt < TRANSIENT_RETRY_ATTEMPTS - 1;
    if (!isRetryable || !hasNextAttempt) return { result, retries };

    retries += 1;
    await sleep(TRANSIENT_RETRY_BASE_DELAY_MS * (attempt + 1));
  }

  const fallback = await fetchMLResult<T>(path);
  return { result: fallback, retries };
}

function normalizeMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}


function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeFee(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10000) / 10000;
}

function extractMlFee(listingPrices: any): number | null {
  return normalizeFee(Number(listingPrices?.sale_fee_details?.percentage_fee ?? listingPrices?.sale_fee_details?.meli_percentage_fee) / 100);
}

async function resolveSellerZip(): Promise<{ zip: string | null; warning?: string }> {
  const meResult = await fetchMLResult<any>('/users/me?attributes=address');
  if (!meResult.ok) {
    return { zip: null, warning: `Não foi possível consultar CEP do vendedor para frete ML: ${meResult.error?.message || `HTTP ${meResult.status}`}` };
  }
  const zip = String(meResult.data?.address?.zip_code || '').trim();
  return zip ? { zip } : { zip: null, warning: 'CEP do vendedor ausente no Mercado Livre; frete ML não calculado.' };
}

async function resolveCurrentMlPricing(item: any, sellerZip: string | null): Promise<{
  mlFee: number | null;
  mlShipping: number | null;
  warning?: string;
}> {
  let mlFee: number | null = null;
  let mlShipping: number | null = null;
  const itemId = String(item?.id || '').trim();
  const price = Number(item?.price || 0);
  const categoryId = String(item?.category_id || '').trim();
  const listingType = String(item?.listing_type_id || 'gold_pro').trim();

  if (price > 0 && categoryId && listingType) {
    const listingPricesResult = await fetchMLResult<any>(
      `/sites/MLB/listing_prices?price=${encodeURIComponent(String(price))}&category_id=${encodeURIComponent(categoryId)}&listing_type_id=${encodeURIComponent(listingType)}`,
    );
    if (listingPricesResult.ok) mlFee = extractMlFee(listingPricesResult.data);
  }

  const configuredShipping = getConfiguredMlShippingCost(item?.shipping?.mode);
  if (configuredShipping !== null) {
    mlShipping = configuredShipping;
  } else if (itemId && sellerZip) {
    const shippingResult = await fetchMLResult<any>(
      `/items/${encodeURIComponent(itemId)}/shipping_options?zip_code=${encodeURIComponent(sellerZip)}`,
    );
    if (shippingResult.ok) {
      const options = Array.isArray(shippingResult.data?.options) ? shippingResult.data.options : [];
      const freeOption = options.find((option: any) => Number(option?.cost) === 0 && Number(option?.list_cost) > 0);
      const pricedOption = options.find((option: any) => Number(option?.list_cost) > 0);
      const nextShipping = Number(freeOption?.list_cost ?? pricedOption?.list_cost ?? 0);
      if (Number.isFinite(nextShipping) && nextShipping > 0) mlShipping = roundMoney(nextShipping);
    } else {
      return { mlFee, mlShipping, warning: `Frete ML não retornado para ${itemId}: ${shippingResult.error?.message || `HTTP ${shippingResult.status}`}` };
    }
  }

  return { mlFee, mlShipping };
}

function getItemShippingMode(item: any) {
  return String(item?.shipping?.mode || '').trim().toLowerCase();
}

function requiresMercadoEnviosPause(item: any) {
  const shippingMode = getItemShippingMode(item);
  return String(item?.status || '').toLowerCase() === 'active'
    && shippingMode !== 'me2'
    && shippingMode !== 'not_specified';
}

function shouldPauseForNoCoverage(item: any, warning?: string) {
  return String(item?.status || '').toLowerCase() === 'active'
    && getItemShippingMode(item) === 'me2'
    && String(warning || '').toLowerCase().includes('no coverage options found');
}

async function pauseListing(itemId: string) {
  const result = await fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'paused' }),
  });
  return { ok: result.ok, error: result.error?.message || null };
}

function parseVisitsPayload(payload: any): Map<string, number> {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.visits)
        ? payload.visits
        : payload?.item_id
          ? [payload]
          : [];
  const byItemId = new Map<string, number>();

  for (const row of rows) {
    const itemId = String(row?.item_id || row?.id || '').trim();
    if (!itemId) continue;
    const total = normalizeMetric(row?.total_visits ?? row?.visits ?? row?.quantity);
    if (total !== null) byItemId.set(itemId, total);
  }

  return byItemId;
}

function formatMlVisitsDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function fetchVisitsByItemId(
  items: Array<{ itemId: string; startTime: string | null }>,
  warnings: Array<{ code: string; message: string; context?: Record<string, unknown> }>,
): Promise<Map<string, number>> {
  const visitsByItemId = new Map<string, number>();
  const dateTo = formatMlVisitsDate(new Date());

  await runPool(items, VISITS_CONCURRENCY, async (item) => {
    if (!item.itemId) return;
    const startMs = item.startTime && !Number.isNaN(new Date(item.startTime).getTime())
      ? new Date(item.startTime).getTime()
      : Date.now() - 365 * 24 * 60 * 60 * 1000;
    const dateFrom = formatMlVisitsDate(new Date(startMs));
    const path = `/items/${encodeURIComponent(item.itemId)}/visits?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`;
    const result = await fetchMLResult<any>(path);
    if (!result.ok || !result.data) {
      warnings.push({
        code: 'ml_item_visits_fetch_failed',
        message: result.error?.message || 'Falha ao carregar visitas dos anúncios no ML',
        context: {
          itemId: item.itemId,
          status: result.status || null,
          category: result.error?.category || null,
          code: result.error?.code || null,
        },
      });
      return;
    }

    for (const [itemId, visits] of parseVisitsPayload(result.data)) {
      visitsByItemId.set(itemId, visits);
    }
  });

  return visitsByItemId;
}

async function fetchAllMlItemIds(sellerId: string | number): Promise<{
  ok: boolean;
  itemIds: string[];
  pagesFetched: number;
  retriesTransient: number;
  error?: {
    code: string;
    category: string;
    upstream_status: number | null;
    trace_id: string | null;
    message: string;
    endpoint: string;
    retries: number;
  };
}> {
  const uniqueIds = new Set<string>();
  let pagesFetched = 0;
  let retriesTransient = 0;
  let scrollId: string | null = null;

  while (true) {
    const requestPath: string = scrollId
      ? `/users/${encodeURIComponent(String(sellerId))}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : `/users/${encodeURIComponent(String(sellerId))}/items/search?search_type=scan&limit=${ML_SCAN_PAGE_SIZE}`;

    const scanCheck: { result: MLRequestResult<any>; retries: number } = await fetchMLResultWithRetry<any>(requestPath);
    retriesTransient += scanCheck.retries;
    const scanResult: MLRequestResult<any> = scanCheck.result;

    if (!scanResult.ok || !scanResult.data) {
      return {
        ok: false,
        itemIds: [],
        pagesFetched,
        retriesTransient,
        error: {
          code: scanResult.error?.code || 'ml_items_scan_failed',
          category: scanResult.error?.category || 'error',
          upstream_status: scanResult.status,
          trace_id: scanResult.error?.traceId || null,
          message: scanResult.error?.message || 'Erro ao buscar anúncios completos no ML',
          endpoint: '/users/{seller_id}/items/search?search_type=scan',
          retries: scanCheck.retries,
        },
      };
    }

    pagesFetched += 1;
    const payload: any = scanResult.data;
    const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
    for (const rawId of results) {
      const itemId = String(rawId || '').trim();
      if (itemId) uniqueIds.add(itemId);
    }

    const nextScrollId: string = String(payload?.scroll_id || '').trim();
    if (!nextScrollId || results.length === 0) {
      return {
        ok: true,
        itemIds: Array.from(uniqueIds),
        pagesFetched,
        retriesTransient,
      };
    }

    // O scroll retornado na primeira página identifica toda a varredura.
    // Não persistimos esse cursor: ele é efêmero e vive somente nesta chamada.
    scrollId = resolveMlObservedScrollId(scrollId, nextScrollId);
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || '').trim();
  const syncJobId = String(body?.syncJobId || '').trim() || null;
  const requestedItemIds = normalizeMlObservedItemIds(body?.itemIds);
  const total = Math.max(requestedItemIds.length, Math.trunc(Number(body?.totalMl || 0)));

  if (!['manifest', 'batch'].includes(action)) {
    return NextResponse.json({
      success: false,
      error: 'Ação interna inválida. Use manifest ou batch.',
    }, { status: 400 });
  }
  if (action === 'batch' && (requestedItemIds.length === 0 || requestedItemIds.length > ML_OBSERVED_BATCH_SIZE)) {
    return NextResponse.json({
      success: false,
      error: `O lote deve conter entre 1 e ${ML_OBSERVED_BATCH_SIZE} IDs únicos.`,
    }, { status: 400 });
  }

  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  const warnings: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;
  const domain = 'anuncios:ml_pull';

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_listings_observed',
      ownerJobId: syncJobId,
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/anuncios', action },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_ml_listings_observed',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { seen: 0, snapshot_upserted: 0, failed: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const meResult = await fetchMLResult<any>('/users/me');
    if (!meResult.ok || !meResult.data) {
      if (meResult.error?.category === 'auth_fatal') {
        const auth = await getMLAuthDiagnostics();
        return NextResponse.json({
          success: false,
          domain,
          failure_reason: 'auth_fatal',
          auth_state: auth.state,
          auth_blocked_until: auth.blocked_until,
          errors: [{ code: 'ml_auth_fatal', message: 'Integração ML requer reconexão para sincronizar anúncios' }],
        }, { status: 401 });
      }
      return NextResponse.json({
        success: false,
        domain,
        errors: [{ code: 'ml_connect_failed', message: 'Erro ao conectar com ML' }],
      }, { status: 502 });
    }

    const me = meResult.data;

    if (action === 'manifest') {
      const scan = await fetchAllMlItemIds(me.id);
      if (scan.ok) {
        return NextResponse.json({
          success: true,
          action,
          seller_id: Number(me.id),
          item_ids: scan.itemIds,
          total: scan.itemIds.length,
          scan_pages_fetched: scan.pagesFetched,
          retries_transient: scan.retriesTransient,
          duration: { ms: Date.now() - startedAt },
        });
      }

      if (scan.error?.category === 'auth_fatal') {
        const auth = await getMLAuthDiagnostics();
        return NextResponse.json({
          success: false,
          domain,
          failure_reason: 'auth_fatal',
          auth_state: auth.state,
          auth_blocked_until: auth.blocked_until,
          errors: [{ code: 'ml_auth_fatal', message: 'Integração ML requer reconexão para sincronizar anúncios' }],
        }, { status: 401 });
      }

      return NextResponse.json({
        success: false,
        domain,
        failure_reason: 'ml_upstream_error',
        code: scan.error?.code,
        category: scan.error?.category,
        upstream_status: scan.error?.upstream_status,
        errors: scan.error ? [scan.error] : [{ code: 'ml_items_scan_failed', message: 'Erro ao buscar anúncios completos no ML' }],
        retries_transient: scan.retriesTransient,
        scan_pages_fetched: scan.pagesFetched,
      }, { status: scan.error?.category === 'retryable' ? 424 : 502 });
    }

    const itemIds = requestedItemIds;

    const serviceClient = createServiceClient();
    const sellerZipResult = await resolveSellerZip();
    if (sellerZipResult.warning) warnings.push({ code: 'ml_seller_zip_unavailable', message: sellerZipResult.warning });

    const { data: manualPriceBlocks, error: manualPriceBlocksError } = await serviceClient
      .from('ml_manual_blocklist')
      .select('ml_item_id, sku')
      .eq('ativo', true);
    if (manualPriceBlocksError) {
      warnings.push({
        code: 'ml_manual_blocklist_query_failed',
        message: `Preços automáticos não serão recalculados nesta execução: ${manualPriceBlocksError.message}`,
      });
    }
    const blockedPriceItemIds = new Set(
      (manualPriceBlocks || []).map((row: any) => String(row.ml_item_id || '').trim()).filter(Boolean),
    );
    const blockedPriceSkus = new Set(
      (manualPriceBlocks || []).map((row: any) => String(row.sku || '').trim().toUpperCase()).filter(Boolean),
    );

    const snapshots: any[] = [];
    const catalogItemsBase: Array<{ id: string; item: any }> = [];
    const listingMetricsByItemId = new Map<string, { soldQuantity: unknown; startTime: string | null }>();
    const userProductIdByItemId = new Map<string, string>();
    let recordsFailed = 0;
    let pricingFieldsUpdated = 0;
    let performanceRefreshed = 0;
    let performanceSkippedFresh = 0;
    let performanceFailed = 0;
    let authoritativeStockEnqueued = 0;
    let authoritativeStockUnchanged = 0;
    let deletedListingsDetached = 0;
    const failedItemIds = new Set<string>();

    await runPool(itemIds, CONCURRENCY, async (itemId) => {
      const itemResult = await fetchMLResult<any>(`/items/${itemId}`);
      if (!itemResult.ok || !itemResult.data) {
        recordsFailed += 1;
        failedItemIds.add(itemId);
        errors.push({
          code: 'ml_item_fetch_failed',
          message: itemResult.error?.message || 'Falha ao carregar item do ML',
          context: { itemId },
        });
        return;
      }

      let item = itemResult.data;
      if (isMlListingDeleted(item)) {
        try {
          await detachDeletedMlListing(serviceClient, String(item.id));
          deletedListingsDetached += 1;
        } catch (error: any) {
          recordsFailed += 1;
          failedItemIds.add(itemId);
          errors.push({
            code: 'ml_deleted_listing_detach_failed',
            message: error?.message || 'Falha ao remover referências de anúncio excluído',
            context: { itemId: String(item.id) },
          });
        }
        return;
      }
      const sku = extractMlItemSku(item);

      let produtoId: string | null = null;
      let skuLocal: string | null = null;

      const { data: byItem } = await serviceClient
        .from('produtos')
        .select('id, sku, nome, descricao, categoria, marca, gtin, oferta_preferencial_id, fornecedor_preferencial_manual, custo, ml_fee, ml_shipping, custom_price, ml_status, estoque, ativo')
        .eq('ml_item_id', String(item.id))
        .maybeSingle();

      const bySku = !byItem && sku
        ? await serviceClient
            .from('produtos')
            .select('id, sku, nome, descricao, categoria, marca, gtin, oferta_preferencial_id, fornecedor_preferencial_manual, custo, ml_fee, ml_shipping, custom_price, ml_status, estoque, ativo')
            .eq('sku', sku)
            .maybeSingle()
        : { data: null } as any;

      let produto = byItem || bySku.data || null;
      if (!produto?.id && sku) {
        const [{ data: byOfferSku }, { data: bySupplierSku }] = await Promise.all([
          serviceClient
            .from('produto_fornecedor_ofertas')
            .select('produto_id')
            .eq('sku_oferta', sku)
            .limit(1)
            .maybeSingle(),
          serviceClient
            .from('produto_fornecedor_ofertas')
            .select('produto_id')
            .eq('sku_fornecedor', sku)
            .limit(1)
            .maybeSingle(),
        ]);
        const productId = String((byOfferSku as any)?.produto_id || (bySupplierSku as any)?.produto_id || '').trim();
        if (productId) {
          const { data: productByOffer } = await serviceClient
            .from('produtos')
            .select('id, sku, nome, descricao, categoria, marca, gtin, oferta_preferencial_id, fornecedor_preferencial_manual, custo, ml_fee, ml_shipping, custom_price, ml_status, estoque, ativo')
            .eq('id', productId)
            .maybeSingle();
          produto = productByOffer || null;
        }
      }
      if (produto?.id) {
        produtoId = String(produto.id);
        skuLocal = String(produto.sku || '') || null;

        const { data: identityOffers, error: identityOffersError } = await serviceClient
          .from('produto_fornecedor_ofertas')
          .select('id, dslite_fornecedor_id, nome, descricao, custo, estoque, prioridade, ativo')
          .eq('produto_id', produtoId);
        if (identityOffersError) {
          errors.push({
            code: 'ml_identity_supplier_evidence_failed',
            message: identityOffersError.message,
            context: { mlItemId: String(item.id), produtoId },
          });
          produtoId = null;
          skuLocal = null;
          produto = null;
        } else {
          const identityConflicts = findMlProductIdentityConflicts(
            item,
            produto,
            identityOffers || [],
          );
          if (identityConflicts.length > 0) {
            const reason = `Divergência material de identidade ML: ${identityConflicts
              .map((conflict) => `${conflict.field} local=${conflict.expected} remoto=${conflict.remote}`)
              .join('; ')}`;
            const blockResult = await ensureMlIdentityManualBlock(
              serviceClient,
              String(item.id),
              reason,
            );
            if (!blockResult.ok) {
              errors.push({
                code: 'ml_identity_manual_block_failed',
                message: blockResult.error,
                context: { mlItemId: String(item.id), produtoId },
              });
            }
            warnings.push({
              code: 'ml_listing_identity_mismatch_blocked',
              message: reason,
              context: {
                mlItemId: String(item.id),
                produtoId,
                conflicts: identityConflicts,
              },
            });
            produtoId = null;
            skuLocal = null;
            produto = null;
          }
        }

        if (produto?.ativo !== false && produto?.id) {
          const pricing = await resolveCurrentMlPricing(item, sellerZipResult.zip);
          if (pricing.warning) {
            warnings.push({
              code: 'ml_pricing_shipping_unavailable',
              message: pricing.warning,
              context: { mlItemId: String(item.id), produtoId },
            });
          }

          const pauseForNoCoverage = shouldPauseForNoCoverage(item, pricing.warning);
          const pauseForInvalidMode = requiresMercadoEnviosPause(item);
          if (pauseForInvalidMode || pauseForNoCoverage) {
            const pauseResult = await pauseListing(String(item.id));
            if (pauseResult.ok) {
              item = { ...item, status: 'paused' };
              warnings.push({
                code: 'ml_listing_paused_due_invalid_shipping',
                message: pauseForNoCoverage
                  ? `Anúncio ${String(item.id)} pausado automaticamente: frete sem cobertura no ML.`
                  : `Anúncio ${String(item.id)} pausado automaticamente: não possui entrega Mercado Livre (ME2).`,
                context: { mlItemId: String(item.id), produtoId },
              });
            } else {
              warnings.push({
                code: 'ml_listing_pause_failed',
                message: `Falha ao pausar anúncio ${String(item.id)} após frete inválido: ${pauseResult.error || 'erro desconhecido'}`,
                context: { mlItemId: String(item.id), produtoId },
              });
            }
          }

          const productPatch: Record<string, unknown> = {};
          if (pricing.mlFee !== null && Math.abs(Number(produto.ml_fee || 0) - pricing.mlFee) >= 0.0001) productPatch.ml_fee = pricing.mlFee;
          if (pricing.mlShipping !== null && Math.abs(Number(produto.ml_shipping || 0) - pricing.mlShipping) >= 0.01) productPatch.ml_shipping = pricing.mlShipping;
          if (pricing.mlShipping !== null) productPatch.ml_shipping_warning = null;
          else if (pricing.warning) productPatch.ml_shipping_warning = pricing.warning;

          const configuredShipping = getConfiguredMlShippingCost(item?.shipping?.mode);
          const configuredShippingChanged = configuredShipping !== null
            && Math.abs(Number(produto.ml_shipping || 0) - configuredShipping) >= 0.01;
          const priceAutomationBlocked = Boolean(manualPriceBlocksError)
            || blockedPriceItemIds.has(String(item.id))
            || blockedPriceSkus.has(String(produto.sku || '').trim().toUpperCase());
          let configuredShippingPrice: number | null = null;

          if (configuredShippingChanged && !priceAutomationBlocked) {
            try {
              configuredShippingPrice = calculateSuggestedPrice({
                cost: Number(produto.custo || 0),
                shipping: configuredShipping,
                mlFee: Number(pricing.mlFee ?? produto.ml_fee ?? 0.15),
              }).suggestedPrice;
              productPatch.custom_price = configuredShippingPrice;
            } catch (error: any) {
              warnings.push({
                code: 'ml_configured_shipping_price_calculation_failed',
                message: error?.message || 'Falha ao recalcular preço com frete configurado',
                context: { mlItemId: String(item.id), produtoId },
              });
            }
          }

          if (Object.keys(productPatch).length > 0) {
            productPatch.updated_at = new Date().toISOString();
            const { error: pricingUpdateError } = await serviceClient
              .from('produtos')
              .update(productPatch as any)
              .eq('id', String(produtoId));

            if (pricingUpdateError) {
              errors.push({
                code: 'produto_ml_pricing_update_failed',
                message: pricingUpdateError.message,
                context: { mlItemId: String(item.id), produtoId },
              });
            } else {
              pricingFieldsUpdated += 1;
              if (
                configuredShippingPrice !== null
                && ['active', 'paused'].includes(String(item.status || '').toLowerCase())
                && Math.abs(Number(item.price || 0) - configuredShippingPrice) >= 0.01
              ) {
                const outbox = await enqueueMlPublishOutbox(serviceClient, {
                  produtoId: String(produtoId),
                  mlItemId: String(item.id),
                  desiredPrice: configuredShippingPrice,
                  source: 'ml_not_specified_fixed_shipping_price',
                  dedupePending: true,
                  payload: {
                    apply_price: true,
                    apply_quantity_pricing: true,
                    apply_quantity: false,
                    apply_status: false,
                    base_price_for_quantity_pricing: configuredShippingPrice,
                    shipping_mode: 'not_specified',
                    configured_shipping: configuredShipping,
                  },
                });
                if (!outbox.ok) {
                  warnings.push({
                    code: 'ml_configured_shipping_price_enqueue_failed',
                    message: outbox.error,
                    context: { mlItemId: String(item.id), produtoId },
                  });
                }
              }
            }
          }
        }
      }

      const observedStatus = String(item.status || '').trim().toLowerCase();
      if (produtoId && produto?.ativo !== false && ['active', 'paused'].includes(observedStatus)) {
        try {
          const stockSync = await enfileirarSyncMlEstoqueInterno(produtoId, {
            mlItemId: String(item.id),
            availableQuantity: item.available_quantity === null || item.available_quantity === undefined
              ? null
              : Number(item.available_quantity),
            status: observedStatus,
          });
          authoritativeStockEnqueued += stockSync.enfileirados;
          authoritativeStockUnchanged += stockSync.semAlteracao;
        } catch (error: any) {
          warnings.push({
            code: 'ml_authoritative_stock_reconcile_failed',
            message: error?.message || 'Falha ao reconciliar estoque autoritativo do Vortek',
            context: { mlItemId: String(item.id), produtoId },
          });
        }
      }

      const isCatalogListing = item.catalog_listing === true;
      if (isCatalogListing) {
        catalogItemsBase.push({ id: String(item.id), item });
      }
      listingMetricsByItemId.set(String(item.id), {
        soldQuantity: item.sold_quantity,
        startTime: item.start_time || null,
      });
      const userProductId = String(item.user_product_id || '').trim();
      if (userProductId) userProductIdByItemId.set(String(item.id), userProductId);

      snapshots.push({
        ml_item_id: String(item.id),
        seller_id: Number(me.id),
        catalog_listing: isCatalogListing,
        title: item.title || null,
        status: item.status || null,
        price: Number(item.price || 0),
        permalink: item.permalink || null,
        thumbnail: item.thumbnail || null,
        seller_sku: sku,
        catalog_product_id: item.catalog_product_id || null,
        category_id: item.category_id || null,
        domain_id: item.domain_id || null,
        related_item_id: null,
        related_permalink: null,
        buy_box_status: null,
        buy_box_winning: false,
        price_to_win: null,
        produto_id: produtoId,
        sku_local: skuLocal,
        last_updated_ml: item.last_updated || null,
        synced_at: new Date().toISOString(),
      });
    });

    const visitsByItemId = await fetchVisitsByItemId(
      Array.from(listingMetricsByItemId.entries()).map(([itemId, metrics]) => ({
        itemId,
        startTime: metrics.startTime,
      })),
      warnings,
    );

    const previousSnapshotByItemId = new Map<string, {
      related_item_id: string | null;
      related_permalink: string | null;
      buy_box_status: string | null;
      buy_box_winning: boolean | null;
      price_to_win: number | null;
    }>();

    const catalogIds = catalogItemsBase.map((x) => x.id);
    for (let i = 0; i < catalogIds.length; i += 500) {
      const slice = catalogIds.slice(i, i + 500);
      if (slice.length === 0) continue;
      const { data: prevRows } = await serviceClient
        .from('catalogo_ml_snapshot')
        .select('ml_item_id, related_item_id, related_permalink, buy_box_status, buy_box_winning, price_to_win')
        .in('ml_item_id', slice);
      for (const row of prevRows || []) {
        previousSnapshotByItemId.set(String(row.ml_item_id), {
          related_item_id: row.related_item_id || null,
          related_permalink: row.related_permalink || null,
          buy_box_status: row.buy_box_status || null,
          buy_box_winning: typeof row.buy_box_winning === 'boolean' ? row.buy_box_winning : null,
          price_to_win: row.price_to_win === null || row.price_to_win === undefined ? null : Number(row.price_to_win),
        });
      }
    }

    const relatedPermalinkById = new Map<string, string | null>();
    const catalogEnrichedByItemId = new Map<string, {
      related_item_id: string | null;
      related_permalink: string | null;
      buy_box_status: string | null;
      buy_box_winning: boolean;
      price_to_win: number | null;
    }>();

    await runPool(catalogItemsBase, CATALOG_ENRICH_CONCURRENCY, async (entry) => {
      const itemId = entry.id;
      const item = entry.item;

      const priceResult = await fetchMLResult<any>(`/items/${itemId}/price_to_win?version=v2`);
      const pricePayload = priceResult.ok && priceResult.data ? priceResult.data : null;
      if (!pricePayload) {
        errors.push({
          code: 'catalog_enrichment_price_to_win_unavailable',
          message: priceResult.error?.message || 'Falha transitória ao obter price_to_win',
          context: { itemId, category: priceResult.error?.category || null, status: priceResult.status || null },
        });
      }

      const baseRelatedId = buildCatalogEnrichment({
        item,
        priceToWinPayload: null,
        relatedPermalink: null,
      }).relatedItemId;

      let relatedPermalink: string | null = null;
      if (baseRelatedId) {
        if (relatedPermalinkById.has(baseRelatedId)) {
          relatedPermalink = relatedPermalinkById.get(baseRelatedId) || null;
        } else {
          const relatedResult = await fetchMLResult<any>(`/items/${baseRelatedId}`);
          relatedPermalink = relatedResult.ok && relatedResult.data ? (relatedResult.data.permalink || null) : null;
          relatedPermalinkById.set(baseRelatedId, relatedPermalink);
          if (!relatedResult.ok || !relatedResult.data) {
            errors.push({
              code: 'catalog_enrichment_related_permalink_unavailable',
              message: relatedResult.error?.message || 'Falha transitória ao obter permalink do relacionado',
              context: { itemId, relatedItemId: baseRelatedId, category: relatedResult.error?.category || null, status: relatedResult.status || null },
            });
          }
        }
      }

      const enrichment = buildCatalogEnrichment({
        item,
        priceToWinPayload: pricePayload,
        relatedPermalink,
      });

      const previous = previousSnapshotByItemId.get(itemId);
      catalogEnrichedByItemId.set(itemId, {
        related_item_id: enrichment.relatedItemId ?? previous?.related_item_id ?? null,
        related_permalink: enrichment.relatedPermalink ?? previous?.related_permalink ?? null,
        buy_box_status: enrichment.buyBoxStatus ?? previous?.buy_box_status ?? null,
        buy_box_winning: enrichment.buyBoxStatus
          ? enrichment.buyBoxWinning
          : (typeof previous?.buy_box_winning === 'boolean' ? previous.buy_box_winning : false),
        price_to_win: enrichment.priceToWin ?? previous?.price_to_win ?? null,
      });
    });

    for (const snapshot of snapshots) {
      const itemId = String(snapshot.ml_item_id);
      if (snapshot.catalog_listing === true) {
        const enriched = catalogEnrichedByItemId.get(itemId);
        if (enriched) {
          snapshot.related_item_id = enriched.related_item_id;
          snapshot.related_permalink = enriched.related_permalink;
          snapshot.buy_box_status = enriched.buy_box_status;
          snapshot.buy_box_winning = enriched.buy_box_winning;
          snapshot.price_to_win = enriched.price_to_win;
        } else {
          const previous = previousSnapshotByItemId.get(itemId);
          snapshot.related_item_id = previous?.related_item_id ?? null;
          snapshot.related_permalink = previous?.related_permalink ?? null;
          snapshot.buy_box_status = previous?.buy_box_status ?? null;
          snapshot.buy_box_winning = typeof previous?.buy_box_winning === 'boolean' ? previous.buy_box_winning : false;
          snapshot.price_to_win = previous?.price_to_win ?? null;
        }
      } else {
        snapshot.related_item_id = null;
        snapshot.related_permalink = null;
        snapshot.buy_box_status = null;
        snapshot.buy_box_winning = false;
        snapshot.price_to_win = null;
      }
    }

    if (snapshots.length > 0) {
      const { error: upsertError } = await (serviceClient
        .from('catalogo_ml_snapshot' as any)
        .upsert(snapshots as any, { onConflict: 'ml_item_id' }) as any);
      if (upsertError) {
        errors.push({
          code: 'catalog_snapshot_upsert_failed',
          message: upsertError.message,
        });
        return NextResponse.json({
          success: false,
          domain,
          job: {
            key: 'sync_ml_listings_observed',
            started_at: new Date(startedAt).toISOString(),
            finished_at: new Date().toISOString(),
            lock_acquired: true,
          },
          cursor: null,
          records: { seen: itemIds.length, snapshot_upserted: 0, failed: recordsFailed + snapshots.length },
          errors,
          warnings,
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }

      const { data: existingAnuncios, error: existingAnunciosError } = await (serviceClient
        .from('anuncios_ml')
        .select('id, produto_id, ml_item_id, preco_ml, status, titulo, permalink, thumbnail, vendidos, visitas, qualidade, qualidade_info')
        .in('ml_item_id', snapshots.map((snapshot) => String(snapshot.ml_item_id))) as any);

      if (existingAnunciosError) {
        errors.push({
          code: 'anuncios_ml_existing_query_failed',
          message: existingAnunciosError.message,
        });
      } else {
        let existingByItemId = new Map<string, any>(
          (existingAnuncios || []).map((row: any) => [String(row.ml_item_id), row]),
        );

        const missingSnapshots = snapshots.filter((snapshot) => (
          snapshot.produto_id
          && snapshot.sku_local
          && !existingByItemId.has(String(snapshot.ml_item_id))
        ));
        await runPool(missingSnapshots, CONCURRENCY, async (snapshot) => {
          const persistResult = await persistSingleAnuncioBySku(serviceClient, {
            ml_item_id: String(snapshot.ml_item_id),
            produto_id: String(snapshot.produto_id),
            sku: String(snapshot.sku_local),
            titulo: String(snapshot.title || snapshot.sku_local),
            preco_ml: Number(snapshot.price || 0),
            status: mapMlStatusToLocalStatus(snapshot.status),
            catalogo: snapshot.catalog_listing === true,
            thumbnail: snapshot.thumbnail || null,
            permalink: snapshot.permalink || null,
            updated_at: new Date().toISOString(),
          });
          if (!persistResult.ok) {
            errors.push({
              code: 'anuncios_ml_missing_persist_failed',
              message: persistResult.error,
              context: { mlItemId: snapshot.ml_item_id, produtoId: snapshot.produto_id },
            });
          }
        });

        if (missingSnapshots.length > 0) {
          const { data: refreshedAnuncios, error: refreshedAnunciosError } = await (serviceClient
            .from('anuncios_ml')
            .select('id, produto_id, ml_item_id, preco_ml, status, titulo, permalink, thumbnail, vendidos, visitas, qualidade, qualidade_info, ml_sync_block_reason, ml_sync_blocked_until, ml_sync_last_error')
            .in('ml_item_id', snapshots.map((snapshot) => String(snapshot.ml_item_id))) as any);
          if (refreshedAnunciosError) {
            errors.push({
              code: 'anuncios_ml_refreshed_query_failed',
              message: refreshedAnunciosError.message,
            });
          } else {
            existingByItemId = new Map<string, any>(
              (refreshedAnuncios || []).map((row: any) => [String(row.ml_item_id), row]),
            );
          }
        }

        await runPool(snapshots, CONCURRENCY, async (snapshot) => {
          const existing = existingByItemId.get(String(snapshot.ml_item_id));
          if (!existing) return;
          const itemId = String(snapshot.ml_item_id);

          if (shouldRefreshPerformance(existing.qualidade_info, Date.now())) {
            const performanceCheck = await fetchListingPerformance(itemId, userProductIdByItemId.get(itemId) || null);
            const performance = performanceCheck.result;
            const score = performance.ok && performance.data
              ? normalizePerformanceScore(performance.data.score)
              : null;

            if (score === null) {
              performanceFailed += 1;
              warnings.push({
                code: 'ml_listing_performance_unavailable',
                message: performance.error?.message || 'Qualidade real não disponível para este anúncio no ML',
                context: {
                  itemId,
                  status: performance.status,
                  category: performance.error?.category || null,
                  code: performance.error?.code || null,
                  retries: performanceCheck.retries,
                  endpoint: performanceCheck.endpoint,
                },
              });
            } else {
              const refreshedAt = new Date().toISOString();
              const { error: performanceUpdateError } = await serviceClient
                .from('anuncios_ml')
                .update({
                  qualidade: score,
                  qualidade_info: buildPerformanceInfo(performance.data!, refreshedAt),
                  updated_at: refreshedAt,
                } as any)
                .eq('ml_item_id', itemId);

              if (performanceUpdateError) {
                performanceFailed += 1;
                errors.push({
                  code: 'ml_listing_performance_persist_failed',
                  message: performanceUpdateError.message,
                  context: { itemId },
                });
              } else {
                performanceRefreshed += 1;
              }
            }
          } else {
            performanceSkippedFresh += 1;
          }

          const reconcileResult = await reconcileAnuncioMlFromItem(
            serviceClient,
            {
              id: snapshot.ml_item_id,
              price: snapshot.price,
              status: snapshot.status,
              title: snapshot.title,
              permalink: snapshot.permalink,
              thumbnail: snapshot.thumbnail,
              sold_quantity: listingMetricsByItemId.get(String(snapshot.ml_item_id))?.soldQuantity,
              visits: visitsByItemId.get(String(snapshot.ml_item_id)),
            },
            'observed_sync',
            existing,
          );
          if (!reconcileResult.ok) {
            errors.push({
              code: 'anuncios_ml_reconcile_failed',
              message: reconcileResult.error,
              context: { mlItemId: snapshot.ml_item_id, source: 'observed_sync' },
            });
          }
        });

        const affectedProductIds = Array.from(new Set<string>(
          snapshots
            .map((snapshot) => String(snapshot.produto_id || '').trim())
            .filter(Boolean),
        ));
        await runPool(affectedProductIds, CONCURRENCY, async (produtoId) => {
          try {
            await syncProdutoOperationalListing(serviceClient, produtoId);
          } catch (error: any) {
            errors.push({
              code: 'produto_operational_listing_sync_failed',
              message: error?.message || 'Falha ao selecionar anúncio operacional',
              context: { produtoId },
            });
          }
        });
      }
    }

    let catalogRefreshTriggered = false;

    try {
      const lastTriggerRaw = await getSyncRuntimeConfigValue(CATALOG_REFRESH_TRIGGER_KEY);
      const lastTriggerMs = lastTriggerRaw ? new Date(lastTriggerRaw).getTime() : 0;
      const shouldTriggerRefresh = !lastTriggerMs || (Date.now() - lastTriggerMs) >= CATALOG_REFRESH_TRIGGER_INTERVAL_MS;

      if (shouldTriggerRefresh) {
        await setSyncRuntimeConfigValue(CATALOG_REFRESH_TRIGGER_KEY, new Date().toISOString());
        catalogRefreshTriggered = true;
        const internalBaseUrl = process.env.INTERNAL_APP_URL || new URL(request.url).origin;
        const refreshUrl = new URL('/api/catalogo/no-catalogo/refresh', internalBaseUrl).toString();

        setTimeout(() => {
          void fetch(refreshUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify({ mode: 'incremental' }),
          }).catch((err: any) => {
            console.error('[sync-anuncios] falha ao disparar refresh incremental do catálogo', err?.message || err);
          });
        }, 0);
      }
    } catch (err: any) {
      errors.push({
        code: 'catalog_refresh_trigger_failed',
        message: err?.message || 'Falha ao avaliar disparo do refresh de catálogo',
      });
    }

    return NextResponse.json({
      success: true,
      partial: errors.length > 0 || warnings.length > 0 || failedItemIds.size > 0,
      action,
      domain,
      job: {
        key: 'sync_ml_listings_observed',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      records: {
        seen: itemIds.length,
        snapshot_upserted: snapshots.length,
        failed: recordsFailed,
        pricing_fields_updated: pricingFieldsUpdated,
        performance_refreshed: performanceRefreshed,
        performance_skipped_fresh: performanceSkippedFresh,
        performance_failed: performanceFailed,
        authoritative_stock_enqueued: authoritativeStockEnqueued,
        authoritative_stock_unchanged: authoritativeStockUnchanged,
        deleted_listings_detached: deletedListingsDetached,
      },
      errors,
      warnings,
      processed_item_ids: itemIds.filter((itemId) => !failedItemIds.has(itemId)),
      failed_item_ids: Array.from(failedItemIds),
      duration: { ms: Date.now() - startedAt },
      scan_pages_fetched: 0,
      retries_transient: 0,
      ok: failedItemIds.size === 0,
      sincronizados: snapshots.length,
      total,
      catalog_refresh_triggered: catalogRefreshTriggered,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      job: {
        key: 'sync_ml_listings_observed',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      records: { seen: 0, snapshot_upserted: 0, failed: 0 },
      errors: [{ code: 'ml_listings_sync_unexpected_error', message: err?.message || 'Erro inesperado no sync de anúncios ML' }],
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
