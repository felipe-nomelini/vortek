import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';

const DETAIL_CONCURRENCY = 6;
const ELIGIBILITY_CHUNK_SIZE = 20;
const PRODUCT_CONCURRENCY = 6;

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(worker));
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

function getEligibilityLabel(status: string | null): string {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'READY_FOR_OPTIN') return 'Pronto para catálogo';
  if (normalized === 'ALREADY_OPTED_IN') return 'Já no catálogo';
  if (normalized === 'NOT_ELIGIBLE') return 'Não elegível';
  if (normalized === 'PRODUCT_INACTIVE') return 'Produto inativo';
  if (normalized === 'CLOSED') return 'Encerrado';
  if (normalized === 'COMPETING') return 'Competindo';
  return status || '—';
}

function getStatusLabel(status: string | null, hasCatalogLink: boolean): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return 'Ativo';
  if (normalized === 'paused') return 'Pausado';
  if (normalized === 'closed') return 'Encerrado';
  if (normalized === 'under_review') return hasCatalogLink ? 'Pendente de catálogo' : 'Em revisão';
  if (normalized === 'inactive') return 'Inativo';
  return status || '—';
}

function hasReadyForOptInVariation(variations: unknown): boolean {
  return Array.isArray(variations)
    && variations.some((row: any) => String(row?.status || '').toUpperCase() === 'READY_FOR_OPTIN');
}

function isReadyForCatalogOptIn(row: any): boolean {
  return String(row?.eligibility_status || '').toUpperCase() === 'READY_FOR_OPTIN'
    || hasReadyForOptInVariation(row?.variation_eligibility);
}

function getEligibilityItemId(row: any): string {
  return String(row?.body?.id || row?.id || row?.body?.item_id || '').trim();
}

async function fetchCatalogProductStatuses(catalogProductIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(catalogProductIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const statuses = new Map<string, string>();
  await runPool(uniqueIds, PRODUCT_CONCURRENCY, async (catalogProductId) => {
    const productResult = await fetchMLResult<any>(`/products/${encodeURIComponent(catalogProductId)}`);
    if (!productResult.ok || !productResult.data) return;
    statuses.set(catalogProductId, String(productResult.data.status || '').toLowerCase());
  });
  return statuses;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 50)));
  const search = (searchParams.get('search') || '').trim().toLowerCase();
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
    for (const itemIdChunk of chunk(itemIds, ELIGIBILITY_CHUNK_SIZE)) {
      const multiResult = await fetchMLResult<any>(`/multiget/catalog_listing_eligibility?ids=${itemIdChunk.join(',')}`);
      if (multiResult.ok && Array.isArray(multiResult.data)) {
        for (const row of multiResult.data) {
          const itemId = getEligibilityItemId(row);
          if (!itemId) continue;
          eligibilityMap.set(itemId, row?.body || row);
        }
      }
    }
  }

  const rowsById = new Map<string, any>();
  await runPool(itemIds, DETAIL_CONCURRENCY, async (itemId) => {
    const itemResult = await fetchMLResult<any>(`/items/${itemId}`);
    if (!itemResult.ok || !itemResult.data) return;
    rowsById.set(itemId, itemResult.data);
  });

  const localSkuMap = new Map<string, string>();
  if (itemIds.length > 0) {
    const service = createServiceClient();
    for (const itemIdChunk of chunk(itemIds, ELIGIBILITY_CHUNK_SIZE)) {
      const { data } = await service
        .from('anuncios_ml')
        .select('ml_item_id,sku')
        .in('ml_item_id', itemIdChunk);
      for (const row of data || []) {
        const sku = String(row?.sku || '').trim();
        if (row?.ml_item_id && sku) localSkuMap.set(String(row.ml_item_id), sku);
      }
    }
  }

  let rows = itemIds
    .map((itemId) => {
      const item = rowsById.get(itemId);
      if (!item) return null;
      const el = eligibilityMap.get(itemId) || {};
      const rowStatus = String(el.status || '').toUpperCase();
      const variations = Array.isArray(el.variations) ? el.variations : [];
      const isVariationReady = hasReadyForOptInVariation(variations);
      const hasCatalogLink = Boolean(item.catalog_product_id || rowStatus);
      const sellerSku = getSellerSkuFromItem(item) || localSkuMap.get(itemId) || null;
      const effectiveEligibilityStatus = rowStatus || (isVariationReady ? 'READY_FOR_OPTIN' : null);

      return {
        ml_item_id: String(item.id),
        title: item.title || '',
        seller_sku: sellerSku,
        status: item.status || null,
        status_label: getStatusLabel(item.status || null, hasCatalogLink),
        price: Number(item.price || 0),
        permalink: item.permalink || null,
        thumbnail: item.thumbnail || null,
        category_id: item.category_id || null,
        domain_id: item.domain_id || null,
        catalog_product_id: item.catalog_product_id || null,
        eligibility_status: effectiveEligibilityStatus,
        eligibility_label: getEligibilityLabel(effectiveEligibilityStatus),
        buy_box_eligible: Boolean(el.buy_box_eligible),
        eligibility_reason: el.reason || null,
        variation_eligibility: variations,
        last_updated: item.last_updated || null,
      };
    })
    .filter(Boolean) as any[];

  const readyForOptInBeforeFilters = rows.filter(isReadyForCatalogOptIn).length;
  rows = rows.filter(isReadyForCatalogOptIn);

  const catalogProductStatuses = await fetchCatalogProductStatuses(
    rows.map((row) => row.catalog_product_id).filter(Boolean),
  );
  rows = rows
    .map((row) => ({
      ...row,
      catalog_product_status: catalogProductStatuses.get(String(row.catalog_product_id || '')) || null,
    }))
    .filter((row) => row.catalog_product_status === 'active');

  if (search) {
    rows = rows.filter((row) => {
      const fields = [row.ml_item_id, row.title, row.seller_sku, row.catalog_product_id, row.category_id, row.domain_id, row.eligibility_status, row.eligibility_reason].map((v) => String(v || '').toLowerCase());
      return fields.some((f) => f.includes(search));
    });
  }

  const min = priceMin !== null ? Number(priceMin) : null;
  const max = priceMax !== null ? Number(priceMax) : null;
  if (min !== null && !Number.isNaN(min)) rows = rows.filter((r) => Number(r.price || 0) >= min);
  if (max !== null && !Number.isNaN(max)) rows = rows.filter((r) => Number(r.price || 0) <= max);

  console.log(JSON.stringify({
    event: 'catalog_fetch_elegiveis',
    seller_id: sellerId,
    page,
    page_size: pageSize,
    total_ml: total,
    eligibility_loaded: eligibilityMap.size,
    ready_for_optin: readyForOptInBeforeFilters,
    active_catalog_products: rows.length,
    returned: rows.length,
    eligibility_status: 'READY_FOR_OPTIN',
    timestamp_utc: new Date().toISOString(),
  }));

  const filteredTotal = Math.min(total, offset + rows.length);
  return NextResponse.json({ data: rows, total: filteredTotal, page, pageSize });
}
