export type OrderReconciliationMode = 'standard' | 'cutover';

export type OrderReconciliationModeResult =
  | { ok: true; mode: OrderReconciliationMode }
  | { ok: false; mode: null };

export function parseOrderReconciliationMode(value: unknown): OrderReconciliationModeResult {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return { ok: true, mode: 'standard' };
  if (normalized === 'cutover') return { ok: true, mode: 'cutover' };
  return { ok: false, mode: null };
}

export function shouldDispatchExternalOrderAlerts(mode: OrderReconciliationMode): boolean {
  return mode !== 'cutover';
}
