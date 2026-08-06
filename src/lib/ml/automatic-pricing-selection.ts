export type AutomaticPricingCostSnapshot = {
  productId: string;
  previous: { custo: number };
  next: { custo: number };
};

export function resolveAutomaticPricingProductIds(
  snapshots: AutomaticPricingCostSnapshot[],
  forceProductIds: string[] = [],
): string[] {
  return Array.from(new Set([
    ...snapshots
      .filter((snapshot) => Math.abs(Number(snapshot.previous.custo) - Number(snapshot.next.custo)) > 0.0001)
      .map((snapshot) => String(snapshot.productId || '').trim())
      .filter(Boolean),
    ...forceProductIds.map((productId) => String(productId || '').trim()).filter(Boolean),
  ]));
}
