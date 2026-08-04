export const CATALOG_REFRESH_BATCH_SIZE = 100;
export const CATALOG_REFRESH_MAX_FAILURES = 3;

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
