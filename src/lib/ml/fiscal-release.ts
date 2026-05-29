export type MlFiscalReleaseWindow = {
  releaseAt: string | null;
  reason: string | null;
  isBlockedNow: boolean;
  sourcePath: string | null;
};

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function extractMlFiscalReleaseWindow(shipmentPayload: any): MlFiscalReleaseWindow {
  const reason = String(shipmentPayload?.substatus || '').trim() || null;
  const candidates: Array<{ path: string; value: unknown }> = [
    { path: 'shipping_option.buffering.date', value: shipmentPayload?.shipping_option?.buffering?.date },
    { path: 'shipping_option.estimated_schedule_limit.date', value: shipmentPayload?.shipping_option?.estimated_schedule_limit?.date },
    { path: 'shipping_option.pickup_promise.from', value: shipmentPayload?.shipping_option?.pickup_promise?.from },
    { path: 'shipping_option.pickup_promise.to', value: shipmentPayload?.shipping_option?.pickup_promise?.to },
  ];

  for (const candidate of candidates) {
    const releaseAt = normalizeDate(candidate.value);
    if (!releaseAt) continue;
    const isBlockedNow = Date.now() < new Date(releaseAt).getTime();
    return {
      releaseAt: isBlockedNow ? releaseAt : null,
      reason,
      isBlockedNow,
      sourcePath: candidate.path,
    };
  }

  return {
    releaseAt: null,
    reason,
    isBlockedNow: false,
    sourcePath: null,
  };
}
