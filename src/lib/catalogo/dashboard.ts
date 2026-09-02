export type CatalogEligibilityActionState =
  | 'ready'
  | 'review_required'
  | 'catalog_product_unavailable'
  | 'local_product_missing';

export type CatalogVariationEligibility = {
  id?: number;
  status?: string | null;
  buy_box_eligible?: boolean | null;
  catalog_product_id?: string | null;
};

export type CatalogOptinTarget = {
  itemId: string;
  catalogProductId: string;
  variationId?: number;
};

const RELIABLE_MATCH_SCORE = 100;

export function isCatalogEligibilityReady(status: unknown) {
  return String(status || '').trim().toUpperCase() === 'READY_FOR_OPTIN';
}

export function readyCatalogVariations(variations: CatalogVariationEligibility[]) {
  return (Array.isArray(variations) ? variations : []).filter((variation) => (
    isCatalogEligibilityReady(variation.status)
    && variation.buy_box_eligible !== false
  ));
}

export function classifyCatalogEligibility(row: Record<string, any>): {
  state: CatalogEligibilityActionState;
  reason: string;
} {
  const localProductId = String(row.local_product_id || row.produto_id || '').trim();
  if (!localProductId) {
    return {
      state: 'local_product_missing',
      reason: 'Vincule o anúncio padrão a um produto Bentevi antes de criar o anúncio de catálogo.',
    };
  }

  const variations = readyCatalogVariations(row.variation_eligibility || []);
  const ready = isCatalogEligibilityReady(row.eligibility_status) || variations.length > 0;
  if (!ready) {
    return {
      state: 'review_required',
      reason: row.eligibility_reason || 'O Mercado Livre não liberou este anúncio para opt-in.',
    };
  }

  const suggestedProductId = String(row.catalog_product_id_sugerido || '').trim();
  const currentProductId = String(row.catalog_product_id || '').trim();
  const variationHasProduct = variations.some((variation) => Boolean(String(variation.catalog_product_id || '').trim()));
  const hasCatalogProduct = Boolean(suggestedProductId || currentProductId || variationHasProduct);
  const activeProduct = String(row.catalog_product_status || '').trim().toLowerCase() === 'active';
  if (!hasCatalogProduct || !activeProduct) {
    return {
      state: 'catalog_product_unavailable',
      reason: hasCatalogProduct
        ? 'O produto de catálogo relacionado não está ativo no Mercado Livre.'
        : 'O Mercado Livre não informou um produto de catálogo para esta publicação.',
    };
  }

  const reliableSuggestion = suggestedProductId
    && row.catalog_product_match_source === 'attributes_search'
    && Number(row.catalog_product_match_score || 0) >= RELIABLE_MATCH_SCORE;
  if (row.catalog_product_warning && !reliableSuggestion) {
    return {
      state: 'review_required',
      reason: String(row.catalog_product_warning),
    };
  }

  return {
    state: 'ready',
    reason: variations.length > 0
      ? `${variations.length} variação(ões) pronta(s); será criado um anúncio de catálogo para cada variação.`
      : 'Identidade e produto de catálogo confirmados para criação.',
  };
}

export function buildCatalogOptinTargets(row: Record<string, any>): CatalogOptinTarget[] {
  const itemId = String(row.ml_item_id || '').trim();
  if (!itemId) return [];

  const fallbackCatalogProductId = String(
    row.catalog_product_id_sugerido || row.catalog_product_id || '',
  ).trim();
  const variations = readyCatalogVariations(row.variation_eligibility || []);

  if (variations.length > 0) {
    return variations.flatMap((variation) => {
      const variationId = Number(variation.id);
      const catalogProductId = String(variation.catalog_product_id || fallbackCatalogProductId).trim();
      if (!Number.isFinite(variationId) || !catalogProductId) return [];
      return [{ itemId, catalogProductId, variationId }];
    });
  }

  if (!isCatalogEligibilityReady(row.eligibility_status) || !fallbackCatalogProductId) return [];
  return [{ itemId, catalogProductId: fallbackCatalogProductId }];
}

export function catalogCompetitionPresentation(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'winning') {
    return { key: 'winning', label: 'Ganhando', tone: 'positive', description: 'Este anúncio recebe as vendas da página de produto.' };
  }
  if (normalized === 'sharing_first_place') {
    return { key: 'sharing_first_place', label: 'Dividindo 1º lugar', tone: 'positive', description: 'Mais de um anúncio está compartilhando a primeira posição.' };
  }
  if (normalized === 'competing') {
    return { key: 'competing', label: 'Competindo', tone: 'warning', description: 'O anúncio participa da disputa, mas não está em primeiro lugar.' };
  }
  if (normalized === 'listed' || normalized === 'not_listed') {
    return { key: 'outside', label: 'Fora da competição', tone: 'negative', description: 'O anúncio permanece publicado, mas não pode vencer a disputa agora.' };
  }
  return { key: 'unavailable', label: 'Estado indisponível', tone: 'neutral', description: 'A última análise não informou o estado da competição.' };
}
