export function shouldProductBeInactiveByCost(cost: unknown, threshold: number): boolean {
  const value = Number(cost);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('Limite de inativação por custo inválido');
  }
  return Number.isFinite(value) && value > threshold;
}
