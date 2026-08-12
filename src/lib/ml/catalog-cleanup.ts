export const CATALOG_CLEANUP_TAX_RATE = 0.04;

export type CleanupCandidateInput = {
  localStatus: string;
  liveStatus: string;
  liveSubStatus: string[];
  profit: number | null;
};

export type CleanupEligibility =
  | { eligible: true; reason: 'eligible' }
  | { eligible: false; reason: string };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateCatalogCleanupProfit(input: {
  price: number;
  cost: number;
  shipping: number;
  mlFee: number;
}): number | null {
  const price = Number(input.price);
  const cost = Number(input.cost);
  const shipping = Number(input.shipping);
  const mlFee = Number(input.mlFee);
  if (
    !Number.isFinite(price) || price <= 0
    || !Number.isFinite(cost)
    || !Number.isFinite(shipping)
    || !Number.isFinite(mlFee)
  ) return null;

  return round2(
    price - cost - shipping - (price * CATALOG_CLEANUP_TAX_RATE) - (price * mlFee),
  );
}

export function evaluateCatalogCleanupCandidate(
  input: CleanupCandidateInput,
): CleanupEligibility {
  const localStatus = String(input.localStatus || '').trim().toLowerCase();
  const status = String(input.liveStatus || '').trim().toLowerCase();
  const subStatuses = input.liveSubStatus.map((value) => String(value).trim().toLowerCase());
  const allowedStatus = status === 'paused'
    || status === 'closed'
    || (status === 'under_review' && subStatuses.includes('forbidden'));

  if (localStatus !== 'pausado') return { eligible: false, reason: 'local_status_not_paused' };
  if (!allowedStatus) return { eligible: false, reason: 'live_status_not_eligible' };
  if (input.profit === null) return { eligible: false, reason: 'profit_unavailable' };
  if (input.profit >= 0) return { eligible: false, reason: 'profit_not_negative' };

  return { eligible: true, reason: 'eligible' };
}
