export type PreferredOfferCandidate = {
  id?: string | null;
  ativo?: boolean | null;
  estoque?: number | null;
  custo?: number | null;
  prioridade?: number | null;
};

export type PreferredProductSnapshotCandidate = {
  oferta_preferencial_id?: string | null;
  fornecedor_preferencial_manual?: boolean | null;
  custo?: number | null;
  estoque?: number | null;
  fornecedor_atual_ativo?: boolean | null;
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
  if (activeOffers.length === 0) return null;

  const withStock = activeOffers.filter((offer) => Number(offer.estoque || 0) > 0);
  const eligible = withStock.length > 0 ? withStock : activeOffers;

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
 * Escolha manual válida prevalece inclusive quando está sem estoque. Isso
 * mantém a decisão do usuário e faz o estoque do produto refletir essa fonte.
 * Oferta manual inativa ou sem custo válido volta ao cálculo automático.
 */
export function resolvePreferredOfferForProduct<T extends PreferredOfferCandidate>(
  offers: T[],
  preferredOfferId?: string | null,
  manual = false,
): T | null {
  if (manual) {
    const preferredId = String(preferredOfferId || '').trim();
    const preferred = offers.find((offer) => String(offer.id || '').trim() === preferredId);
    if (preferred && preferred.ativo !== false && Number(preferred.custo || 0) > 0) {
      return preferred;
    }
  }
  return choosePreferredOffer(offers);
}

/**
 * Detecta snapshots preferenciais obsoletos durante a leitura do catálogo.
 * Permite reconciliar apenas produtos divergentes, mesmo quando custo e estoque
 * da oferta não mudaram desde a sincronização anterior.
 */
export function shouldReconcilePreferredOfferCandidate(
  product: PreferredProductSnapshotCandidate,
  candidate: PreferredOfferCandidate,
): boolean {
  const candidateId = String(candidate.id || '').trim();
  const candidateCost = Number(candidate.custo || 0);
  const candidateStock = Number(candidate.estoque || 0);
  if (!candidateId) return false;

  const currentId = String(product.oferta_preferencial_id || '').trim();
  const currentCost = Number(product.custo || 0);
  const currentStock = Number(product.estoque || 0);

  if (product.fornecedor_preferencial_manual === true) {
    if (candidateId !== currentId) return false;
    if (candidate.ativo === false || candidateCost <= 0) return true;
    return (
      Math.abs(candidateCost - currentCost) >= 0.0001 ||
      candidateStock !== currentStock
    );
  }

  if (candidateCost <= 0) return false;
  if (candidate.ativo === false) return false;

  if (candidateId === currentId) {
    return (
      Math.abs(candidateCost - currentCost) >= 0.0001 ||
      candidateStock !== currentStock
    );
  }

  if (candidateStock <= 0) return false;
  if (!currentId || product.fornecedor_atual_ativo === false) return true;
  if (currentCost <= 0 || currentStock <= 0) return true;

  return candidateCost < currentCost - 0.0001;
}
