import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult, getMLAuthDiagnostics, type MLRequestResult } from '@/services/integration';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { getSyncRuntimeConfigValue, setSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';
import { buildCatalogEnrichment } from '@/lib/catalogo/no-catalogo';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';

export const maxDuration = 300;

const CONCURRENCY = 3;
const CATALOG_ENRICH_CONCURRENCY = 4;
const VISITS_CONCURRENCY = 3;
const TRANSIENT_RETRY_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 800;
const CATALOG_REFRESH_TRIGGER_KEY = 'catalog_no_catalogo_refresh_last_trigger_at';
const CATALOG_REFRESH_TRIGGER_INTERVAL_MS = 10 * 60 * 1000;

function extractSku(item: any): string | null {
  if (item?.seller_sku) return String(item.seller_sku).trim().toUpperCase();
  if (item?.seller_custom_field) return String(item.seller_custom_field).trim().toUpperCase();
  const skuAttr = Array.isArray(item?.attributes)
    ? item.attributes.find((a: any) => a.id === 'SELLER_SKU' && a.value_name)
    : null;
  if (skuAttr?.value_name) return String(skuAttr.value_name).trim().toUpperCase();
  return null;
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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const offset = Number(searchParams.get('offset') || 0);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || 100)));

  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  const warnings: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;
  const domain = 'anuncios:ml_pull';

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_listings_observed',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/anuncios' },
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
    const searchCheck = await fetchMLResultWithRetry<any>(`/users/${me.id}/items/search?limit=${limit}&offset=${offset}`);
    const searchResult = searchCheck.result;
    if (!searchResult.ok || !searchResult.data) {
      if (searchResult.error?.category === 'auth_fatal') {
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

      const diagnosticError = {
        code: searchResult.error?.code || 'ml_items_search_failed',
        category: searchResult.error?.category || 'error',
        upstream_status: searchResult.status,
        trace_id: searchResult.error?.traceId || null,
        message: searchResult.error?.message || 'Erro ao buscar anúncios no ML',
        endpoint: '/users/{seller_id}/items/search',
        retries: searchCheck.retries,
      };

      return NextResponse.json({
        success: false,
        domain,
        failure_reason: 'ml_upstream_error',
        code: diagnosticError.code,
        category: diagnosticError.category,
        upstream_status: diagnosticError.upstream_status,
        errors: [diagnosticError],
        retries_transient: searchCheck.retries,
      }, { status: diagnosticError.category === 'retryable' ? 424 : 502 });
    }
    const search = searchResult.data;

    const itemIds: string[] = Array.isArray(search.results) ? search.results : [];
    if (itemIds.length === 0) {
      return NextResponse.json({
        success: true,
        domain,
        job: {
          key: 'sync_ml_listings_observed',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: { offset, limit },
        records: { seen: 0, snapshot_upserted: 0, failed: 0 },
        errors,
        warnings,
        duration: { ms: Date.now() - startedAt },
        total: Number(search?.paging?.total || 0),
        proximo: offset,
        acabou: true,
      });
    }

    const serviceClient = createServiceClient();
    const snapshots: any[] = [];
    const catalogItemsBase: Array<{ id: string; item: any }> = [];
    const listingMetricsByItemId = new Map<string, { soldQuantity: unknown; startTime: string | null }>();
    let recordsFailed = 0;

    await runPool(itemIds, CONCURRENCY, async (itemId) => {
      const itemResult = await fetchMLResult<any>(`/items/${itemId}`);
      if (!itemResult.ok || !itemResult.data) {
        recordsFailed += 1;
        errors.push({
          code: 'ml_item_fetch_failed',
          message: itemResult.error?.message || 'Falha ao carregar item do ML',
          context: { itemId },
        });
        return;
      }

      const item = itemResult.data;
      const sku = extractSku(item);

      let produtoId: string | null = null;
      let skuLocal: string | null = null;

      const { data: byItem } = await serviceClient
        .from('produtos')
        .select('id, sku')
        .eq('ml_item_id', String(item.id))
        .maybeSingle();

      const bySku = !byItem && sku
        ? await serviceClient
            .from('produtos')
            .select('id, sku')
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
            .select('id, sku')
            .eq('id', productId)
            .maybeSingle();
          produto = productByOffer || null;
        }
      }
      if (produto?.id) {
        produtoId = String(produto.id);
        skuLocal = String(produto.sku || '') || null;
      }

      const isCatalogListing = item.catalog_listing === true;
      if (isCatalogListing) {
        catalogItemsBase.push({ id: String(item.id), item });
      }
      listingMetricsByItemId.set(String(item.id), {
        soldQuantity: item.sold_quantity,
        startTime: item.start_time || null,
      });

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
        .select('id, ml_item_id, preco_ml, status, titulo, permalink, thumbnail, vendidos, visitas')
        .in('ml_item_id', snapshots.map((snapshot) => String(snapshot.ml_item_id))) as any);

      if (existingAnunciosError) {
        errors.push({
          code: 'anuncios_ml_existing_query_failed',
          message: existingAnunciosError.message,
        });
      } else {
        const existingByItemId = new Map<string, any>(
          (existingAnuncios || []).map((row: any) => [String(row.ml_item_id), row]),
        );

        await runPool(snapshots, CONCURRENCY, async (snapshot) => {
          const existing = existingByItemId.get(String(snapshot.ml_item_id));
          if (!existing) return;
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
      }
    }

    const total = Number(search?.paging?.total || 0);
    const nextOffset = offset + limit;
    const done = nextOffset >= total || itemIds.length < limit;
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
      success: errors.length === 0,
      domain,
      job: {
        key: 'sync_ml_listings_observed',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: done ? null : { offset: nextOffset, limit },
      records: {
        seen: itemIds.length,
        snapshot_upserted: snapshots.length,
        failed: recordsFailed,
      },
      errors,
      warnings,
      duration: { ms: Date.now() - startedAt },
      // Compatibilidade:
      ok: errors.length === 0,
      sincronizados: snapshots.length,
      total,
      proximo: done ? null : nextOffset,
      acabou: done,
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
