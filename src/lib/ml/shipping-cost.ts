/**
 * Retorna o custo logístico configurado pelo Vortek para modos sem cotação do ML.
 */
export function getConfiguredMlShippingCost(
  shippingMode: unknown,
  unspecifiedShippingCost: number,
): number | null {
  const normalizedMode = String(shippingMode || '').trim().toLowerCase();
  return normalizedMode === 'not_specified'
    ? unspecifiedShippingCost
    : null;
}
