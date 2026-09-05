export function shouldSupplierOfferBeInactiveByCost(cost: unknown, threshold: number): boolean {
  const value = Number(cost);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('Limite de elegibilidade da oferta por custo inválido');
  }
  return Number.isFinite(value) && value > threshold;
}
