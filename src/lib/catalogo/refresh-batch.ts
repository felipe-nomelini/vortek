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
