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

export function shouldPersistCalculatedOrderProfit(params: {
  existingProfit: unknown;
  existingSnapshotPendencias: unknown;
  calculatedProfit: unknown;
  profitPending: boolean;
}): boolean {
  if (
    typeof params.calculatedProfit !== 'number'
    || !Number.isFinite(params.calculatedProfit)
  ) return false;

  if (params.existingProfit == null) return true;

  const previousProfitWasProvisional = Array.isArray(params.existingSnapshotPendencias)
    && params.existingSnapshotPendencias.includes('lucro_pendente_produto');
  return previousProfitWasProvisional && !params.profitPending;
}
