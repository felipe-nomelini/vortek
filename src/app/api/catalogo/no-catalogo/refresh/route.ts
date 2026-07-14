import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { buildCatalogEnrichment, extractCatalogCandidateSku, extractCatalogGtin } from '@/lib/catalogo/no-catalogo';

const PAGE_SIZE = 100;
const MAX_INCREMENTAL_PAGES = 10;
const DETAIL_CONCURRENCY = 10;
const MULTIGET_CHUNK_SIZE = 20;
const MULTIGET_CONCURRENCY = 4;
const UPSERT_CHUNK_SIZE = 250;
const DELETE_CHUNK_SIZE = 500;
const ML_SCAN_PAGE_SIZE = 100;

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  onProgress?: (processed: number, total: number) => Promise<void>,
) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(worker));
    if (onProgress) await onProgress(Math.min(i + limit, items.length), items.length);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function getSellerSkuFromItem(item: any): string | null {
  const direct = String(item?.seller_custom_field || item?.seller_sku || '').trim();
  if (direct) return direct;
  const attr = Array.isArray(item?.attributes)
    ? item.attributes.find((row: any) => String(row?.id || '').toUpperCase() === 'SELLER_SKU')
    : null;
  const attrValue = String(attr?.value_name || attr?.value_id || '').trim();
  return attrValue || null;
}

export const maxDuration = 300;

type RefreshProgressReporter = (input: {
  stage: string;
  message: string;
  processed?: number;
  total?: number;
  progress?: number;
}) => Promise<void>;

async function createProgressReporter(jobId: unknown): Promise<RefreshProgressReporter> {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) return async () => {};

  const service = createServiceClient();
  const { data: job } = await service
    .from('jobs')
    .select('log')
    .eq('id', normalizedJobId)
    .maybeSingle();
  const logs = Array.isArray(job?.log) ? [...job.log] : [];

  return async ({ stage, message, processed, total, progress }) => {
    logs.push({
      event_type: 'catalog_refresh_progress',
      type: 'info',
      stage,
      message,
      processed: processed ?? null,
      total: total ?? null,
      progress: progress ?? null,
      timestamp: new Date().toISOString(),
    });
    await service
      .from('jobs')
      .update({
        status: 'rodando',
        processados: processed ?? 0,
        total: total ?? 0,
        progresso: progress ?? 0,
        log: logs,
      })
      .eq('id', normalizedJobId)
      .in('status', ['pendente', 'rodando']);
  };
}

async function fetchAllCatalogListingItemIds(sellerId: string | number): Promise<{
  ok: boolean;
  itemIds: string[];
  error?: string;
  authFatal?: boolean;
}> {
  const uniqueIds = new Set<string>();
  let scrollId: string | null = null;

  while (true) {
    const requestPath: string = scrollId
      ? `/users/${encodeURIComponent(String(sellerId))}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : `/users/${encodeURIComponent(String(sellerId))}/items/search?search_type=scan&limit=${ML_SCAN_PAGE_SIZE}&catalog_listing=true`;

    const searchResult: Awaited<ReturnType<typeof fetchMLResult<{ results?: string[]; scroll_id?: string | null }>>> = await fetchMLResult<{ results?: string[]; scroll_id?: string | null }>(requestPath);
    if (!searchResult.ok || !searchResult.data) {
      return {
        ok: false,
        itemIds: [],
        error: searchResult.error?.message || 'Falha ao buscar itens de catálogo',
        authFatal: searchResult.error?.category === 'auth_fatal',
      };
    }

    const ids = Array.isArray(searchResult.data.results)
      ? searchResult.data.results.map((id: string) => String(id || '').trim()).filter(Boolean)
      : [];

    for (const id of ids) uniqueIds.add(id);

    const nextScrollId: string = String(searchResult.data.scroll_id || '').trim();
    if (!nextScrollId || ids.length === 0) {
      return { ok: true, itemIds: Array.from(uniqueIds) };
    }

    scrollId = nextScrollId;
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestApiKey = request.headers.get('x-api-key') || '';
  const isInternalCall = requestApiKey === process.env.API_SECRET_KEY;

  if (!isInternalCall) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === 'full' ? 'full' : 'incremental';
  const reportProgress = await createProgressReporter(body?.jobId);

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
    trigger_source: isInternalCall ? 'internal_api_key' : 'user_session',
    timestamp_utc: new Date().toISOString(),
  }));

  const warnings: string[] = [];
  const allItemIds: string[] = [];
  let totalMl = 0;

  if (mode === 'full') {
    await reportProgress({ stage: 'scan_catalog', message: 'Listando todos os anúncios de catálogo no Mercado Livre.', progress: 2 });
    const scanResult = await fetchAllCatalogListingItemIds(sellerId);
    if (!scanResult.ok) {
      return NextResponse.json({
        success: false,
        error: scanResult.error || 'Falha ao buscar itens de catálogo',
        auth_fatal: scanResult.authFatal === true,
      }, { status: scanResult.authFatal ? 401 : 500 });
    }

    allItemIds.push(...scanResult.itemIds);
    totalMl = scanResult.itemIds.length;
    await reportProgress({
      stage: 'scan_catalog',
      message: `${totalMl} anúncios de catálogo encontrados.`,
      processed: totalMl,
      total: totalMl,
      progress: 10,
    });
  } else {
    const maxPages = MAX_INCREMENTAL_PAGES;
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
    }
  }

  const detailsByItemId = new Map<string, any>();
  const priceToWinByItemId = new Map<string, any>();
  const failedItemIds = new Set<string>();

  await reportProgress({
    stage: 'fetch_details',
    message: 'Consultando detalhes dos anúncios.',
    processed: 0,
    total: allItemIds.length,
    progress: 10,
  });
  const itemIdChunks = chunk(allItemIds, MULTIGET_CHUNK_SIZE);
  await runPool(itemIdChunks, MULTIGET_CONCURRENCY, async (itemIdsChunk) => {
    const itemResult = await fetchMLResult<Array<{ code: number; body?: any }>>(
      `/items?ids=${itemIdsChunk.map(encodeURIComponent).join(',')}&attributes=id,title,seller_custom_field,attributes,status,price,permalink,thumbnail,category_id,domain_id,catalog_product_id,last_updated,item_relations`,
    );
    if (!itemResult.ok || !Array.isArray(itemResult.data)) {
      for (const itemId of itemIdsChunk) {
        failedItemIds.add(itemId);
        warnings.push(`item_fetch_failed:${itemId}`);
      }
      return;
    }
    const returnedIds = new Set<string>();
    for (const row of itemResult.data) {
      if (row?.code !== 200 || !row.body?.id) continue;
      const itemId = String(row.body.id);
      returnedIds.add(itemId);
      detailsByItemId.set(itemId, row.body);
    }
    for (const itemId of itemIdsChunk) {
      if (returnedIds.has(itemId)) continue;
      failedItemIds.add(itemId);
      warnings.push(`item_fetch_failed:${itemId}`);
    }
  }, async (processedChunks) => {
    const processed = Math.min(processedChunks * MULTIGET_CHUNK_SIZE, allItemIds.length);
    await reportProgress({
      stage: 'fetch_details',
      message: `Consultando detalhes dos anúncios: ${processed}/${allItemIds.length}.`,
      processed,
      total: allItemIds.length,
      progress: 10 + Math.round((processed / Math.max(allItemIds.length, 1)) * 22),
    });
  });

  const itemIdsWithDetails = allItemIds.filter((itemId) => detailsByItemId.has(itemId));
  await reportProgress({
    stage: 'fetch_price_to_win',
    message: 'Consultando preço para ganhar no Mercado Livre.',
    processed: 0,
    total: itemIdsWithDetails.length,
    progress: 32,
  });
  await runPool(itemIdsWithDetails, DETAIL_CONCURRENCY, async (itemId) => {
    const priceResult = await fetchMLResult<any>(`/items/${itemId}/price_to_win?version=v2`);
    if (!priceResult.ok || !priceResult.data) {
      priceToWinByItemId.set(itemId, { buyBoxStatus: null, priceToWin: null });
      warnings.push(`price_to_win_unavailable:${itemId}`);
      return;
    }

    priceToWinByItemId.set(itemId, priceResult.data);
  }, async (processed, total) => {
    if (processed === total || processed % 50 === 0) {
      await reportProgress({
        stage: 'fetch_price_to_win',
        message: `Consultando preço para ganhar: ${processed}/${total}.`,
        processed,
        total,
        progress: 32 + Math.round((processed / Math.max(total, 1)) * 43),
      });
    }
  });

  const relatedIds = new Set<string>();
  for (const itemId of allItemIds) {
    const detail = detailsByItemId.get(itemId);
    if (!detail) continue;
    const relatedId = buildCatalogEnrichment({
      item: detail,
      priceToWinPayload: null,
      relatedPermalink: null,
    }).relatedItemId;
    if (relatedId) relatedIds.add(relatedId);
  }

  const relatedPermalinkById = new Map<string, string | null>();
  await reportProgress({
    stage: 'fetch_related',
    message: 'Carregando links dos anúncios relacionados.',
    processed: 0,
    total: relatedIds.size,
    progress: 76,
  });
  const relatedIdList = Array.from(relatedIds);
  await runPool(chunk(relatedIdList, MULTIGET_CHUNK_SIZE), MULTIGET_CONCURRENCY, async (relatedIdsChunk) => {
    const result = await fetchMLResult<Array<{ code: number; body?: any }>>(
      `/items?ids=${relatedIdsChunk.map(encodeURIComponent).join(',')}&attributes=id,permalink`,
    );
    const returnedIds = new Set<string>();
    if (result.ok && Array.isArray(result.data)) {
      for (const row of result.data) {
        if (row?.code !== 200 || !row.body?.id) continue;
        const relatedId = String(row.body.id);
        returnedIds.add(relatedId);
        relatedPermalinkById.set(relatedId, row.body.permalink || null);
      }
    }
    for (const relatedId of relatedIdsChunk) {
      if (!returnedIds.has(relatedId)) relatedPermalinkById.set(relatedId, null);
    }
  }, async (processedChunks) => {
    const processed = Math.min(processedChunks * MULTIGET_CHUNK_SIZE, relatedIdList.length);
    await reportProgress({
      stage: 'fetch_related',
      message: `Carregando links relacionados: ${processed}/${relatedIdList.length}.`,
      processed,
      total: relatedIdList.length,
      progress: 76 + Math.round((processed / Math.max(relatedIdList.length, 1)) * 9),
    });
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

  const fallbackSkuCandidates = new Set<string>();
  const fallbackGtins = new Set<string>();
  for (const itemId of allItemIds) {
    const item = detailsByItemId.get(itemId);
    if (!item) continue;
    const local = anuncioMap.get(itemId);
    if (String(local?.sku || '').trim()) continue;
    const candidateSku = extractCatalogCandidateSku(getSellerSkuFromItem(item));
    if (candidateSku) fallbackSkuCandidates.add(candidateSku);
    const gtin = extractCatalogGtin(item);
    if (gtin) fallbackGtins.add(gtin);
  }

  const produtoBySku = new Map<string, { id: string; sku: string }>();
  for (const skuChunk of chunk(Array.from(fallbackSkuCandidates), 500)) {
    const { data: produtoRows } = await service
      .from('produtos')
      .select('id, sku')
      .in('sku', skuChunk);
    for (const row of produtoRows || []) {
      const sku = String(row.sku || '').trim().toUpperCase();
      if (!sku) continue;
      produtoBySku.set(sku, { id: String(row.id), sku });
    }
  }

  const produtoByGtin = new Map<string, { id: string; sku: string }>();
  for (const gtinChunk of chunk(Array.from(fallbackGtins), 500)) {
    const { data: produtoRows } = await service
      .from('produtos')
      .select('id, sku, gtin')
      .in('gtin', gtinChunk);
    for (const row of produtoRows || []) {
      const gtin = String((row as any).gtin || '').trim();
      const sku = String(row.sku || '').trim().toUpperCase();
      if (!gtin || !sku) continue;
      if (!produtoByGtin.has(gtin)) {
        produtoByGtin.set(gtin, { id: String(row.id), sku });
      }
    }
  }

  const upsertRows: any[] = [];
  await reportProgress({ stage: 'match_products', message: 'Vinculando produtos locais.', progress: 86 });
  for (const itemId of allItemIds) {
    const item = detailsByItemId.get(itemId);
    if (!item) continue;

    const baseRelatedItemId = buildCatalogEnrichment({
      item,
      priceToWinPayload: null,
      relatedPermalink: null,
    }).relatedItemId;
    const enrichment = buildCatalogEnrichment({
      item,
      priceToWinPayload: priceToWinByItemId.get(itemId) || null,
      relatedPermalink: baseRelatedItemId ? (relatedPermalinkById.get(baseRelatedItemId) || null) : null,
    });
    const local = anuncioMap.get(itemId);
    const fallbackSku = extractCatalogCandidateSku(getSellerSkuFromItem(item));
    const gtin = extractCatalogGtin(item);
    const fallbackProduto = fallbackSku
      ? (produtoBySku.get(String(fallbackSku).toUpperCase()) || null)
      : (gtin ? (produtoByGtin.get(gtin) || null) : null);

    upsertRows.push({
      ml_item_id: String(item.id),
      seller_id: sellerId,
      catalog_listing: true,
      title: item.title || null,
      status: item.status || null,
      price: Number(item.price || 0),
      price_to_win: enrichment.priceToWin,
      buy_box_status: enrichment.buyBoxStatus,
      buy_box_winning: enrichment.buyBoxWinning,
      permalink: item.permalink || null,
      thumbnail: item.thumbnail || null,
      seller_sku: getSellerSkuFromItem(item),
      catalog_product_id: item.catalog_product_id || null,
      category_id: item.category_id || null,
      domain_id: item.domain_id || null,
      related_item_id: enrichment.relatedItemId,
      related_permalink: enrichment.relatedPermalink,
      produto_id: local?.produto_id || fallbackProduto?.id || null,
      sku_local: local?.sku || fallbackProduto?.sku || fallbackSku || null,
      last_updated_ml: item.last_updated || null,
      synced_at: new Date().toISOString(),
    });
  }

  let updated = 0;
  await reportProgress({ stage: 'save_snapshot', message: 'Salvando snapshot atualizado.', processed: 0, total: upsertRows.length, progress: 90 });
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
    await reportProgress({
      stage: 'save_snapshot',
      message: `Salvando snapshot atualizado: ${updated}/${upsertRows.length}.`,
      processed: updated,
      total: upsertRows.length,
      progress: 90 + Math.round((updated / Math.max(upsertRows.length, 1)) * 9),
    });
  }

  let removed = 0;
  if (mode === 'full') {
    const { data: existingRows, error: existingError } = await service
      .from('catalogo_ml_snapshot')
      .select('ml_item_id')
      .eq('seller_id', sellerId)
      .eq('catalog_listing', true);

    if (existingError) {
      warnings.push(`stale_check_failed:${existingError.message}`);
    } else {
      const freshSet = new Set(upsertRows.map((r) => String(r.ml_item_id)));
      const staleIds = (existingRows || [])
        .map((row: any) => String(row.ml_item_id))
        .filter((id) => !freshSet.has(id));

      for (const staleChunk of chunk(staleIds, DELETE_CHUNK_SIZE)) {
        const { error: updateError, count } = await service
          .from('catalogo_ml_snapshot')
          .update({
            catalog_listing: false,
            related_item_id: null,
            related_permalink: null,
            buy_box_status: null,
            buy_box_winning: false,
            price_to_win: null,
            synced_at: new Date().toISOString(),
          }, { count: 'exact' })
          .eq('seller_id', sellerId)
          .eq('catalog_listing', true)
          .in('ml_item_id', staleChunk);
        if (updateError) {
          warnings.push(`stale_catalog_demote_failed:${updateError.message}`);
          continue;
        }
        removed += Number(count || 0);
      }
    }
  }

  const duration = Date.now() - startedAt;
  await reportProgress({
    stage: 'completed',
    message: `Refresh concluído: ${updated} anúncios atualizados.`,
    processed: updated,
    total: allItemIds.length,
    progress: 100,
  });
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
    trigger_source: isInternalCall ? 'internal_api_key' : 'user_session',
    ...response,
    timestamp_utc: new Date().toISOString(),
  }));

  return NextResponse.json(response);
}
