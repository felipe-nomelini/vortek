export type PreferredOfferCandidate = {
  id?: string | null;
  ativo?: boolean | null;
  estoque?: number | null;
  custo?: number | null;
  prioridade?: number | null;
};

export function normalizeOfferPriority(value: unknown, fallback = 100): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

/**
 * Escolhe automaticamente menor custo válido. Estoque, atividade e custo são
 * critérios obrigatórios; prioridade e estoque apenas desempatem.
 */
export function choosePreferredOffer<T extends PreferredOfferCandidate>(offers: T[]): T | null {
  if (!Array.isArray(offers) || offers.length === 0) return null;

  const validCostOffers = offers.filter((offer) => Number(offer.custo || 0) > 0);
  if (validCostOffers.length === 0) return null;

  const activeOffers = validCostOffers.filter((offer) => offer.ativo !== false);
  const source = activeOffers.length > 0 ? activeOffers : validCostOffers;
  const withStock = source.filter((offer) => Number(offer.estoque || 0) > 0);
  const eligible = withStock.length > 0 ? withStock : source;

  const sorted = [...eligible].sort((left, right) => {
    const costDiff = Number(left.custo || 0) - Number(right.custo || 0);
    if (costDiff !== 0) return costDiff;

    const priorityDiff = normalizeOfferPriority(left.prioridade) - normalizeOfferPriority(right.prioridade);
    if (priorityDiff !== 0) return priorityDiff;

    const stockDiff = Number(right.estoque || 0) - Number(left.estoque || 0);
    if (stockDiff !== 0) return stockDiff;

    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  return sorted[0] || null;
}

/**
 * `preferredOfferId` permanece no contrato para compatibilidade. Preferência
 * atual não bloqueia mais troca automática para oferta elegível mais barata.
 */
export function resolvePreferredOfferForProduct<T extends PreferredOfferCandidate>(
  offers: T[],
  _preferredOfferId?: string | null,
): T | null {
  return choosePreferredOffer(offers);
}
