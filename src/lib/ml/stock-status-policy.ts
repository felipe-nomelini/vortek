export const AUTOMATED_STOCK_SOURCES = new Set([
  'internal_stock_automation', 'dslite_stock_automation', 'evolusom_stock_automation', 'dslite_stock_backfill',
  'kit_stock_automation', 'seed_from_products',
]);

export function isAutomatedStockSource(source: unknown): boolean {
  return AUTOMATED_STOCK_SOURCES.has(String(source || '').trim().toLowerCase());
}

export function mayReactivateAfterStock(input: {
  status: unknown;
  subStatus: unknown;
  remoteLastUpdated: unknown;
  ownedPauseLastUpdated?: unknown;
}): boolean {
  if (String(input.status || '').toLowerCase() !== 'paused') return false;
  const subStatuses = Array.isArray(input.subStatus)
    ? input.subStatus.map(value => String(value).toLowerCase()) : [];
  if (subStatuses.includes('out_of_stock')) return true;
  if (!subStatuses.includes('paused_by_seller') || !input.ownedPauseLastUpdated) return false;
  const remote = Date.parse(String(input.remoteLastUpdated || ''));
  const owned = Date.parse(String(input.ownedPauseLastUpdated));
  return Number.isFinite(remote) && remote === owned;
}
