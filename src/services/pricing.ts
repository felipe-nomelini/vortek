import type { PricingParams, PricingResult } from '@/types/pricing';

const TAX_RATE = 0.04;
const DEFAULT_MARGIN = 0.10;

export interface PricingStrategy {
  margin: number;
  minProfit: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getPricingStrategy(cost: number): PricingStrategy {
  if (cost <= 400) {
    return { margin: 0.15, minProfit: 20 };
  }
  if (cost <= 1000) {
    return { margin: 0.20, minProfit: 60 };
  }
  return { margin: 0.25, minProfit: 150 };
}

export function calculateBreakEvenPrice(params: {
  cost: number;
  shipping: number;
  mlFee: number;
}): number {
  const denominator = 1 - (TAX_RATE + params.mlFee);
  if (denominator <= 0) {
    throw new Error('A soma de imposto (4%) e taxa ML não pode ser igual ou superior a 100%');
  }
  return round2((params.cost + params.shipping) / denominator);
}

/**
 * Calcula preço sugerido usando estratégia Vortek atual.
 *
 * Regra padrão:
 * - até R$ 400 de custo: margem 15% + lucro mínimo R$ 20
 * - R$ 401 a R$ 1.000: margem 20% + lucro mínimo R$ 60
 * - R$ 1.001 a R$ 2.000+: margem 25% + lucro mínimo R$ 150
 *
 * Quando `margin` é informado explicitamente, ele sobrescreve margem da estratégia,
 * mas o piso de lucro mínimo por faixa continua valendo.
 */
export function calculateSuggestedPrice(params: PricingParams): PricingResult {
  const { cost, shipping, mlFee } = params;
  const strategy = getPricingStrategy(cost);
  const margin = typeof params.margin === 'number' ? params.margin : strategy.margin;
  const denominator = 1 - (TAX_RATE + mlFee);

  if (denominator <= 0) {
    throw new Error(
      'A soma de imposto (4%) e taxa ML não pode ser igual ou superior a 100%'
    );
  }

  const priceByMargin = (cost + shipping + (cost * margin)) / denominator;
  const priceByMinProfit = (cost + shipping + strategy.minProfit) / denominator;
  const suggestedPrice = Math.max(priceByMargin, priceByMinProfit);
  const tax = suggestedPrice * TAX_RATE;
  const mlFeeAmount = suggestedPrice * mlFee;
  const netProfit = suggestedPrice - cost - shipping - tax - mlFeeAmount;

  return {
    suggestedPrice: round2(suggestedPrice),
    tax: round2(tax),
    mlFeeAmount: round2(mlFeeAmount),
    marginAmount: round2(netProfit),
    netProfit: round2(netProfit),
  };
}
