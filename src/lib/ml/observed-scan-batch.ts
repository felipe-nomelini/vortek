export const ML_OBSERVED_BATCH_SIZE = 100;
export const ML_OBSERVED_MAX_FAILURES = 3;
export const ML_OBSERVED_CYCLE_DEDUPE_KEY = 'ml_listings_observed_full_cycle';
export const ML_OBSERVED_MANIFEST_EVENT = 'ml_observed_manifest_completed';

export function normalizeMlObservedItemIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.map((id) => String(id || '').trim()).filter(Boolean),
  ));
}

export function calculateMlObservedProgress(processed: number, total: number): number {
  const safeTotal = Math.max(1, Math.trunc(Number(total) || 0));
  const safeProcessed = Math.min(safeTotal, Math.max(0, Math.trunc(Number(processed) || 0)));
  return 10 + Math.round((safeProcessed / safeTotal) * 90);
}

export function hasCompletedMlObservedManifest(log: unknown): boolean {
  const entries = Array.isArray(log) ? log : [];
  return entries.some((entry) => entry?.event_type === ML_OBSERVED_MANIFEST_EVENT);
}

export function resolveMlObservedScrollId(current: string | null, returned: unknown): string | null {
  const next = String(returned || '').trim();
  return current || next || null;
}

export function isMlObservedItemFailureTerminal(attemptsAfterIncrement: number): boolean {
  return Math.max(0, Math.trunc(Number(attemptsAfterIncrement) || 0)) >= ML_OBSERVED_MAX_FAILURES;
}
