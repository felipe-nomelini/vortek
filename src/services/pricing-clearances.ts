import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { EconomicResult } from '@/types/pricing';
import { loadProductPricing, type ProductPricing, type PricingProduct } from './pricing-context';
import { loadPricingOverrides } from './pricing-overrides';

const common = { commandId: z.string().uuid(), groupId: z.string().uuid(), groupVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(200) };
export const pricingClearanceCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('activate'), quantity: z.number().int().positive().max(2147483647),
    maxLossCents: z.number().int().nonnegative().safe(), acceptLoss: z.boolean(), endsAt: z.string().datetime().nullable(),
    stockFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...common, action: z.literal('revoke'), clearanceId: z.string().uuid() }).strict(),
  z.object({ ...common, action: z.literal('complete'), clearanceId: z.string().uuid() }).strict(),
]).superRefine((input, ctx) => {
  if (input.action === 'activate' && ((!input.acceptLoss && input.maxLossCents > 0) || !Number.isSafeInteger(input.quantity * input.maxLossCents))) {
    ctx.addIssue({ code: 'custom', message: 'Prejuízo exige aceite explícito e limite total seguro' });
  }
});
export type PricingClearanceCommand = z.infer<typeof pricingClearanceCommandSchema>;
const rowSchema = z.object({ id: z.string().uuid(), state: z.enum(['active', 'expired', 'revoked', 'completed']), reason: z.string(), startsAt: z.string(), endsAt: z.string().nullable(),
  quantity: z.number().int().positive(), maxLossCents: z.number().int().nonnegative().safe(), available: z.number().int().nonnegative(),
  actorName: z.string().nullable(), closedAt: z.string().nullable(), closeReason: z.string().nullable(),
  groups: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive(), state: z.string(), conflict: z.boolean() })) });
export type PricingClearance = z.infer<typeof rowSchema>;

/** Autorizar uma exceção não altera a economia nem comprova CMV histórico. */
export function clearanceEconomicDecision(result: EconomicResult, maxLossCents: number): 'within_limit' | 'loss_exceeded' | 'inconclusive' {
  if (!Number.isSafeInteger(maxLossCents) || maxLossCents < 0 || result.status === 'inconclusive') return 'inconclusive';
  return result.memory.resultCents >= -maxLossCents ? 'within_limit' : 'loss_exceeded';
}

type Client = SupabaseClient<Database>;
export async function loadPricingClearances(client: Client, product: PricingProduct, evaluatedPricing?: ProductPricing) {
  const [stock, clearances, protection, pricingMap] = await Promise.all([
    client.rpc('get_internal_clearance_stock', { p_product_id: product.id }),
    client.rpc('get_product_pricing_clearances', { p_product_id: product.id }),
    loadPricingOverrides(client, product.id), evaluatedPricing
      ? Promise.resolve(new Map([[product.id, evaluatedPricing]])) : loadProductPricing(client, [product]),
  ]);
  if (stock.error || clearances.error) throw new Error('clearance_read_failed');
  const stockResult = z.object({ capacity: z.number().int().nonnegative(), fingerprint: z.string() }).parse(stock.data);
  const rows = z.array(rowSchema).parse(clearances.data);
  const pricing = pricingMap.get(product.id);
  if (!pricing) throw new Error('clearance_read_failed');
  return { status: 'available' as const, stock: stockResult,
    clearances: rows.map(row => ({ ...row, economicDecision: clearanceEconomicDecision(pricing.current, row.maxLossCents) })), groups: protection.groups, pricing,
    // Não transformar uma autorização administrativa ou leitura local em licença comercial.
    executionBlocked: true as const };
}
export async function managePricingClearance(client: Client, product: PricingProduct, actorId: string, command: PricingClearanceCommand) {
  const input = pricingClearanceCommandSchema.parse(command);
  let pricing: ProductPricing | undefined;
  if (input.action === 'activate') pricing = (await loadProductPricing(client, [product])).get(product.id);
  if (input.action === 'activate' && !pricing) throw new Error('clearance_read_failed');
  const { data, error } = await client.rpc('manage_internal_stock_clearance', {
    p_product_id: product.id, p_actor_id: actorId, p_command: input as Json,
    p_evaluation: pricing ? { current: pricing.current, target: pricing.target, floor: pricing.floor, breakEven: pricing.breakEven, revalidation: pricing.revalidation ?? null } as unknown as Json : undefined,
  });
  if (error) {
    const known = ['clearance_permission_denied', 'clearance_group_mismatch', 'clearance_group_changed', 'clearance_group_unverified', 'clearance_group_conflict',
      'clearance_invalid_command', 'clearance_state_conflict', 'clearance_idempotency_conflict', 'clearance_stock_changed', 'clearance_stock_insufficient', 'clearance_evaluation_missing', 'clearance_composition_invalid'];
    throw new Error(known.includes(error.message) ? error.message : 'clearance_write_failed');
  }
  if (!data) throw new Error('clearance_write_failed');
  return data;
}
