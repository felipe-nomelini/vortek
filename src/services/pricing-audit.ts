import { z } from 'zod';
import type { ProductPricing } from '@/services/pricing-context';

export const pricingSourceSchema = z.enum(['manual', 'pricing_engine', 'scheduled_job', 'catalog_sync', 'mercado_livre', 'supplier_sync', 'migration', 'unknown']);
export type PricingSource = z.infer<typeof pricingSourceSchema>;
type Client = { rpc: (name: any, args: any) => any; from: (table: any) => any };

/** Projeção observada + auditoria na mesma transação; nunca transporta comando ao ML. */
export async function persistPricingObservations(client: Client, table: 'anuncios_ml' | 'catalogo_ml_snapshot', rows: Record<string, unknown>[], observedAt = new Date().toISOString()) {
  const { data, error } = await client.rpc('persist_ml_pricing_observations', { p_table: table, p_rows: rows, p_observed_at: observedAt });
  if (error || !Array.isArray(data) || data.length !== rows.length) return { data, error: { message: 'pricing_observation_persistence_failed' } };
  const column = table === 'anuncios_ml' ? 'preco_ml' : 'price';
  const rejected = rows.some((row, index) => row[column] !== undefined && Number(row[column]) !== Number(data[index]?.[column]));
  return { data, error: rejected ? { message: 'pricing_observation_outdated_or_conflicting' } : null };
}

/** Mudança material não inclui relógios de coleta nem fingerprint que os contém. */
export function pricingMaterialFingerprint(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input).filter(([key]) => !['fingerprint', 'observedAt', 'evaluatedAt', 'expiresAt'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]));
  };
  return JSON.stringify(normalize(value));
}

/** A memória já é um contrato sanitizado. Não armazenar item/HTTP/body arbitrários. */
export async function recordPricingEvaluation(client: Client, productId: string, actorId: string, pricing: ProductPricing): Promise<string> {
  const result = { current: pricing.current, target: pricing.target, floor: pricing.floor, breakEven: pricing.breakEven, revalidation: pricing.revalidation ?? null };
  const { data, error } = await client.from('pricing_evaluations').insert({ produto_id: productId, actor_id: actorId,
    fingerprint: pricingMaterialFingerprint(result), result }).select('id').single();
  if (error || !data?.id) throw new Error('pricing_evaluation_persistence_failed');
  return data.id;
}

const operationSchema = z.object({ id: z.string().uuid(), evaluationId: z.string().uuid(), groupId: z.string().uuid(), groupVersion: z.number().int().positive(),
  itemId: z.string().regex(/^ML[A-Z]\d+$/), priceCents: z.number().int().positive().safe(), source: pricingSourceSchema,
  actorId: z.string().uuid().nullable(), reason: z.string().trim().min(1).max(200), ruleId: z.string().max(100).nullable().default(null), jobId: z.string().uuid().nullable().default(null),
  clearanceId: z.string().uuid().optional(), fulfillmentSource: z.enum(['internal', 'supplier']).optional(), clearanceQuantity: z.number().int().positive().max(2147483647).optional() }).strict().superRefine((input, ctx) => {
    if ((input.clearanceId || input.fulfillmentSource || input.clearanceQuantity !== undefined)
      && (!input.clearanceId || input.fulfillmentSource !== 'internal' || input.clearanceQuantity === undefined || input.source !== 'manual')) {
      ctx.addIssue({ code: 'custom', message: 'Liquidação exige contexto interno, quantidade e decisão manual explícitos' });
    }
  });

/** Contrato interno; preparar não aprova nem executa. Actor vem da sessão/job, não do body web. */
export async function preparePricingOperation(client: Client, input: z.input<typeof operationSchema>) {
  const p = operationSchema.parse(input);
  if (p.source === 'manual' && !p.actorId) throw new Error('pricing_actor_required');
  const { data, error } = await client.rpc('prepare_pricing_operation', { p_id: p.id, p_evaluation_id: p.evaluationId,
    p_group_id: p.groupId, p_group_version: p.groupVersion, p_item_id: p.itemId, p_price_cents: p.priceCents,
    p_source: p.source, p_actor_id: p.actorId, p_reason: p.reason, p_rule_id: p.ruleId, p_job_id: p.jobId,
    ...(p.clearanceId ? { p_clearance_id: p.clearanceId, p_fulfillment_source: p.fulfillmentSource, p_quantity: p.clearanceQuantity } : {}) });
  if (error) throw new Error('pricing_operation_prepare_failed');
  return data;
}

const proofSchema = z.object({ reference: z.string().regex(/^items\/[A-Z0-9]+(?:\/prices)?$/).optional(), outcome: z.enum(['readback_verified', 'no_effect_verified']).optional(),
  item_id: z.string().regex(/^ML[A-Z]\d+$/).optional(), price_cents: z.number().int().positive().safe().optional(), observed_at: z.string().datetime().optional(),
  members: z.array(z.object({ item_id: z.string().regex(/^ML[A-Z]\d+$/), variation_id: z.string(), price_cents: z.number().int().positive().safe() }).strict()).max(100).optional() }).strict();

export async function transitionPricingOperation(client: Client, id: string, state: 'requested' | 'confirmed' | 'failed' | 'inconclusive', evidence: z.input<typeof proofSchema> = {}) {
  z.string().uuid().parse(id);
  const proof = proofSchema.parse(evidence);
  const { data, error } = await client.rpc('transition_pricing_operation', { p_id: id, p_state: state, p_evidence: proof });
  if (error) throw new Error('pricing_operation_transition_failed');
  return data;
}
