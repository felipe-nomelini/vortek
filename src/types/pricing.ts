export interface PricingParams {
  cost: number;
  shipping: number;
  mlFee: number;
  margin?: number;
}

export interface PricingResult {
  suggestedPrice: number;
  tax: number;
  mlFeeAmount: number;
  marginAmount: number;
  netProfit: number;
}
