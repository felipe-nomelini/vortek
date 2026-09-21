export type CatalogEligibilityActionState =
  | 'ready'
  | 'already_opted_in'
  | 'review_required'
  | 'catalog_product_missing'
  | 'catalog_product_unavailable'
  | 'identity_mismatch'
  | 'local_product_missing';

export type CatalogVariationEligibility = {
  id?: number;
  status?: string | null;
  buy_box_eligible?: boolean | null;
  catalog_product_id?: string | null;
  catalog_product_status?: string | null;
};

export type CatalogOptinTarget = {
  itemId: string;
  catalogProductId: string;
  variationId?: number;
};

export type CatalogOperationalView = 'needs_action' | 'healthy' | 'all';

export type CatalogOperationalState = {
  key: 'paused' | 'missing_product' | 'competition_unavailable' | 'outside' | 'competing' | 'healthy';
  needsAction: boolean;
  label: string;
  description: string;
  actionLabel: string;
  tone: 'positive' | 'warning' | 'negative' | 'neutral';
};

export type CatalogBoostState = {
  key: 'boosted' | 'not_boosted' | 'opportunity' | 'not_apply' | 'unknown';
  label: string;
  actionable: boolean;
  tone: 'positive' | 'warning' | 'neutral';
};

export type CatalogPriceGuidance = {
  key: 'available' | 'already_winning' | 'shared_lead' | 'blocked' | 'not_participating' | 'not_suggested' | 'unavailable';
  label: string;
  description: string;
};

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
  const mlStatus = String(row.eligibility_status || '').trim().toUpperCase();
  const variations = readyCatalogVariations(row.variation_eligibility || []);
  if (mlStatus === 'ALREADY_OPTED_IN' && variations.length === 0) {
    return { state: 'already_opted_in', reason: 'O Mercado Livre informou que este anúncio já participa do catálogo. Confira o anúncio no Mercado Livre.' };
  }

  const localProductId = String(row.local_product_id || row.produto_id || '').trim();
  if (!localProductId) {
    return {
      state: 'local_product_missing',
      reason: 'O anúncio padrão não está vinculado a um produto Bentevi. Confira o SKU e o vínculo do produto.',
    };
  }

  const ready = isCatalogEligibilityReady(row.eligibility_status) || variations.length > 0;
  if (mlStatus === 'CATALOG_PRODUCT_ID_NULL') {
    return { state: 'catalog_product_missing', reason: 'O Mercado Livre não associou um produto de catálogo a este anúncio. Confira o produto correspondente antes de publicar.' };
  }
  if (mlStatus === 'PRODUCT_INACTIVE') {
    return { state: 'catalog_product_unavailable', reason: 'O Mercado Livre informou que o produto de catálogo está inativo. Confira sua disponibilidade antes de publicar.' };
  }
  if (!ready) {
    return {
      state: 'review_required',
      reason: 'O Mercado Livre não confirmou que este anúncio está pronto para o catálogo. Confira o anúncio e a elegibilidade no Mercado Livre.',
    };
  }

  const currentProductId = String(row.catalog_product_id || '').trim();
  const variationHasProduct = variations.some((variation) => Boolean(String(variation.catalog_product_id || '').trim()));
  const hasCatalogProduct = Boolean(currentProductId || variationHasProduct);
  if (!hasCatalogProduct) {
    return { state: 'catalog_product_missing', reason: 'O Mercado Livre não informou um produto de catálogo confirmado para esta publicação.' };
  }
  const activeProduct = variations.length > 0
    ? variations.every((variation) => String(variation.catalog_product_status || '').toLowerCase() === 'active')
    : String(row.catalog_product_status || '').trim().toLowerCase() === 'active';
  if (!activeProduct) {
    return {
      state: 'catalog_product_unavailable',
      reason: 'O produto de catálogo relacionado não está ativo no Mercado Livre. Confira sua disponibilidade antes de publicar.',
    };
  }

  if (row.catalog_product_warning) {
    return {
      state: 'identity_mismatch',
      reason: String(row.catalog_product_warning),
    };
  }

  return {
    state: 'ready',
    reason: variations.length > 0
      ? `${variations.length} variação(ões) elegível(is) no Mercado Livre. Confira a inclusão no catálogo na conta do Mercado Livre.`
      : 'Elegibilidade e produto de catálogo confirmados pelo Mercado Livre. Confira a inclusão no catálogo na conta do Mercado Livre.',
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
  if (normalized === 'listed') {
    return { key: 'outside', label: 'Impedido de competir', tone: 'negative', description: 'O anúncio está no catálogo, mas outro critério do Mercado Livre impede a disputa.' };
  }
  if (normalized === 'not_listed') {
    return { key: 'outside', label: 'Não participa da disputa', tone: 'negative', description: 'O Mercado Livre não incluiu este anúncio na competição de catálogo.' };
  }
  return { key: 'unavailable', label: 'Estado indisponível', tone: 'neutral', description: 'A última análise não informou o estado da competição.' };
}

export function catalogOperationalPresentation(row: Record<string, unknown>): CatalogOperationalState {
  const status = String(row.status || '').trim().toLowerCase();
  const competition = String(row.buy_box_status || '').trim().toLowerCase();
  if (status !== 'active') {
    return { key: 'paused', needsAction: true, label: status === 'paused' ? 'Anúncio pausado' : 'Anúncio indisponível',
      description: 'O anúncio não está ativo para receber vendas.', actionLabel: 'Revisar anúncio', tone: 'negative' };
  }
  if (!String(row.produto_id || '').trim()) {
    return { key: 'missing_product', needsAction: true, label: 'Produto não identificado no Bentevi',
      description: 'Não encontramos o produto local correspondente. Sem ele, não é possível calcular o resultado.',
      actionLabel: 'Revisar produto', tone: 'negative' };
  }
  if (!competition) {
    return { key: 'competition_unavailable', needsAction: true, label: 'Competição não informada',
      description: 'Atualize o catálogo para consultar a situação deste anúncio.', actionLabel: 'Ver detalhes', tone: 'neutral' };
  }
  if (competition === 'listed') {
    return { key: 'outside', needsAction: true, label: 'Impedido de competir',
      description: 'O anúncio está no catálogo, mas outro critério do Mercado Livre impede a disputa.', actionLabel: 'Ver impedimento', tone: 'negative' };
  }
  if (competition === 'not_listed') {
    return { key: 'outside', needsAction: true, label: 'Não participa da disputa',
      description: 'O Mercado Livre não incluiu este anúncio na competição de catálogo.', actionLabel: 'Ver situação', tone: 'negative' };
  }
  if (competition === 'competing') {
    return { key: 'competing', needsAction: true, label: 'Competindo',
      description: 'O anúncio participa da disputa, mas não está em primeiro lugar.', actionLabel: 'Revisar preço', tone: 'warning' };
  }
  if (competition === 'winning' || competition === 'sharing_first_place') {
    const state = catalogCompetitionPresentation(competition);
    return { key: 'healthy', needsAction: false, label: state.label,
      description: state.description, actionLabel: 'Ver detalhes', tone: 'positive' };
  }
  return { key: 'competition_unavailable', needsAction: true, label: 'Competição não informada',
    description: 'Atualize o catálogo para consultar a situação deste anúncio.', actionLabel: 'Ver detalhes', tone: 'neutral' };
}

export function catalogPriceToWinPresentation(input: {
  status: unknown;
  priceToWin: unknown;
}): CatalogPriceGuidance {
  const price = Number(input.priceToWin);
  if (Number.isFinite(price) && price > 0) {
    return { key: 'available', label: 'Preço informado', description: 'Preço competitivo sugerido pelo Mercado Livre.' };
  }

  const status = String(input.status || '').trim().toLowerCase();
  if (status === 'winning') {
    return { key: 'already_winning', label: 'Já está ganhando', description: 'Não é necessário reduzir o preço para liderar agora.' };
  }
  if (status === 'sharing_first_place') {
    return { key: 'shared_lead', label: 'Divide o 1º lugar', description: 'O anúncio já compartilha a melhor posição.' };
  }
  if (status === 'listed') {
    return { key: 'blocked', label: 'Preço não resolve sozinho', description: 'Consulte o impedimento informado pelo Mercado Livre.' };
  }
  if (status === 'not_listed') {
    return { key: 'not_participating', label: 'Não participa da disputa', description: 'Não há preço para ganhar fora da competição.' };
  }
  if (status === 'competing') {
    return { key: 'not_suggested', label: 'Sem sugestão de preço', description: 'Confira os outros critérios da disputa.' };
  }
  return { key: 'unavailable', label: 'Consulta indisponível', description: 'Atualize os dados para consultar novamente.' };
}

const CATALOG_COMPETITION_REASON_LABELS: Record<string, string> = {
  non_trusted_seller: 'A conta não está habilitada pelo Mercado Livre para competir.',
  reputation_below_threshold: 'A reputação da conta ainda não atende ao nível exigido para competir.',
  item_reputation_below_threshold: 'O desempenho deste anúncio ainda não atende ao nível exigido para competir.',
  winner_has_better_reputation: 'O anúncio vencedor possui reputação melhor neste momento.',
  manufacturing_time: 'O prazo de disponibilidade impede competir com anúncios de estoque imediato.',
  temporarily_winning_manufacturing_time: 'O anúncio lidera temporariamente, mas possui prazo de disponibilidade.',
  temporarily_competing_manufacturing_time: 'O anúncio compete temporariamente com prazo de disponibilidade.',
  temporarily_winning_best_reputation_available: 'O anúncio lidera temporariamente por ter a melhor reputação disponível.',
  temporarily_competing_best_reputation_available: 'O anúncio compete temporariamente com a melhor reputação disponível.',
  item_paused: 'O anúncio está pausado e não pode participar da disputa.',
  item_not_opted_in: 'O anúncio não foi incluído no catálogo e não participa da disputa.',
  shipping_mode: 'A modalidade de envio é menos competitiva que a do anúncio vencedor.',
  newbie_program_seller: 'A conta atingiu o limite temporário de vendas definido pelo Mercado Livre.',
};

export function catalogCompetitionReasonPresentation(reason: unknown): string {
  const normalized = String(reason || '').trim().toLowerCase();
  return CATALOG_COMPETITION_REASON_LABELS[normalized]
    || 'O Mercado Livre informou outro critério que impede a competição.';
}

export function catalogBoostPresentation(status: unknown): CatalogBoostState {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'boosted') return { key: 'boosted', label: 'Ativo e ajuda na disputa', actionable: false, tone: 'positive' };
  if (normalized === 'not_boosted') return { key: 'not_boosted', label: 'Ativo, mas sem vantagem', actionable: false, tone: 'neutral' };
  if (normalized === 'opportunity') return { key: 'opportunity', label: 'Pode melhorar a disputa', actionable: true, tone: 'warning' };
  if (normalized === 'not_apply') return { key: 'not_apply', label: 'Não se aplica', actionable: false, tone: 'neutral' };
  return { key: 'unknown', label: 'Situação não informada pelo Mercado Livre', actionable: false, tone: 'neutral' };
}
