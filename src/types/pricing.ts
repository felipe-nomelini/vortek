import type { PricingCostTier } from '@/lib/commercial-pricing';

export interface PricingParams {
  cost: number;
  shipping: number;
  mlFee: number;
  taxRate: number;
  costTiers: PricingCostTier[];
  margin?: number;
}

export interface PricingResult {
  suggestedPrice: number;
  tax: number;
  mlFeeAmount: number;
  marginAmount: number;
  netProfit: number;
}
