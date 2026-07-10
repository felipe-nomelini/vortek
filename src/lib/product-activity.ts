export const PRODUCT_COST_INACTIVE_THRESHOLD = 2000;

export function shouldProductBeInactiveByCost(cost: unknown): boolean {
  const value = Number(cost);
  return Number.isFinite(value) && value > PRODUCT_COST_INACTIVE_THRESHOLD;
}
