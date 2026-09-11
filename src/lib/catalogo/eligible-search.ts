export const CATALOG_ELIGIBLE_SEARCH_LIMIT = 100;

export type CatalogEligibleSearchPage = {
  results?: unknown;
  scroll_id?: unknown;
  paging?: {
    total?: unknown;
  } | null;
};

export type CatalogEligibleSearchResult = {
  ok: boolean;
  data?: CatalogEligibleSearchPage | null;
  error?: string;
  authFatal?: boolean;
};

export type CatalogEligibleIdsResult = {
  ok: boolean;
  itemIds: string[];
  error?: string;
  authFatal?: boolean;
};

export function buildCatalogEligibleSearchPath(input: {
  sellerId: string | number;
  statusMl: string;
  scrollId?: string | null;
}) {
  const params = new URLSearchParams({
    search_type: 'scan',
    limit: String(CATALOG_ELIGIBLE_SEARCH_LIMIT),
    tags: 'catalog_listing_eligible',
  });
  if (input.statusMl !== 'all') params.set('status', input.statusMl);
  if (input.scrollId) params.set('scroll_id', input.scrollId);
  return `/users/${encodeURIComponent(String(input.sellerId))}/items/search?${params}`;
}

function reportedTotal(page: CatalogEligibleSearchPage): number | null {
  const value = Number(page.paging?.total);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

export async function collectCatalogEligibleItemIds(input: {
  sellerId: string | number;
  statusMl: string;
  fetchPage: (path: string) => Promise<CatalogEligibleSearchResult>;
}): Promise<CatalogEligibleIdsResult> {
  let scrollId: string | null = null;
  const seenScrollIds = new Set<string>();
  const uniqueIds = new Set<string>();

  while (true) {
    const result = await input.fetchPage(buildCatalogEligibleSearchPath({
      sellerId: input.sellerId,
      statusMl: input.statusMl,
      scrollId,
    }));
    if (!result.ok || !result.data) {
      return {
        ok: false,
        itemIds: [],
        error: result.error || 'Falha ao buscar elegíveis',
        authFatal: result.authFatal === true,
      };
    }

    const ids = Array.isArray(result.data.results)
      ? result.data.results.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    for (const id of ids) uniqueIds.add(id);

    const total = reportedTotal(result.data);
    const nextScrollId = String(result.data.scroll_id || '').trim();
    if ((total !== null && uniqueIds.size >= total) || !nextScrollId || ids.length === 0) {
      return { ok: true, itemIds: Array.from(uniqueIds) };
    }
    if (seenScrollIds.has(nextScrollId)) {
      return {
        ok: false,
        itemIds: [],
        error: 'Paginação de elegíveis do Mercado Livre retornou cursor repetido',
      };
    }

    seenScrollIds.add(nextScrollId);
    scrollId = nextScrollId;
  }
}
