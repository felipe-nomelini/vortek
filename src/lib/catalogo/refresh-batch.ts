export const CATALOG_REFRESH_BATCH_SIZE = 100;
export const CATALOG_REFRESH_MAX_FAILURES = 3;
export const CATALOG_REFRESH_ITEM_MAX_ATTEMPTS = 3;
export const CATALOG_SCAN_PAGE_SIZE = 100;

export function buildCatalogScanPath(sellerId: string | number, scrollId?: string | null): string {
  const params = new URLSearchParams({
    search_type: 'scan',
    limit: String(CATALOG_SCAN_PAGE_SIZE),
    catalog_listing: 'true',
  });
  const normalizedScrollId = String(scrollId || '').trim();
  if (normalizedScrollId) params.set('scroll_id', normalizedScrollId);
  return `/users/${encodeURIComponent(String(sellerId))}/items/search?${params.toString()}`;
}

export type CatalogScanPage = {
  results?: unknown;
  scroll_id?: unknown;
  paging?: { total?: unknown } | null;
};

export async function collectCatalogScanItemIds(input: {
  sellerId: string | number;
  fetchPage: (path: string) => Promise<{ ok: boolean; data?: CatalogScanPage | null; error?: string; authFatal?: boolean }>;
}): Promise<{ ok: boolean; itemIds: string[]; error?: string; authFatal?: boolean }> {
  const uniqueIds = new Set<string>();
  const seenScrollIds = new Set<string>();
  let scrollId: string | null = null;
  let expectedTotal: number | null = null;

  while (true) {
    const result = await input.fetchPage(buildCatalogScanPath(input.sellerId, scrollId));
    if (!result.ok || !result.data) {
      return { ok: false, itemIds: [], error: result.error || 'Falha ao buscar anúncios de catálogo', authFatal: result.authFatal };
    }
    const total = Number(result.data.paging?.total);
    if (!Number.isSafeInteger(total) || total < 0 || (expectedTotal !== null && total !== expectedTotal)) {
      return { ok: false, itemIds: [], error: 'O Mercado Livre não informou um total estável para o catálogo.' };
    }
    expectedTotal = total;
    if (!Array.isArray(result.data.results)) {
      return { ok: false, itemIds: [], error: 'O Mercado Livre não devolveu a lista de anúncios do catálogo.' };
    }
    const ids = result.data.results.map((id) => String(id || '').trim()).filter(Boolean);
    for (const id of ids) uniqueIds.add(id);
    if (uniqueIds.size > total) {
      return { ok: false, itemIds: [], error: 'O Mercado Livre retornou anúncios além do total do catálogo.' };
    }
    if (uniqueIds.size === total) return { ok: true, itemIds: Array.from(uniqueIds) };
    const nextScrollId = String(result.data.scroll_id || '').trim();
    if (!nextScrollId || ids.length === 0) {
      return { ok: false, itemIds: [], error: 'A paginação do Mercado Livre terminou antes de carregar todo o catálogo.' };
    }
    if (seenScrollIds.has(nextScrollId)) {
      return { ok: false, itemIds: [], error: 'A paginação do Mercado Livre repetiu o cursor antes de carregar todo o catálogo.' };
    }
    seenScrollIds.add(nextScrollId);
    scrollId = nextScrollId;
  }
}

export function calculateCatalogRefreshProgress(processed: number, total: number): number {
  const safeTotal = Math.max(1, Math.trunc(Number(total) || 0));
  const safeProcessed = Math.min(safeTotal, Math.max(0, Math.trunc(Number(processed) || 0)));
  return 32 + Math.round((safeProcessed / safeTotal) * 56);
}

export function normalizeCatalogRefreshItemIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.map((id) => String(id || '').trim()).filter(Boolean),
  ));
}

export function getCatalogRefreshFailureStage(logs: unknown): string {
  if (!Array.isArray(logs)) return 'scan_catalog';

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const entry = logs[index];
    const stage = typeof entry === 'object' && entry !== null && 'stage' in entry
      ? String(entry.stage || '').trim()
      : '';
    if (stage && stage !== 'completed') return stage;
  }

  return 'scan_catalog';
}

export function splitCatalogRefreshFailures(
  rows: Array<{ ml_item_id: string; attempts?: number | null }>,
  failedItemIds: Iterable<string>,
) {
  const failed = new Set(Array.from(failedItemIds, (id) => String(id || '').trim()).filter(Boolean));
  const retryable: string[] = [];
  const exhausted: string[] = [];

  for (const row of rows) {
    const itemId = String(row.ml_item_id || '').trim();
    if (!itemId || !failed.has(itemId)) continue;
    const nextAttempt = Math.max(0, Math.trunc(Number(row.attempts) || 0)) + 1;
    (nextAttempt >= CATALOG_REFRESH_ITEM_MAX_ATTEMPTS ? exhausted : retryable).push(itemId);
  }

  return { retryable, exhausted };
}

export function calculateCatalogRefreshOutcome(input: {
  total: number;
  detailsUnavailable: number;
  competitionUnavailable: number;
}) {
  const total = Math.max(0, Math.trunc(Number(input.total) || 0));
  const detailsUnavailable = Math.min(total, Math.max(0, Math.trunc(Number(input.detailsUnavailable) || 0)));
  const competitionUnavailable = Math.max(0, Math.trunc(Number(input.competitionUnavailable) || 0));
  const updated = Math.max(0, total - detailsUnavailable);
  const issues = detailsUnavailable + competitionUnavailable;
  const status = total > 0 && detailsUnavailable >= total
    ? 'erro'
    : issues > 0 ? 'completo_parcial' : 'completo';

  return { status, total, updated, detailsUnavailable, competitionUnavailable, issues } as const;
}
