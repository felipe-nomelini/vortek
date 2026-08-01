export const ML_ORDER_HYDRATION_JOB_TYPE = 'ml_orders_v2_hydration';
export const ML_ORDER_HYDRATION_STALE_MINUTES = 3;

export function normalizeMlOrderHydrationKey(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

export function getMlOrderIdFromHydrationJob(job: {
  dedupe_key?: unknown;
  log?: unknown;
}): string | null {
  const direct = normalizeMlOrderHydrationKey(job.dedupe_key);
  if (direct) return direct;

  const logs = Array.isArray(job.log)
    ? job.log
    : typeof job.log === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(job.log || '[]');
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  for (const entry of logs) {
    const fromLog = normalizeMlOrderHydrationKey(entry?.ml_order_id || entry?.mlOrderId);
    if (fromLog) return fromLog;
  }

  return null;
}
