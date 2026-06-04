import { fetchMLResult } from '@/services/integration';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractSellerShippingCost(
  payload: any,
  sellerId?: string | number | null,
): number | null {
  const senders = Array.isArray(payload?.senders) ? payload.senders : [];
  if (senders.length === 0) return null;

  const normalizedSellerId = sellerId === null || sellerId === undefined ? null : String(sellerId);
  const matchingSenders = normalizedSellerId
    ? senders.filter((sender: any) => String(sender?.user_id || '') === normalizedSellerId)
    : senders;

  const targetSenders = matchingSenders.length > 0 ? matchingSenders : senders;
  const total = targetSenders.reduce((sum: number, sender: any) => {
    const cost = toFiniteNumber(sender?.cost);
    return sum + (cost ?? 0);
  }, 0);

  return round2(total);
}

export async function fetchMlShipmentSellerCost(
  shipmentId: string | number,
  sellerId?: string | number | null,
): Promise<number | null> {
  const result = await fetchMLResult<any>(`/shipments/${shipmentId}/costs`);
  if (!result.ok || !result.data) {
    return null;
  }

  return extractSellerShippingCost(result.data, sellerId);
}
