export type MlShipmentCosts = {
  senders?: Array<{
    user_id?: string | number | null;
    cost?: number | null;
  }> | null;
};

function asNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Extrai o custo final suportado pelo vendedor da resposta oficial de
 * `/shipments/{shipment_id}/costs`.
 */
export function resolveMlSellerShippingCost(
  payload: MlShipmentCosts | null | undefined,
  sellerId?: string | number | null,
): number | null {
  const senders = Array.isArray(payload?.senders) ? payload.senders : [];
  if (senders.length === 0) return null;

  const normalizedSellerId = String(sellerId ?? '').trim();
  const sellerRows = normalizedSellerId
    ? senders.filter((sender) => String(sender?.user_id ?? '').trim() === normalizedSellerId)
    : senders;
  const rows = sellerRows.length > 0 ? sellerRows : (senders.length === 1 ? senders : []);
  if (rows.length === 0) return null;

  const costs = rows
    .map((sender) => asNonNegativeNumber(sender?.cost))
    .filter((cost): cost is number => cost !== null);
  if (costs.length !== rows.length) return null;

  return Number(costs.reduce((sum, cost) => sum + cost, 0).toFixed(2));
}

export function calculateFinalOrderProfit(input: {
  total: number;
  productCost: number;
  saleFees: number;
  sellerShippingCost: number | null;
  tax: number;
  matchedItems: number;
}): number | null {
  if (input.matchedItems <= 0 || input.sellerShippingCost === null) return null;

  return Number((
    input.total
    - input.productCost
    - input.saleFees
    - input.sellerShippingCost
    - input.tax
  ).toFixed(2));
}
