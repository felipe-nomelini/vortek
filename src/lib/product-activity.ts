export const PRODUCT_COST_INACTIVE_THRESHOLD = Number.POSITIVE_INFINITY;

export function shouldProductBeInactiveByCost(cost: unknown): boolean {
  const value = Number(cost);
  return Number.isFinite(value) && value > PRODUCT_COST_INACTIVE_THRESHOLD;
}
