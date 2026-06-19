export type MlFiscalReleaseWindow = {
  releaseAt: string | null;
  reason: string | null;
  isBlockedNow: boolean;
  sourcePath: string | null;
};

function releaseComparableTime(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Number.NaN;
  const isUtcMidnight = parsed.getUTCHours() === 0
    && parsed.getUTCMinutes() === 0
    && parsed.getUTCSeconds() === 0
    && parsed.getUTCMilliseconds() === 0;
  if (!isUtcMidnight) return parsed.getTime();
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 3, 0, 0, 0);
}

type ReleaseWindowInput = {
  shipment?: any;
  leadTime?: any;
};

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function extractMlFiscalReleaseWindow(shipmentPayload: any): MlFiscalReleaseWindow {
  const input: ReleaseWindowInput =
    shipmentPayload && typeof shipmentPayload === 'object' && ('shipment' in shipmentPayload || 'leadTime' in shipmentPayload)
      ? shipmentPayload as ReleaseWindowInput
      : { shipment: shipmentPayload };
  const shipment = input.shipment || null;
  const leadTime = input.leadTime || null;

  const reasonCandidates = [
    shipment?.substatus,
    leadTime?.shipping_option?.estimated_schedule_limit?.id,
    leadTime?.shipping_option?.estimated_schedule_limit?.name,
    leadTime?.estimated_schedule_limit?.id,
    leadTime?.estimated_schedule_limit?.name,
  ];
  const reason = reasonCandidates
    .map((value) => String(value || '').trim())
    .find(Boolean) || null;

  const candidates: Array<{ path: string; value: unknown }> = [
    // Fonte primária de janela operacional (SLA/lead_time)
    { path: 'lead_time.shipping_option.buffering.date', value: leadTime?.shipping_option?.buffering?.date },
    { path: 'lead_time.buffering.date', value: leadTime?.buffering?.date },
    { path: 'lead_time.shipping_option.estimated_schedule_limit.date', value: leadTime?.shipping_option?.estimated_schedule_limit?.date },
    { path: 'lead_time.estimated_schedule_limit.date', value: leadTime?.estimated_schedule_limit?.date },
    // Fallback no payload de shipment quando aplicável
    { path: 'shipment.shipping_option.buffering.date', value: shipment?.shipping_option?.buffering?.date },
    { path: 'shipment.shipping_option.estimated_schedule_limit.date', value: shipment?.shipping_option?.estimated_schedule_limit?.date },
    { path: 'shipment.shipping_option.pickup_promise.from', value: shipment?.shipping_option?.pickup_promise?.from },
    { path: 'shipment.shipping_option.pickup_promise.to', value: shipment?.shipping_option?.pickup_promise?.to },
  ];

  for (const candidate of candidates) {
    const releaseAt = normalizeDate(candidate.value);
    if (!releaseAt) continue;
    const comparableTime = releaseComparableTime(releaseAt);
    const isBlockedNow = Date.now() < comparableTime;
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
