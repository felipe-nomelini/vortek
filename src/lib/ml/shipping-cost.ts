export const NOT_SPECIFIED_FIXED_SHIPPING_COST = 30;

/**
 * Retorna o custo logístico configurado pelo Vortek para modos sem cotação do ML.
 */
export function getConfiguredMlShippingCost(shippingMode: unknown): number | null {
  const normalizedMode = String(shippingMode || '').trim().toLowerCase();
  return normalizedMode === 'not_specified'
    ? NOT_SPECIFIED_FIXED_SHIPPING_COST
    : null;
}
