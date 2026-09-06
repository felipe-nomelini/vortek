import type { ProductPricing } from '@/services/pricing-context';

/** Apenas apresentação do DTO; nenhuma regra de cálculo econômico no browser/PDF. */
export function pricingView(pricing: ProductPricing | null | undefined) {
  const current = pricing?.current.memory;
  const target = pricing?.target.ok ? pricing.target : null;
  return {
    displayPrice: pricing?.currentPriceCents != null ? pricing.currentPriceCents / 100 : null,
    suggestedPrice: target ? target.priceCents / 100 : null,
    cost: pricing?.costCents != null ? pricing.costCents / 100 : null,
    profit: current ? current.resultCents / 100 : null,
    margin: current ? current.margin * 100 : null,
    status: pricing?.current.status ?? 'inconclusive',
    reasons: pricing?.current.reasons ?? [{ field: 'input', code: 'DADO_AUSENTE' }],
  };
}
