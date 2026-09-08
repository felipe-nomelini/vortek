import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { ProductPricing } from './pricing-context';
import type { PricingOverrideGroup } from './pricing-overrides';
import type { CompetitiveAssessment } from './pricing-competition';
import { pricingMaterialFingerprint } from './pricing-audit';
import { getPricingExecutionBlock } from '@/lib/ml/pricing-execution';

export const decisionCommandSchema = z
  .object({
    commandId: z.string().uuid(),
    action: z.enum(['approve', 'reject', 'defer']),
    reason: z.string().trim().min(1).max(200),
    deferredUntil: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === 'defer') !== Boolean(v.deferredUntil))
      ctx.addIssue({ code: 'custom', message: 'Adiamento exige data' });
  });

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
  listingSafety?: { verified: boolean; evidence: unknown[] };
  clearance?: DecisionContext['clearance'];
  clearanceState?: unknown;
}): DecisionContext {
  const { pricing: p, group: g } = input;
  const reasons: string[] = [];
  if (!g || g.state !== 'verified' || !g.members.some((m) => m.itemId === input.itemId))
    reasons.push('GRUPO_NAO_CONFIRMADO');
  if (g?.inFlight) reasons.push('OPERACAO_EM_ANDAMENTO');
  if (g?.members.some(m => m.variationId)) reasons.push('VARIACAO_REQUER_CONTRATO_DE_EXECUCAO');
  if (input.automatic) reasons.push('PRECO_AUTOMATICO_ML');
  if (input.listingSafety?.verified !== true) reasons.push('IDENTIDADE_OU_ELEGIBILIDADE_NAO_CONFIRMADA');
  if (
    p.revalidation?.status !== 'queried' ||
    p.current.status === 'inconclusive' ||
    !p.current.memory ||
    !p.target.ok ||
    !p.floor.ok ||
    !p.breakEven.ok ||
    p.current.memory.revenueCents !== input.priceCents
  )
    reasons.push('ECONOMIA_INCONCLUSIVA');
  const m = p.current.memory;
  const expirations = [
    Date.now() + 15 * 60 * 1000,
    ...[m?.cost.expiresAt, m?.fee.expiresAt, m?.shipping.expiresAt].flatMap((t) =>
      t ? [Date.parse(t)] : [],
    ),
  ];
  const expiresAt = new Date(Math.min(...expirations)).toISOString();
  if (Date.parse(expiresAt) <= Date.now()) reasons.push('FONTES_EXPIRADAS');
  if (m && m.margin < m.band.floor && !input.clearance) reasons.push('PRECO_ABAIXO_DO_PISO');
  if (input.priceCents === input.currentPriceCents) reasons.push('PRECO_JA_APLICADO');
  const material = {
    seller: input.sellerId,
    item: input.itemId,
    previous: input.currentPriceCents,
    proposed: input.priceCents,
    memory: m,
    group: g
      ? {
          id: g.id,
          version: g.version,
          state: g.state,
          members: [...g.members].sort(
            (a, b) => a.itemId.localeCompare(b.itemId) || a.variationId.localeCompare(b.variationId),
          ),
          overrideId: g.protection?.id ?? null,
          inFlight: g.inFlight,
        }
      : null,
    automatic: input.automatic,
    listingSafety: input.listingSafety ?? null,
    clearance: input.clearance ?? null,
    clearanceState: input.clearanceState ?? null,
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
    active: context.reasons.includes('GRUPO_NAO_CONFIRMADO'),
    title: 'Vínculo de anúncios precisa de revisão',
    reason: 'Confira a composição e a sincronização do grupo.',
  });
  rows.push({
    rule: 'pricing_evidence',
    severity: 'P2',
    active: context.reasons.includes('ECONOMIA_INCONCLUSIVA'),
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

/** The only consumption entrypoint. Legacy writers retain their unconditional block. */
export async function consumePricingDecision(
  client: Client,
  input: { decisionId: string; operationId: string; actorId: string },
  revalidate: () => Promise<string>,
) {
  if (process.env.ML_PRICING_EXECUTION_MODE !== 'test_only')
    throw new Error(getPricingExecutionBlock()!.code);
  // Server-owned account/destination checks; no browser flag grants execution.
  const { requireTestPricingAccount } = await import('./pricing-execution-access');
  await requireTestPricingAccount();
  const evaluationId = await revalidate();
  const { data, error } = await client.rpc('consume_pricing_decision', {
    p_id: z.string().uuid().parse(input.decisionId),
    p_operation_id: z.string().uuid().parse(input.operationId),
    p_actor_id: z.string().uuid().parse(input.actorId),
    p_fresh_evaluation_id: evaluationId,
  });
  if (error || !data) throw new Error('decision_consumption_failed');
  return data;
}
