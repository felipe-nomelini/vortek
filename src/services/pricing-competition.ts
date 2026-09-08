import type { ProductPricing } from './pricing-context';
import type { EconomicResult } from '@/types/pricing';
import type { ConflictAssessment } from '@/types/commercial-conflicts';
import type { PricingOverrideGroup } from './pricing-overrides';

export type CompetitionEvidence = {
  itemId: string; catalogProductId: string | null; observedAt: string;
  condition: 'valid' | 'unavailable' | 'inconsistent' | 'stale';
  priceCents: number | null; currentPriceCents: number | null; status: string | null;
};
export type CompetitiveClassification = 'VIAVEL_NO_ALVO' | 'VIAVEL_ACIMA_DO_PISO'
  | 'ABAIXO_DO_PISO_MAS_POSITIVO' | 'EQUILIBRIO_SEM_MARGEM'
  | 'PREJUIZO_NO_PRECO_COMPETITIVO' | 'INCONCLUSIVO';
export type CompetitiveAssessment = {
  version: 'M2M-CFL-04-v1'; classification: CompetitiveClassification;
  buyBoxConflict: boolean | null; evidence: CompetitionEvidence;
  competitive: EconomicResult | null; current: EconomicResult | null;
  references: Pick<ProductPricing, 'target' | 'floor' | 'breakEven'> | null;
  group: { id: string; version: number; state: string; memberIds: string[] } | null;
  overrideActive: boolean | null; clearanceApplied: string | null;
  reasons: string[]; assessment: ConflictAssessment;
  autonomy: 'AUTO_OBSERVE'; executionBlocked: true;
};

/** Only the documented price_to_win field is a competitive reference. */
export function competitionEvidence(payload: any, expected: {
  itemId: string; catalogProductId: string | null; currentPriceCents: number;
}, observedAt: string, ok = true): CompetitionEvidence {
  const cents = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
    && Number.isSafeInteger(Math.round(v * 100)) ? Math.round(v * 100) : null;
  const valid = ok && payload?.item_id === expected.itemId && payload?.currency_id === 'BRL'
    && payload?.catalog_product_id === expected.catalogProductId && payload?.consistent === true
    && cents(payload?.current_price) === expected.currentPriceCents
    && ['winning', 'sharing_first_place', 'competing', 'listed'].includes(payload?.status);
  return { itemId: expected.itemId, catalogProductId: expected.catalogProductId, observedAt,
    condition: !ok ? 'unavailable' : valid ? 'valid' : 'inconsistent',
    priceCents: valid ? cents(payload?.price_to_win) : null,
    currentPriceCents: valid ? cents(payload?.current_price) : null,
    status: typeof payload?.status === 'string' ? payload.status : null };
}

/** A clearance needs an explicit internal-stock scenario, never just an active authorization. */
export type CompetitiveClearance = {
  id: string; groupId: string; groupVersion: number; state: string; endsAt: string | null;
  available: number; quantity: number; maxLossCents: number;
  fulfillmentSource: 'internal' | 'supplier'; stockVerified: boolean; conflict: boolean;
};

/** Pure adapter over canonical memories. It does not calculate prices or authorize execution. */
export function assessCompetitivePricing(input: {
  pricing: ProductPricing | null; competitive: EconomicResult | null; evidence: CompetitionEvidence;
  group?: PricingOverrideGroup | null; clearance?: CompetitiveClearance | null; evaluatedAt: string;
}): CompetitiveAssessment {
  const { pricing, competitive, evidence, group } = input;
  const reasons: string[] = [];
  let classification: CompetitiveClassification = 'INCONCLUSIVO';
  let buyBoxConflict: boolean | null = null;
  let clearanceApplied: string | null = null;
  let status: ConflictAssessment['status'] = 'INCONCLUSIVO';
  const m = competitive?.memory;
  const contextMatches = m && pricing?.current.memory
    && m.context.productId === pricing.current.memory.context.productId
    && m.context.marketContextKey === pricing.current.memory.context.marketContextKey
    && m.context.offerId === pricing.current.memory.context.offerId
    && m.cost.amountCents === pricing.current.memory.cost.amountCents
    && m.policyVersion === pricing.current.memory.policyVersion;
  const valid = evidence.condition === 'valid' && evidence.priceCents !== null
    && Number.isFinite(Date.parse(evidence.observedAt)) && Date.parse(evidence.observedAt) <= Date.parse(input.evaluatedAt)
    && pricing?.revalidation?.status === 'queried' && m && contextMatches
    && pricing.target.ok && pricing.floor.ok && pricing.breakEven.ok
    && pricing.current.memory?.revenueCents === evidence.currentPriceCents
    && m.revenueCents === evidence.priceCents && m.context.mlItemId === evidence.itemId
    && m.fee.source === 'ml_live' && m.fee.quotedPriceCents === evidence.priceCents;
  if (!valid) {
    reasons.push(evidence.condition === 'stale' ? 'ANALISE_PRELIMINAR_REQUER_CONSULTA'
      : evidence.condition === 'valid' && evidence.priceCents === null ? 'REFERENCIA_COMPETITIVA_AUSENTE'
        : pricing?.revalidation?.code || 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL');
  } else {
    classification = m.margin >= m.band.target ? 'VIAVEL_NO_ALVO'
      : m.margin >= m.band.floor ? 'VIAVEL_ACIMA_DO_PISO'
        : m.resultCents > 0 ? 'ABAIXO_DO_PISO_MAS_POSITIVO'
          : m.resultCents === 0 ? 'EQUILIBRIO_SEM_MARGEM' : 'PREJUIZO_NO_PRECO_COMPETITIVO';
    buyBoxConflict = m.margin < m.band.floor;
    const c = input.clearance;
    if (c && group?.state === 'verified' && !group.inFlight && c.groupId === group.id
      && group.members.some(member => member.itemId === evidence.itemId)
      && m.context.pricingGroupId === group.id
      && c.groupVersion === group.version && c.state === 'active' && !c.conflict
      && c.fulfillmentSource === 'internal' && c.stockVerified
      && Number.isSafeInteger(c.quantity) && c.quantity > 0 && c.available >= c.quantity
      && Number.isSafeInteger(c.maxLossCents) && c.maxLossCents >= 0
      && (c.endsAt === null || Date.parse(c.endsAt) > Date.parse(input.evaluatedAt))
      && m.resultCents >= -c.maxLossCents) {
      clearanceApplied = c.id; buyBoxConflict = false; reasons.push('LIQUIDACAO_AUTORIZADA');
    }
    status = clearanceApplied || !buyBoxConflict ? 'SEM_CONFLITO'
      : m.resultCents < 0 ? 'CONFLITO_CONFIRMADO' : 'PENDENCIA_VALIDACAO';
    reasons.push(classification);
    if (buyBoxConflict) reasons.push('CONFLITO_ECONOMICO_DE_BUY_BOX');
  }
  const groupValid = group?.state === 'verified' && group.members.some(member => member.itemId === evidence.itemId)
    && !group.inFlight;
  if (!groupValid) reasons.push('GRUPO_REQUER_VALIDACAO');
  if (group?.protection) reasons.push('OVERRIDE_MANUAL_ATIVO');
  if (evidence.status === 'winning' || evidence.status === 'sharing_first_place') reasons.push('NAO_REDUZIR_POR_POSICAO_COMPETITIVA');
  const details = { coverage: valid ? 'complete' as const : 'partial' as const,
    reasons: [{ code: reasons[0], ruleId: 'M2M-CFL-04' }, ...reasons.slice(1).map(code => ({ code, ruleId: 'M2M-CFL-04' }))] as const };
  const assessment: ConflictAssessment = (status === 'SEM_CONFLITO' || status === 'CONFLITO_CONFIRMADO') && m
    ? { ...details, status, evidence: [{ source: 'economic_memory', reference: m.fingerprint,
      collectedAt: m.evaluatedAt, condition: 'valid' }] }
    : { ...details, status: status === 'PENDENCIA_VALIDACAO' ? status : 'INCONCLUSIVO', evidence: [] };
  return { version: 'M2M-CFL-04-v1', classification, buyBoxConflict, evidence,
    competitive, current: pricing?.current ?? null,
    references: pricing ? { target: pricing.target, floor: pricing.floor, breakEven: pricing.breakEven } : null,
    group: group ? { id: group.id, version: group.version, state: groupValid ? 'verified' : 'unverified',
      memberIds: [...new Set(group.members.map(member => member.itemId))].sort() } : null,
    overrideActive: group ? Boolean(group.protection) : null, clearanceApplied, reasons, assessment,
    autonomy: 'AUTO_OBSERVE', executionBlocked: true };
}
