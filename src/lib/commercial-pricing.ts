export type PricingCostTier = {
  position: number;
  maxCost: number | null;
  margin: number;
  minProfit: number;
};

export type CommercialPricingConfiguration = {
  mlFeeFallbackRate: number;
  unspecifiedShippingCost: number;
  inactiveCostThreshold: number;
  /** @deprecated Sem carga operacional; somente contratos históricos ainda em retirada. */
  costTiers?: PricingCostTier[];
};

export function resolveMlFee(value: unknown, fallbackRate: number): number {
  if (value !== null && value !== undefined && value !== "") {
    const observed = Number(value);
    if (Number.isFinite(observed) && observed >= 0 && observed < 1) {
      return observed;
    }
  }
  return fallbackRate;
}
