import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';

const DETAIL_CONCURRENCY = 6;

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(worker));
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 50)));
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const eligibilityStatus = (searchParams.get('eligibilityStatus') || 'all').trim().toUpperCase();
  const statusMl = (searchParams.get('statusMl') || 'all').trim().toLowerCase();
  const priceMin = searchParams.get('priceMin');
  const priceMax = searchParams.get('priceMax');

  const meResult = await fetchMLResult<{ id: number }>('/users/me');
  if (!meResult.ok || !meResult.data?.id) {
    return NextResponse.json({ erro: meResult.error?.message || 'Falha ao obter usuário ML', auth_fatal: meResult.error?.category === 'auth_fatal' }, { status: meResult.status || 500 });
  }

  const sellerId = meResult.data.id;
  const offset = (page - 1) * pageSize;
  const statusQuery = statusMl !== 'all' ? `&status=${encodeURIComponent(statusMl)}` : '';
  const searchResult = await fetchMLResult<{ results: string[]; paging?: { total?: number } }>(
    `/users/${sellerId}/items/search?tags=catalog_listing_eligible&offset=${offset}&limit=${pageSize}${statusQuery}`,
  );

  if (!searchResult.ok || !searchResult.data) {
    return NextResponse.json({ erro: searchResult.error?.message || 'Falha ao buscar elegíveis', auth_fatal: searchResult.error?.category === 'auth_fatal' }, { status: searchResult.status || 500 });
  }

  const itemIds = searchResult.data.results || [];
  const total = Number(searchResult.data.paging?.total || 0);

  const eligibilityMap = new Map<string, any>();
  if (itemIds.length > 0) {
    const multiResult = await fetchMLResult<any>(`/multiget/catalog_listing_eligibility?ids=${itemIds.join(',')}`);
    if (multiResult.ok && Array.isArray(multiResult.data)) {
      for (const row of multiResult.data) {
        const itemId = String(row?.id || row?.body?.item_id || '').trim();
        if (!itemId) continue;
        eligibilityMap.set(itemId, row?.body || row);
      }
    }
  }

  const rowsById = new Map<string, any>();
  const forewarningByItemId = new Map<string, { status: string | null; moderation_date: string | null }>();

  await runPool(itemIds, DETAIL_CONCURRENCY, async (itemId) => {
    const [itemResult, forewarningResult] = await Promise.all([
      fetchMLResult<any>(`/items/${itemId}`),
      fetchMLResult<any>(`/items/${itemId}/catalog_forewarning/date`),
    ]);

    if (itemResult.ok && itemResult.data) {
      rowsById.set(itemId, itemResult.data);
    }

    if (forewarningResult.ok && forewarningResult.data) {
      forewarningByItemId.set(itemId, {
        status: String(forewarningResult.data?.status || '').trim() || null,
        moderation_date: String(forewarningResult.data?.moderation_date || '').trim() || null,
      });
    } else {
      forewarningByItemId.set(itemId, { status: null, moderation_date: null });
    }
  });

  const service = createServiceClient();
  const anuncioMap = new Map<string, { produto_id: string | null; sku_local: string | null }>();
  if (itemIds.length > 0) {
    for (let i = 0; i < itemIds.length; i += 500) {
      const idsChunk = itemIds.slice(i, i + 500);
      const { data: anunciosRows } = await service
        .from('anuncios_ml')
        .select('ml_item_id, produto_id, sku')
        .in('ml_item_id', idsChunk);
      for (const row of anunciosRows || []) {
        anuncioMap.set(String(row.ml_item_id), {
          produto_id: row.produto_id || null,
          sku_local: row.sku || null,
        });
      }
    }
  }

  let rows = itemIds
    .map((itemId) => {
      const item = rowsById.get(itemId);
      if (!item) return null;
      const el = eligibilityMap.get(itemId) || {};
      const rowStatus = String(el.status || '').toUpperCase();
      const local = anuncioMap.get(itemId);
      const forewarning = forewarningByItemId.get(itemId);

      return {
        ml_item_id: String(item.id),
        titulo: item.title || '',
        title: item.title || '',
        seller_sku: item.seller_custom_field || null,
        sku_local: local?.sku_local || item.seller_custom_field || null,
        produto_id: local?.produto_id || null,
        status: item.status || null,
        preco_atual: Number(item.price || 0),
        price: Number(item.price || 0),
        motivo: String(el.reason || '').trim() || null,
        permalink: item.permalink || null,
        thumbnail: item.thumbnail || null,
        category_id: item.category_id || null,
        domain_id: item.domain_id || null,
        catalog_product_id: item.catalog_product_id || null,
        eligibility_status: rowStatus || null,
        buy_box_eligible: Boolean(el.buy_box_eligible),
        eligibility_reason: el.reason || null,
        variation_eligibility: Array.isArray(el.variations) ? el.variations : [],
        catalog_forewarning_status: forewarning?.status || null,
        catalog_forewarning_moderation_date: forewarning?.moderation_date || null,
        last_updated: item.last_updated || null,
      };
    })
    .filter(Boolean) as any[];

  if (eligibilityStatus !== 'ALL') {
    rows = rows.filter((r) => String(r.eligibility_status || '').toUpperCase() === eligibilityStatus);
  }

  if (search) {
    rows = rows.filter((row) => {
      const fields = [
        row.ml_item_id,
        row.titulo,
        row.seller_sku,
        row.sku_local,
        row.catalog_product_id,
        row.category_id,
        row.domain_id,
        row.eligibility_status,
        row.eligibility_reason,
      ].map((v) => String(v || '').toLowerCase());
      return fields.some((f) => f.includes(search));
    });
  }

  const min = priceMin !== null ? Number(priceMin) : null;
  const max = priceMax !== null ? Number(priceMax) : null;
  if (min !== null && !Number.isNaN(min)) rows = rows.filter((r) => Number(r.preco_atual || 0) >= min);
  if (max !== null && !Number.isNaN(max)) rows = rows.filter((r) => Number(r.preco_atual || 0) <= max);

  console.log(JSON.stringify({ event: 'catalog_fetch_elegiveis', seller_id: sellerId, page, page_size: pageSize, total_ml: total, returned: rows.length, eligibility_status: eligibilityStatus, timestamp_utc: new Date().toISOString() }));

  return NextResponse.json({ data: rows, total, page, pageSize });
}
