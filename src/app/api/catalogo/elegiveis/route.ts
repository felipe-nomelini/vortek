import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';

const DETAIL_CONCURRENCY = 6;
const ELIGIBILITY_CHUNK_SIZE = 20;
const PRODUCT_CONCURRENCY = 6;
const CATALOG_FALLBACK_CONCURRENCY = 3;
const MIN_RELIABLE_CATALOG_MATCH_SCORE = 100;
const ML_SCAN_PAGE_SIZE = 100;

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

function hasReliableSuggestedCatalogProduct(row: any): boolean {
  return Boolean(row?.catalog_product_id_sugerido)
    && String(row?.catalog_product_match_source || '') === 'attributes_search'
    && Number(row?.catalog_product_match_score || 0) >= MIN_RELIABLE_CATALOG_MATCH_SCORE;
}

function isActionableForCatalogOptIn(row: any): boolean {
  if (!isReadyForCatalogOptIn(row)) return false;
  if (String(row?.catalog_product_status || '').toLowerCase() !== 'active') return false;
  if (row?.catalog_product_warning) return hasReliableSuggestedCatalogProduct(row);
  return Boolean(row?.catalog_product_id);
}

function getEligibilityItemId(row: any): string {
  return String(row?.body?.id || row?.id || row?.body?.item_id || '').trim();
}

async function fetchAllEligibleItemIds(params: {
  sellerId: string | number;
  statusMl: string;
}): Promise<{
  ok: boolean;
  itemIds: string[];
  error?: string;
  authFatal?: boolean;
}> {
  const uniqueIds = new Set<string>();
  let scrollId: string | null = null;
  const statusQuery = params.statusMl !== 'all' ? `&status=${encodeURIComponent(params.statusMl)}` : '';

  while (true) {
    const requestPath: string = scrollId
      ? `/users/${encodeURIComponent(String(params.sellerId))}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
      : `/users/${encodeURIComponent(String(params.sellerId))}/items/search?search_type=scan&limit=${ML_SCAN_PAGE_SIZE}&tags=catalog_listing_eligible${statusQuery}`;

    const searchResult: Awaited<ReturnType<typeof fetchMLResult<{ results?: string[]; scroll_id?: string | null }>>> = await fetchMLResult<{ results?: string[]; scroll_id?: string | null }>(requestPath);
    if (!searchResult.ok || !searchResult.data) {
      return {
        ok: false,
        itemIds: [],
        error: searchResult.error?.message || 'Falha ao buscar elegíveis',
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

function normalizeText(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function getAttribute(source: any, attributeId: string): any | null {
  return Array.isArray(source?.attributes)
    ? source.attributes.find((row: any) => String(row?.id || '').toUpperCase() === attributeId.toUpperCase()) || null
    : null;
}

function getAttributeValue(source: any, attributeId: string): string | null {
  const attr = getAttribute(source, attributeId);
  const value = String(attr?.value_name || attr?.value_id || '').trim();
  return value || null;
}

function getAttributeNumber(source: any, attributeId: string): number | null {
  const attr = getAttribute(source, attributeId);
  const structNumber = Number(attr?.value_struct?.number);
  if (Number.isFinite(structNumber)) return structNumber;
  const value = String(attr?.value_name || '').replace(',', '.');
  const match = value.match(/\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function extractLengthMetersFromText(...values: unknown[]): number | null {
  const text = normalizeText(values.filter(Boolean).join(' ')).replace(',', '.');
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:m|mt|mts|metro|metros)\b/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function getLengthMeters(source: any): number | null {
  return getAttributeNumber(source, 'LENGTH') ?? extractLengthMetersFromText(source?.title, source?.name);
}

function getColor(source: any): string | null {
  return getAttributeValue(source, 'COLOR') || getAttributeValue(source, 'MAIN_COLOR');
}

function getNetworkCableCategory(source: any): string | null {
  const attrValue = getAttributeValue(source, 'NETWORK_CABLE_CATEGORY');
  if (attrValue) return attrValue;

  const text = normalizeText([source?.title, source?.name].filter(Boolean).join(' '));
  const match = text.match(/\bcat\s*\.?\s*(5e|5|6a|6|7|8)\b/);
  return match ? `Categoria ${match[1].toUpperCase()}` : null;
}

function getModel(source: any): string | null {
  return getAttributeValue(source, 'MODEL') || getAttributeValue(source, 'ALPHANUMERIC_MODELS') || getAttributeValue(source, 'MPN');
}

function buildCatalogSearchQuery(item: any): string {
  const lengthMeters = getLengthMeters(item);
  const parts = [
    getAttributeValue(item, 'BRAND'),
    getAttributeValue(item, 'MODEL'),
    getNetworkCableCategory(item),
    lengthMeters ? `${lengthMeters}m` : null,
    getColor(item),
    getAttributeValue(item, 'MPN') || getAttributeValue(item, 'ALPHANUMERIC_MODELS'),
    item?.title,
  ];
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ');
}

function hasStrongCatalogMismatch(item: any, catalogProduct: any): boolean {
  const itemColor = getColor(item);
  const catalogColor = getColor(catalogProduct);
  if (itemColor && catalogColor && normalizeText(itemColor) !== normalizeText(catalogColor)) return true;

  const itemLength = getLengthMeters(item);
  const catalogLength = getLengthMeters(catalogProduct);
  if (itemLength !== null && catalogLength !== null && Math.abs(itemLength - catalogLength) > 0.01) return true;

  const itemCategory = getNetworkCableCategory(item);
  const catalogCategory = getNetworkCableCategory(catalogProduct);
  if (itemCategory && catalogCategory && normalizeText(itemCategory) !== normalizeText(catalogCategory)) return true;

  return false;
}

function scoreCatalogCandidate(item: any, candidate: any): number {
  let score = 0;
  const itemColor = getColor(item);
  const candidateColor = getColor(candidate);
  if (itemColor && candidateColor) {
    if (normalizeText(itemColor) === normalizeText(candidateColor)) score += 40;
    else score -= 80;
  }

  const itemLength = getLengthMeters(item);
  const candidateLength = getLengthMeters(candidate);
  if (itemLength !== null && candidateLength !== null) {
    if (Math.abs(itemLength - candidateLength) <= 0.01) score += 40;
    else score -= 60;
  }

  const itemCategory = getNetworkCableCategory(item);
  const candidateCategory = getNetworkCableCategory(candidate);
  if (itemCategory && candidateCategory) {
    if (normalizeText(itemCategory) === normalizeText(candidateCategory)) score += 25;
    else score -= 40;
  }

  const itemBrand = getAttributeValue(item, 'BRAND');
  const candidateBrand = getAttributeValue(candidate, 'BRAND');
  if (itemBrand && candidateBrand && normalizeText(itemBrand) === normalizeText(candidateBrand)) score += 15;

  const itemModel = getModel(item);
  const candidateModel = getModel(candidate);
  if (itemModel && candidateModel && normalizeText(candidateModel).includes(normalizeText(itemModel))) score += 10;

  const itemTitle = normalizeText(item?.title);
  const candidateName = normalizeText(candidate?.name);
  for (const token of itemTitle.split(' ').filter((part) => part.length >= 3)) {
    if (candidateName.includes(token)) score += 1;
  }

  return score;
}

async function fetchCatalogProducts(catalogProductIds: string[]): Promise<Map<string, any>> {
  const uniqueIds = Array.from(new Set(catalogProductIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const products = new Map<string, any>();
  await runPool(uniqueIds, PRODUCT_CONCURRENCY, async (catalogProductId) => {
    const productResult = await fetchMLResult<any>(`/products/${encodeURIComponent(catalogProductId)}`);
    if (!productResult.ok || !productResult.data) return;
    products.set(catalogProductId, productResult.data);
  });
  return products;
}

async function findSuggestedCatalogProduct(item: any, currentProduct: any): Promise<{
  id: string | null;
  name: string | null;
  score: number | null;
  source: string | null;
  warning: string | null;
}> {
  if (!currentProduct || !hasStrongCatalogMismatch(item, currentProduct)) {
    return { id: null, name: null, score: null, source: null, warning: null };
  }

  const query = buildCatalogSearchQuery(item);
  if (!query) return { id: null, name: null, score: null, source: null, warning: 'Catálogo ML incompatível; busca por características sem termos suficientes.' };

  const domainParam = item.domain_id ? `&domain_id=${encodeURIComponent(item.domain_id)}` : '';
  const searchResult = await fetchMLResult<any>(
    `/products/search?site_id=MLB&status=active${domainParam}&limit=30&q=${encodeURIComponent(query)}`,
  );
  if (!searchResult.ok || !Array.isArray(searchResult.data?.results)) {
    return { id: null, name: null, score: null, source: null, warning: 'Catálogo ML incompatível; fallback por características falhou.' };
  }

  const ranked = searchResult.data.results
    .map((candidate: any) => ({
      candidate,
      score: scoreCatalogCandidate(item, candidate),
    }))
    .sort((left: any, right: any) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score < MIN_RELIABLE_CATALOG_MATCH_SCORE) {
    return { id: null, name: null, score: best?.score ?? null, source: null, warning: 'Catálogo ML incompatível; nenhum catálogo alternativo confiável encontrado.' };
  }

  return {
    id: String(best.candidate.id || ''),
    name: best.candidate.name || null,
    score: best.score,
    source: 'attributes_search',
    warning: 'ID do ML parecia incompatível; usando sugestão por características.',
  };
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
  const eligibleResult = await fetchAllEligibleItemIds({ sellerId, statusMl });

  if (!eligibleResult.ok) {
    return NextResponse.json({ erro: eligibleResult.error || 'Falha ao buscar elegíveis', auth_fatal: eligibleResult.authFatal === true }, { status: eligibleResult.authFatal ? 401 : 500 });
  }

  const itemIds = eligibleResult.itemIds;
  const total = itemIds.length;

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

  const catalogProducts = await fetchCatalogProducts(
    rows.map((row) => row.catalog_product_id).filter(Boolean),
  );
  rows = rows
    .map((row) => ({
      ...row,
      catalog_product_status: String(catalogProducts.get(String(row.catalog_product_id || ''))?.status || '').toLowerCase() || null,
    }))
    .filter((row) => row.catalog_product_status === 'active');

  await runPool(rows, CATALOG_FALLBACK_CONCURRENCY, async (row) => {
    const item = rowsById.get(row.ml_item_id);
    const currentProduct = catalogProducts.get(String(row.catalog_product_id || '')) || null;
    if (!item || !currentProduct) return;
    const suggestion = await findSuggestedCatalogProduct(item, currentProduct);
    row.catalog_product_id_sugerido = suggestion.id;
    row.catalog_product_name_sugerido = suggestion.name;
    row.catalog_product_match_source = suggestion.source;
    row.catalog_product_match_score = suggestion.score;
    row.catalog_product_warning = suggestion.warning;
  });

  const activeCatalogProductsBeforeActionableFilter = rows.length;
  const suggestedCatalogProductsBeforeFilters = rows.filter((row) => row.catalog_product_id_sugerido).length;
  rows = rows.filter(isActionableForCatalogOptIn);

  if (search) {
    rows = rows.filter((row) => {
      const fields = [
        row.ml_item_id,
        row.title,
        row.seller_sku,
        row.catalog_product_id,
        row.catalog_product_id_sugerido,
        row.catalog_product_name_sugerido,
        row.catalog_product_warning,
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
  if (min !== null && !Number.isNaN(min)) rows = rows.filter((r) => Number(r.price || 0) >= min);
  if (max !== null && !Number.isNaN(max)) rows = rows.filter((r) => Number(r.price || 0) <= max);

  const filteredTotal = rows.length;
  const pagedRows = rows.slice(offset, offset + pageSize);

  console.log(JSON.stringify({
    event: 'catalog_fetch_elegiveis',
    seller_id: sellerId,
    page,
    page_size: pageSize,
    total_ml: total,
    eligibility_loaded: eligibilityMap.size,
    ready_for_optin: readyForOptInBeforeFilters,
    active_catalog_products: activeCatalogProductsBeforeActionableFilter,
    actionable_catalog_products: filteredTotal,
    suggested_catalog_products: suggestedCatalogProductsBeforeFilters,
    returned: pagedRows.length,
    eligibility_status: 'READY_FOR_OPTIN',
    timestamp_utc: new Date().toISOString(),
  }));

  return NextResponse.json({ data: pagedRows, total: filteredTotal, page, pageSize });
}
