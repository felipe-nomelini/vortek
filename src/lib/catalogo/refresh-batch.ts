export const CATALOG_REFRESH_BATCH_SIZE = 100;
export const CATALOG_REFRESH_MAX_FAILURES = 3;
export const CATALOG_REFRESH_ITEM_MAX_ATTEMPTS = 3;

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
