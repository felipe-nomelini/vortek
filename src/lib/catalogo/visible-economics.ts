import type { EconomicIssue, EconomicResult } from '@/types/pricing';

export const CATALOG_VISIBLE_ECONOMICS_BATCH_SIZE = 5;
export const CATALOG_VISIBLE_ECONOMICS_CONCURRENCY = 2;

export type CatalogEconomicReason =
  | 'CALCULATION_PENDING'
  | 'PRODUCT_UNLINKED'
  | 'COST_UNAVAILABLE'
  | 'SHIPPING_UNAVAILABLE'
  | 'FEE_UNAVAILABLE'
  | 'TAX_UNAVAILABLE'
  | 'REFERENCE_NOT_AVAILABLE'
  | 'REFERENCE_INCONSISTENT'
  | 'LISTING_INCOMPATIBLE'
  | 'SNAPSHOT_CHANGED'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'ML_UNAVAILABLE';

export type CatalogEconomicSummary = {
  status: 'available' | 'inconclusive' | 'not_applicable';
  profit: number | null;
  marginPercent: number | null;
  source: 'live_saved' | 'ml_live' | 'unavailable';
  calculatedAt: string | null;
  reason: CatalogEconomicReason | null;
};

export type CatalogLiveReference = {
  currentPrice: number;
  currentSource: 'ml_live' | 'snapshot';
  currentObservedAt: string;
  priceToWin: number | null;
  competitionStatus: string | null;
  competitionSource: 'ml_live' | 'snapshot';
  competitionObservedAt: string;
  changedFromSnapshot: boolean;
};

export type CatalogVisibleEconomicsRow = {
  mlItemId: string;
  snapshotSyncedAt: string;
  reference: CatalogLiveReference;
  current: CatalogEconomicSummary;
  competitive: CatalogEconomicSummary;
};

export type CatalogVisibleEconomicsResponse = {
  data: CatalogVisibleEconomicsRow[];
  haltReason: Extract<CatalogEconomicReason, 'RATE_LIMITED' | 'AUTH_REQUIRED' | 'ML_UNAVAILABLE'> | null;
};

export function unavailableCatalogEconomy(reason: CatalogEconomicReason): CatalogEconomicSummary {
  return { status: 'inconclusive', profit: null, marginPercent: null,
    source: 'unavailable', calculatedAt: null, reason };
}

export function notApplicableCatalogEconomy(reason: 'REFERENCE_NOT_AVAILABLE'): CatalogEconomicSummary {
  return { status: 'not_applicable', profit: null, marginPercent: null,
    source: 'unavailable', calculatedAt: null, reason };
}

export function catalogEconomicReason(reasons: readonly EconomicIssue[]): CatalogEconomicReason {
  if (reasons.some(reason => reason.field === 'cost' || reason.code === 'OFERTA_INELEGIVEL')) return 'COST_UNAVAILABLE';
  if (reasons.some(reason => reason.field === 'shipping')) return 'SHIPPING_UNAVAILABLE';
  if (reasons.some(reason => reason.field === 'fee')) return 'FEE_UNAVAILABLE';
  if (reasons.some(reason => reason.field === 'tax')) return 'TAX_UNAVAILABLE';
  return 'ML_UNAVAILABLE';
}

export function presentCatalogEconomicResult(result: EconomicResult | null | undefined,
  calculatedAt: string): CatalogEconomicSummary {
  if (!result || result.status === 'inconclusive') {
    return unavailableCatalogEconomy(catalogEconomicReason(result?.reasons || []));
  }
  return { status: 'available', profit: result.memory.resultCents / 100,
    marginPercent: result.memory.margin * 100, source: 'ml_live', calculatedAt, reason: null };
}

export function catalogEconomicsCacheKey(input: { ml_item_id: string; snapshot_synced_at: string | null }) {
  return `${input.ml_item_id}:${input.snapshot_synced_at || ''}`;
}

export function catalogEconomicReasonLabel(reason: CatalogEconomicReason | null | undefined): string {
  const labels: Record<CatalogEconomicReason, string> = {
    CALCULATION_PENDING: 'Calculando resultado…',
    PRODUCT_UNLINKED: 'Produto não vinculado',
    COST_UNAVAILABLE: 'Custo do produto indisponível',
    SHIPPING_UNAVAILABLE: 'Frete indisponível',
    FEE_UNAVAILABLE: 'Tarifa do Mercado Livre indisponível',
    TAX_UNAVAILABLE: 'Configuração fiscal pendente',
    REFERENCE_NOT_AVAILABLE: 'Sem preço para ganhar',
    REFERENCE_INCONSISTENT: 'Referência do Mercado Livre inconsistente',
    LISTING_INCOMPATIBLE: 'Anúncio incompatível para cotação',
    SNAPSHOT_CHANGED: 'Os dados mudaram; atualize a lista',
    RATE_LIMITED: 'Mercado Livre limitou as consultas',
    AUTH_REQUIRED: 'Reconecte a conta do Mercado Livre',
    ML_UNAVAILABLE: 'Mercado Livre indisponível para o cálculo',
  };
  return reason ? labels[reason] : 'Resultado indisponível';
}
