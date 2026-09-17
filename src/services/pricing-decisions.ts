import { createHash } from 'node:crypto';
import type { ProductPricing } from './pricing-context';
import type { PricingOverrideGroup } from './pricing-overrides';
import type { CompetitiveAssessment } from './pricing-competition';
import { pricingMaterialFingerprint } from './pricing-audit';

export type DecisionContext = {
  operationKind?: 'price_change' | 'listing_create';
  sellerId: string;
  itemId: string | null;
  groupId: string | null;
  groupVersion: number | null;
  previousPriceCents: number | null;
  priceCents: number;
  executable: boolean;
  reasons: string[];
  warnings: string[];
  disableAutomaticPricing: boolean;
  targetOrigin: 'manual_input' | 'price_to_win' | 'rule' | 'existing_price';
  competitionItemId?: string | null;
  competitivePriceCents?: number | null;
  competitionStatus?: string | null;
  strictEconomicGates?: boolean;
  requireNonDecreasingProfit?: boolean;
  fingerprint: string;
  expiresAt: string;
  clearance: { id: string; quantity: number; fulfillmentSource: 'internal' } | null;
};
type Client = { rpc: (name: any, args: any) => any };
export function decisionContext(input: {
  pricing: ProductPricing;
  sellerId: string;
  itemId: string;
  currentPriceCents: number;
  priceCents: number;
  group: PricingOverrideGroup | null;
  automatic: boolean;
  disableAutomaticPricing?: boolean;
  listingSafety?: { verified: boolean; evidence: unknown[] };
  clearance?: DecisionContext['clearance'];
  clearanceState?: unknown;
  targetOrigin?: DecisionContext['targetOrigin'];
  strictEconomicGates?: boolean;
  requireNonDecreasingProfit?: boolean;
  competition?: {
    itemId: string;
    priceCents: number | null;
    status: string | null;
  } | null;
}): DecisionContext {
  const { pricing: p, group: g } = input;
  const disableAutomaticPricing = Boolean(input.automatic || input.disableAutomaticPricing);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const strict = input.strictEconomicGates === true;
  const targetOrigin = input.targetOrigin ?? 'manual_input';
  const gate = (code: string) => (strict ? reasons : warnings).push(code);
  if (!g || g.state !== 'verified' || !g.members.some((m) => m.itemId === input.itemId))
    gate('GRUPO_NAO_CONFIRMADO');
  if (g?.inFlight) reasons.push('OPERACAO_EM_ANDAMENTO');
  if (g?.members.some(m => m.variationId)) gate('VARIACAO_REQUER_CONTRATO_DE_EXECUCAO');
  if (input.listingSafety?.verified !== true) gate('IDENTIDADE_OU_ELEGIBILIDADE_NAO_CONFIRMADA');
  if (
    p.revalidation?.status !== 'queried' ||
    p.current.status === 'inconclusive' ||
    !p.current.memory ||
    !p.target.ok ||
    !p.floor.ok ||
    !p.breakEven.ok ||
    p.current.memory.revenueCents !== input.priceCents
  )
    gate('ECONOMIA_INCONCLUSIVA');
  const m = p.current.memory;
  const expirations = [
    Date.now() + 15 * 60 * 1000,
    ...[m?.cost.expiresAt, m?.fee.expiresAt, m?.shipping.expiresAt].flatMap((t) =>
      t ? [Date.parse(t)] : [],
    ),
  ];
  if (Math.min(...expirations) <= Date.now()) gate('FONTES_EXPIRADAS');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  if (m && m.margin < m.band.floor) gate('PRECO_ABAIXO_DO_PISO');
  if (m && m.resultCents < 0) gate('PREJUIZO_PREVISTO');
  if (input.priceCents === input.currentPriceCents) gate('PRECO_JA_APLICADO');
  if (input.requireNonDecreasingProfit) {
    const proposed = p.current.memory;
    const actual = p.comparisons?.actual?.memory;
    if (!proposed || !actual || proposed.fee.source !== 'ml_live' || actual.fee.source !== 'ml_live'
      || proposed.shipping.source !== 'ml_live' || actual.shipping.source !== 'ml_live'
      || proposed.tax.context.manualRequired || actual.tax.context.manualRequired
      || p.revalidation?.status !== 'queried')
      reasons.push('LUCRO_UNITARIO_INCONCLUSIVO');
    else if (proposed.resultCents < actual.resultCents)
      reasons.push('LUCRO_UNITARIO_REDUZIDO');
    if (input.priceCents === input.currentPriceCents) reasons.push('PRECO_JA_APLICADO');
  }
  if (strict && targetOrigin === 'price_to_win' && (!input.competition
    || input.competition.itemId !== input.itemId
    || input.competition.priceCents !== input.priceCents
    || input.competition.status !== 'competing')) reasons.push('CONCORRENCIA_NAO_CONFIRMADA');
  const material = {
    seller: input.sellerId,
    item: input.itemId,
    previous: input.currentPriceCents,
    proposed: input.priceCents,
    automatic: input.automatic && !disableAutomaticPricing,
    disableAutomaticPricing,
    targetOrigin,
    competitionItemId: input.competition?.itemId ?? null,
    competitivePriceCents: input.competition?.priceCents ?? null,
    competitionStatus: input.competition?.status ?? null,
    strictEconomicGates: strict,
    requireNonDecreasingProfit: input.requireNonDecreasingProfit === true,
  };
  return {
    operationKind: 'price_change',
    sellerId: input.sellerId,
    itemId: input.itemId,
    groupId: g?.id ?? null,
    groupVersion: g?.version ?? null,
    previousPriceCents: input.currentPriceCents,
    priceCents: input.priceCents,
    executable: !reasons.length,
    reasons,
    warnings,
    disableAutomaticPricing,
    targetOrigin,
    competitionItemId: input.competition?.itemId ?? null,
    competitivePriceCents: input.competition?.priceCents ?? null,
    competitionStatus: input.competition?.status ?? null,
    strictEconomicGates: strict,
    requireNonDecreasingProfit: input.requireNonDecreasingProfit === true,
    fingerprint: createHash('sha256').update(pricingMaterialFingerprint(material)).digest('hex'),
    expiresAt,
    clearance: input.clearance ?? null,
  };
}

/** These are observation rules, not instructions to pause or chase the Buy Box. */
export function pricingAlertObservations(
  context: DecisionContext,
  assessment?: CompetitiveAssessment | null,
) {
  const rows: Array<{
    rule: string;
    severity: 'P0' | 'P1' | 'P2' | 'INFO';
    active: boolean;
    title: string;
    reason: string;
  }> = [];
  rows.push({
    rule: 'pricing_group',
    severity: 'P1',
    active: context.warnings.includes('GRUPO_NAO_CONFIRMADO'),
    title: 'Vínculo de anúncios precisa de revisão',
    reason: 'Confira a composição e a sincronização do grupo.',
  });
  rows.push({
    rule: 'pricing_evidence',
    severity: 'P2',
    active: context.warnings.includes('ECONOMIA_INCONCLUSIVA'),
    title: 'Avaliação econômica inconclusiva',
    reason: 'Reavalie as fontes antes de decidir; ausência de dados não comprova prejuízo.',
  });
  if (assessment && assessment.classification !== 'INCONCLUSIVO')
    rows.push({
      rule: 'buy_box_economy',
      severity: 'P1',
      active: assessment.buyBoxConflict === true,
      title: 'Referência competitiva abaixo do permitido',
      reason: 'O preço da concorrência não é uma ordem de alteração. Confira o impacto unitário.',
    });
  return rows;
}

export async function syncPricingAlerts(
  client: Client,
  evaluationId: string,
  context: DecisionContext,
  assessment?: CompetitiveAssessment | null,
) {
  const { error } = await client.rpc('sync_pricing_alerts', {
    p_evaluation_id: evaluationId,
    p_observations: pricingAlertObservations(context, assessment),
  });
  if (error) throw new Error('pricing_alert_persistence_failed');
}
