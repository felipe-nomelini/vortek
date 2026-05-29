import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { isWinningBuyBoxStatus, normalizeBuyBoxStatus, normalizePriceToWin } from '@/lib/catalogo/no-catalogo';

const PAGE_SIZE = 100;
const MAX_INCREMENTAL_PAGES = 10;
const DETAIL_CONCURRENCY = 6;
const UPSERT_CHUNK_SIZE = 250;
const DELETE_CHUNK_SIZE = 500;

function extractRelatedItemId(itemRelations: any): string | null {
  if (!Array.isArray(itemRelations)) return null;

  for (const rel of itemRelations) {
    if (!rel || typeof rel !== 'object') continue;

    const direct = rel.id ?? rel.item_id ?? rel.itemId;
    if (direct !== undefined && direct !== null && String(direct).trim()) {
      return String(direct).trim();
    }

    const nested = rel?.item?.id ?? rel?.item?.item_id ?? rel?.item?.itemId;
    if (nested !== undefined && nested !== null && String(nested).trim()) {
      return String(nested).trim();
    }
  }

  return null;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(worker));
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === 'full' ? 'full' : 'incremental';

  const meResult = await fetchMLResult<{ id: number }>('/users/me');
  if (!meResult.ok || !meResult.data?.id) {
    return NextResponse.json({
      success: false,
      error: meResult.error?.message || 'Falha ao obter usuário ML',
      auth_fatal: meResult.error?.category === 'auth_fatal',
    }, { status: meResult.status || 500 });
  }
  const sellerId = meResult.data.id;
  const service = createServiceClient();

  console.log(JSON.stringify({
    event: 'catalog_snapshot_refresh_start',
    seller_id: sellerId,
    mode,
    timestamp_utc: new Date().toISOString(),
  }));

  const warnings: string[] = [];
  const allItemIds: string[] = [];
  let totalMl = 0;

  const maxPages = mode === 'full' ? Number.MAX_SAFE_INTEGER : MAX_INCREMENTAL_PAGES;
  for (let pageIdx = 0; pageIdx < maxPages; pageIdx += 1) {
    const offset = pageIdx * PAGE_SIZE;
    const searchResult = await fetchMLResult<{ results: string[]; paging?: { total?: number } }>(
      `/users/${sellerId}/items/search?catalog_listing=true&offset=${offset}&limit=${PAGE_SIZE}`,
    );

    if (!searchResult.ok || !searchResult.data) {
      return NextResponse.json({
        success: false,
        error: searchResult.error?.message || 'Falha ao buscar itens de catálogo',
        auth_fatal: searchResult.error?.category === 'auth_fatal',
      }, { status: searchResult.status || 500 });
    }

    const ids = (searchResult.data.results || []).map((id) => String(id));
    totalMl = Number(searchResult.data.paging?.total || totalMl || 0);
    if (ids.length === 0) break;

    allItemIds.push(...ids);
    if (ids.length < PAGE_SIZE) break;
    if (mode === 'full' && totalMl > 0 && allItemIds.length >= totalMl) break;
  }

  const detailsByItemId = new Map<string, any>();
  const priceToWinByItemId = new Map<string, { buyBoxStatus: string | null; priceToWin: number | null }>();
  const failedItemIds = new Set<string>();

  await runPool(allItemIds, DETAIL_CONCURRENCY, async (itemId) => {
    const itemResult = await fetchMLResult<any>(`/items/${itemId}`);
    if (!itemResult.ok || !itemResult.data) {
      failedItemIds.add(itemId);
      warnings.push(`item_fetch_failed:${itemId}`);
      return;
    }
    detailsByItemId.set(itemId, itemResult.data);

    const priceResult = await fetchMLResult<any>(`/items/${itemId}/price_to_win?version=v2`);
    if (!priceResult.ok || !priceResult.data) {
      priceToWinByItemId.set(itemId, { buyBoxStatus: null, priceToWin: null });
      warnings.push(`price_to_win_unavailable:${itemId}`);
      return;
    }

    priceToWinByItemId.set(itemId, {
      buyBoxStatus: normalizeBuyBoxStatus(priceResult.data),
      priceToWin: normalizePriceToWin(priceResult.data),
    });
  });

  const relatedIds = new Set<string>();
  for (const itemId of allItemIds) {
    const detail = detailsByItemId.get(itemId);
    if (!detail) continue;
    const relatedId = extractRelatedItemId(detail.item_relations);
    if (relatedId) relatedIds.add(relatedId);
  }

  const relatedPermalinkById = new Map<string, string | null>();
  await runPool(Array.from(relatedIds), DETAIL_CONCURRENCY, async (relatedId) => {
    const result = await fetchMLResult<any>(`/items/${relatedId}`);
    if (!result.ok || !result.data) {
      relatedPermalinkById.set(relatedId, null);
      return;
    }
    relatedPermalinkById.set(relatedId, result.data.permalink || null);
  });

  const anuncioMap = new Map<string, { produto_id: string | null; sku: string | null }>();
  for (const idsChunk of chunk(allItemIds, 500)) {
    const { data: anunciosRows } = await service
      .from('anuncios_ml')
      .select('ml_item_id, produto_id, sku')
      .in('ml_item_id', idsChunk);
    for (const row of anunciosRows || []) {
      anuncioMap.set(String(row.ml_item_id), {
        produto_id: row.produto_id || null,
        sku: row.sku || null,
      });
    }
  }

  const upsertRows: any[] = [];
  for (const itemId of allItemIds) {
    const item = detailsByItemId.get(itemId);
    if (!item) continue;

    const relatedItemId = extractRelatedItemId(item.item_relations);
    const local = anuncioMap.get(itemId);
    const priceToWin = priceToWinByItemId.get(itemId);
    const buyBoxStatus = priceToWin?.buyBoxStatus || null;

    upsertRows.push({
      ml_item_id: String(item.id),
      seller_id: sellerId,
      title: item.title || null,
      status: item.status || null,
      price: Number(item.price || 0),
      price_to_win: priceToWin?.priceToWin ?? null,
      buy_box_status: buyBoxStatus,
      buy_box_winning: isWinningBuyBoxStatus(buyBoxStatus),
      permalink: item.permalink || null,
      thumbnail: item.thumbnail || null,
      seller_sku: item.seller_custom_field || null,
      catalog_product_id: item.catalog_product_id || null,
      category_id: item.category_id || null,
      domain_id: item.domain_id || null,
      related_item_id: relatedItemId,
      related_permalink: relatedItemId ? (relatedPermalinkById.get(relatedItemId) || null) : null,
      produto_id: local?.produto_id || null,
      sku_local: local?.sku || null,
      last_updated_ml: item.last_updated || null,
      synced_at: new Date().toISOString(),
    });
  }

  let updated = 0;
  for (const rowsChunk of chunk(upsertRows, UPSERT_CHUNK_SIZE)) {
    const { error } = await service
      .from('catalogo_ml_snapshot')
      .upsert(rowsChunk, { onConflict: 'ml_item_id' });
    if (error) {
      return NextResponse.json({
        success: false,
        error: `Falha no upsert do snapshot: ${error.message}`,
      }, { status: 500 });
    }
    updated += rowsChunk.length;
  }

  let removed = 0;
  if (mode === 'full') {
    const { data: existingRows, error: existingError } = await service
      .from('catalogo_ml_snapshot')
      .select('ml_item_id')
      .eq('seller_id', sellerId);

    if (existingError) {
      warnings.push(`stale_check_failed:${existingError.message}`);
    } else {
      const freshSet = new Set(upsertRows.map((r) => String(r.ml_item_id)));
      const staleIds = (existingRows || [])
        .map((row: any) => String(row.ml_item_id))
        .filter((id) => !freshSet.has(id));

      for (const staleChunk of chunk(staleIds, DELETE_CHUNK_SIZE)) {
        const { error: deleteError, count } = await service
          .from('catalogo_ml_snapshot')
          .delete({ count: 'exact' })
          .eq('seller_id', sellerId)
          .in('ml_item_id', staleChunk);
        if (deleteError) {
          warnings.push(`stale_delete_failed:${deleteError.message}`);
          continue;
        }
        removed += Number(count || 0);
      }
    }
  }

  const duration = Date.now() - startedAt;
  const response = {
    success: true,
    mode,
    processed: allItemIds.length,
    updated,
    failed: failedItemIds.size,
    removed,
    total_ml: totalMl,
    duration_ms: duration,
    warnings,
  };

  console.log(JSON.stringify({
    event: 'catalog_snapshot_refresh_success',
    seller_id: sellerId,
    ...response,
    timestamp_utc: new Date().toISOString(),
  }));

  return NextResponse.json(response);
}
