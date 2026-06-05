export type SaleDateSource =
  | 'payment_approved'
  | 'date_closed'
  | 'date_created_fallback';

export interface ResolvedSaleDate {
  value: string | null;
  source: SaleDateSource;
}

function isValidIsoLike(value: unknown): value is string {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return !Number.isNaN(new Date(raw).getTime());
}

function latestApprovedPaymentDate(payments: unknown): string | null {
  if (!Array.isArray(payments)) return null;

  const candidates = payments
    .filter((payment) => payment && typeof payment === 'object')
    .filter((payment) => String((payment as any).status || '').toLowerCase() === 'approved')
    .map((payment) => String((payment as any).date_approved || '').trim())
    .filter(isValidIsoLike)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return candidates[0] || null;
}

export function resolveOrderSaleDate(order: any): ResolvedSaleDate {
  const paymentApprovedAt = latestApprovedPaymentDate(order?.payments);
  if (paymentApprovedAt) {
    return {
      value: paymentApprovedAt,
      source: 'payment_approved',
    };
  }

  const dateClosed = String(order?.date_closed || '').trim();
  if (isValidIsoLike(dateClosed)) {
    return {
      value: dateClosed,
      source: 'date_closed',
    };
  }

  const dateCreated = String(order?.date_created || '').trim();
  return {
    value: isValidIsoLike(dateCreated) ? dateCreated : null,
    source: 'date_created_fallback',
  };
}
