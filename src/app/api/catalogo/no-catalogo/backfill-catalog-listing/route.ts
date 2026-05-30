import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { buildCatalogEnrichment } from '@/lib/catalogo/no-catalogo';
import type { Database } from '@/types/database';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;
const DEFAULT_CONCURRENCY = 6;
const MAX_CONCURRENCY = 12;

function parsePositiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const intVal = Math.floor(parsed);
  return typeof max === 'number' ? Math.min(intVal, max) : intVal;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) break;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ success: false, error: 'Chave de API inválida' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const pageSize = parsePositiveInt(body?.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const maxPages = body?.maxPages == null ? Number.MAX_SAFE_INTEGER : parsePositiveInt(body?.maxPages, 1);
  const concurrency = parsePositiveInt(body?.concurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY);
  const dryRun = Boolean(body?.dryRun);
  const hydrate = Boolean(body?.hydrate);

  const service = createServiceClient();

  const { count: totalInSnapshot, error: countError } = await service
    .from('catalogo_ml_snapshot')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    return NextResponse.json({ success: false, error: `Falha ao contar snapshot: ${countError.message}` }, { status: 500 });
  }

  let processed = 0;
  let changed = 0;
  let failed = 0;
  let page = 0;
  const errorSamples: Array<{ ml_item_id: string; code: string; message: string }> = [];

  while (page < maxPages) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data: rows, error } = await service
      .from('catalogo_ml_snapshot')
      .select('id, ml_item_id, catalog_listing')
      .order('ml_item_id', { ascending: true })
      .range(from, to);

    if (error) {
      return NextResponse.json({
        success: false,
        error: `Falha ao carregar lote ${page + 1}: ${error.message}`,
        processed,
        changed,
        failed,
      }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      break;
    }

    processed += rows.length;
    const updates: Array<{ id: string; ml_item_id: string; catalog_listing: boolean; item: any | null }> = [];

    await runPool(rows, concurrency, async (row: any) => {
      const itemId = String(row.ml_item_id || '').trim();
      if (!itemId) return;

      const result = await fetchMLResult<any>(`/items/${itemId}`);
      if (!result.ok || !result.data) {
        failed += 1;
        if (errorSamples.length < 30) {
          errorSamples.push({
            ml_item_id: itemId,
            code: result.error?.code || 'ml_item_fetch_failed',
            message: result.error?.message || 'Falha ao consultar item no ML',
          });
        }
        return;
      }

      const catalogListingNow = result.data.catalog_listing === true;
      const shouldQueue = catalogListingNow !== Boolean(row.catalog_listing) || (hydrate && catalogListingNow);
      if (shouldQueue) {
        updates.push({
          id: String(row.id),
          ml_item_id: itemId,
          catalog_listing: catalogListingNow,
          item: result.data || null,
        });
      }
    });

    if (!dryRun && updates.length > 0) {
      await runPool(updates, Math.min(concurrency, 8), async (update) => {
        const updatePayload: Database['public']['Tables']['catalogo_ml_snapshot']['Update'] = {
          catalog_listing: update.catalog_listing,
        };

        if (hydrate && update.catalog_listing === true && update.item) {
          const item = update.item;
          const priceResult = await fetchMLResult<any>(`/items/${update.ml_item_id}/price_to_win?version=v2`);
          const pricePayload = priceResult.ok && priceResult.data ? priceResult.data : null;
          const relatedItemId = buildCatalogEnrichment({
            item,
            priceToWinPayload: null,
            relatedPermalink: null,
          }).relatedItemId;

          let relatedPermalink: string | null = null;
          if (relatedItemId) {
            const relatedResult = await fetchMLResult<any>(`/items/${relatedItemId}`);
            relatedPermalink = relatedResult.ok && relatedResult.data ? (relatedResult.data.permalink || null) : null;
            if (!relatedResult.ok || !relatedResult.data) {
              if (errorSamples.length < 30) {
                errorSamples.push({
                  ml_item_id: update.ml_item_id,
                  code: 'hydrate_related_permalink_unavailable',
                  message: relatedResult.error?.message || 'Falha ao obter permalink do relacionado',
                });
              }
            }
          }

          const enrichment = buildCatalogEnrichment({
            item,
            priceToWinPayload: pricePayload,
            relatedPermalink,
          });

          updatePayload.related_item_id = enrichment.relatedItemId;
          updatePayload.related_permalink = enrichment.relatedPermalink;
          updatePayload.buy_box_status = enrichment.buyBoxStatus;
          updatePayload.buy_box_winning = enrichment.buyBoxWinning;
          updatePayload.price_to_win = enrichment.priceToWin;

          if (!pricePayload && errorSamples.length < 30) {
            errorSamples.push({
              ml_item_id: update.ml_item_id,
              code: 'hydrate_price_to_win_unavailable',
              message: priceResult.error?.message || 'Falha ao obter price_to_win no hydrate',
            });
          }
        }

        if (hydrate && update.catalog_listing === false) {
          updatePayload.related_item_id = null;
          updatePayload.related_permalink = null;
          updatePayload.buy_box_status = null;
          updatePayload.buy_box_winning = false;
          updatePayload.price_to_win = null;
        }

        const { error: updateError } = await service
          .from('catalogo_ml_snapshot')
          .update(updatePayload)
          .eq('id', update.id)
          .eq('ml_item_id', update.ml_item_id);

        if (updateError) {
          failed += 1;
          if (errorSamples.length < 30) {
            errorSamples.push({
              ml_item_id: update.ml_item_id,
              code: 'snapshot_update_failed',
              message: updateError.message,
            });
          }
        }
      });
    }

    changed += updates.length;
    page += 1;
  }

  const durationMs = Date.now() - startedAt;

  console.log(JSON.stringify({
    event: 'catalog_snapshot_backfill_catalog_listing_done',
    total_in_snapshot: totalInSnapshot || 0,
    processed,
    changed,
    failed,
    pages: page,
    dry_run: dryRun,
    hydrate,
    duration_ms: durationMs,
    timestamp_utc: new Date().toISOString(),
  }));

  return NextResponse.json({
    success: true,
    dry_run: dryRun,
    hydrate,
    total_in_snapshot: totalInSnapshot || 0,
    processed,
    changed,
    failed,
    pages: page,
    page_size: pageSize,
    concurrency,
    duration_ms: durationMs,
    error_samples: errorSamples,
  });
}
