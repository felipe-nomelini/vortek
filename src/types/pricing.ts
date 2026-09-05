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

/** M2M-PRC-01: centavos BRL e margens sobre receita, nunca markup sobre custo. */
export type FinalPriceBandId = 'UP_TO_200' | 'FROM_200_TO_1000' | 'ABOVE_1000';
export type FinalPriceObjective = 'floor' | 'target' | 'limit' | 'break_even';

export type FinalPriceBand = Readonly<{
  id: FinalPriceBandId;
  maxCents: number | null;
  floor: number;
  target: number;
  limit: number;
}>;

export type FinalPricePolicy = Readonly<{
  version: string;
  bands: readonly FinalPriceBand[];
}>;

export type FinalPriceCandidateCalculator = (input: Readonly<{
  band: FinalPriceBand;
  objective: FinalPriceObjective;
  margin: number;
}>) => number;

export type FinalPriceResolution =
  | {
    ok: true;
    policyVersion: string;
    objective: FinalPriceObjective;
    priceCents: number;
    band: FinalPriceBand;
    /** Total de cálculos executados, considerando todas as faixas candidatas. */
    iterations: number;
  }
  | {
    ok: false;
    error: 'POLITICA_PRICING_INVALIDA' | 'OBJETIVO_PRICING_INVALIDO'
      | 'PRECO_CANDIDATO_INVALIDO' | 'CALCULO_CANDIDATO_FALHOU'
      | 'PRECIFICACAO_NAO_CONVERGIU';
    iterations: number;
  };
