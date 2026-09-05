export interface MlSalePaymentRelease {
  id?: string | number | null;
  status?: string | null;
  money_release_status?: string | null;
  money_release_date?: string | null;
  transaction_amount_refunded?: number | null;
}

export interface MlSaleConcretizationAssessment {
  concretized: boolean;
  reason:
    | 'concretized'
    | 'order_not_paid'
    | 'shipment_not_stale'
    | 'claim_or_return'
    | 'claim_lookup_incomplete'
    | 'payment_lookup_incomplete'
    | 'payment_not_released'
    | 'payment_refunded';
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function assessMlSaleConcretization(input: {
  orderStatus?: string | null;
  shipmentStatus?: string | null;
  shipmentSubstatus?: string | null;
  hasClaim: boolean;
  isReturned: boolean;
  claimLookupComplete: boolean;
  paymentLookupComplete: boolean;
  payments: MlSalePaymentRelease[];
}): MlSaleConcretizationAssessment {
  if (normalize(input.orderStatus) !== 'paid') {
    return { concretized: false, reason: 'order_not_paid' };
  }
  if (
    normalize(input.shipmentStatus) !== 'shipped'
    || normalize(input.shipmentSubstatus) !== 'stale'
  ) {
    return { concretized: false, reason: 'shipment_not_stale' };
  }
  if (input.hasClaim || input.isReturned) {
    return { concretized: false, reason: 'claim_or_return' };
  }
  if (!input.claimLookupComplete) {
    return { concretized: false, reason: 'claim_lookup_incomplete' };
  }
  if (!input.paymentLookupComplete || input.payments.length === 0) {
    return { concretized: false, reason: 'payment_lookup_incomplete' };
  }
  if (input.payments.some((payment) => (
    normalize(payment.status) !== 'approved'
    || normalize(payment.money_release_status) !== 'released'
  ))) {
    return { concretized: false, reason: 'payment_not_released' };
  }
  if (input.payments.some((payment) => Number(payment.transaction_amount_refunded || 0) > 0)) {
    return { concretized: false, reason: 'payment_refunded' };
  }
  return { concretized: true, reason: 'concretized' };
}
