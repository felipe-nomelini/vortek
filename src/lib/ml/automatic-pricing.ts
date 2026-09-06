import { resolveAutomaticPricingProductIds } from '@/lib/ml/automatic-pricing-selection';
import { getPricingExecutionBlock } from './pricing-execution.js';

type ServiceClientLike = { from: (table: string) => any };

export type CostSnapshot = {
  productId: string;
  previous: { custo: number };
  next: { custo: number };
};

export type AutomaticPricingResult = {
  productsUpdated: number;
  outboxEnqueued: number;
  skipped: number;
  errors: Array<{ productId: string; message: string }>;
  blockedReason?: string;
};

/** PRC-03: sincronizar CMV não autoriza mudar preço nem enfileirar reprecificação. */
export async function enqueueAutomaticPricesForCostChanges(
  _client: ServiceClientLike,
  snapshots: CostSnapshot[],
  options: { forceProductIds?: string[] } = {},
): Promise<AutomaticPricingResult> {
  const productIds = resolveAutomaticPricingProductIds(snapshots, options.forceProductIds);
  return {
    productsUpdated: 0, outboxEnqueued: 0, skipped: productIds.length, errors: [],
    ...(productIds.length ? { blockedReason: getPricingExecutionBlock()?.code || 'pricing_automation_not_implemented' } : {}),
  };
}
