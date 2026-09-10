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

const PROVISIONAL_PROFIT_MARKERS = new Set([
  'pedido_sem_itens',
  'webhook_hydration_pending',
  'snapshot_origem_webhook_stub',
  'lucro_pendente_frete',
  'lucro_pendente_produto',
]);

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
  if (params.existingProfit !== 0) return false;

  const previousProfitWasProvisional = Array.isArray(params.existingSnapshotPendencias)
    && params.existingSnapshotPendencias.some((marker) => (
      PROVISIONAL_PROFIT_MARKERS.has(String(marker))
    ));
  return previousProfitWasProvisional && !params.profitPending;
}
