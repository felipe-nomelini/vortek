import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export const pricingOverrideCommandSchema = z.object({
  commandId: z.string().uuid(), groupId: z.string().uuid(), groupVersion: z.number().int().positive(),
  action: z.enum(['activate', 'revoke']), reason: z.string().trim().min(1).max(200), overrideId: z.string().uuid().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.action === 'revoke') !== Boolean(value.overrideId)) ctx.addIssue({ code: 'custom', message: 'Referência da proteção incompatível com a ação', path: ['overrideId'] });
});
export type PricingOverrideCommand = z.infer<typeof pricingOverrideCommandSchema>;
export type PricingOverrideGroup = {
  id: string; version: number; state: string; anchorItemId?: string; anchorVariationId?: string;
  members: { itemId: string; variationId: string; catalog: boolean }[];
  protection: { id: string; origin: 'manual' | 'propagated'; createdAt: string; actorId: string | null; actorName: string | null; reason: string } | null;
  inFlight: boolean;
};
export type PricingProtection = { status: 'available' | 'unavailable'; groups: PricingOverrideGroup[] };
type Client = SupabaseClient<Database>;

/** Leitura própria de governança: não mistura proteção com fórmula econômica. */
export async function loadPricingOverrides(client: Client, productId: string): Promise<PricingProtection> {
  const { data: groups, error } = await client.from('ml_pricing_groups').select('id,current_version,state,anchor_item_id,anchor_variation_id').eq('produto_id', productId);
  if (error || !groups) throw new Error('pricing_override_read_failed');
  if (!groups.length) return { status: 'available', groups: [] };
  const ids = groups.map(group => group.id);
  const [memberResult, overrideResult, operations] = await Promise.all([
    client.from('ml_pricing_group_members').select('group_id,version,ml_item_id,variation_id,catalog_listing').in('group_id', ids).eq('is_current', true),
    client.from('manual_pricing_overrides').select('id,group_id,origin,created_at,actor_id,reason').in('group_id', ids).eq('state', 'active'),
    client.from('pricing_operations').select('group_id').in('group_id', ids).in('state', ['requested', 'inconclusive']),
  ]);
  if (memberResult.error || overrideResult.error || operations.error || !memberResult.data || !overrideResult.data || !operations.data) throw new Error('pricing_override_read_failed');
  const actorIds = [...new Set(overrideResult.data.flatMap(row => row.actor_id ? [row.actor_id] : []))];
  const profiles = actorIds.length ? await client.from('profiles').select('id,nome').in('id', actorIds) : { data: [], error: null };
  if (profiles.error) throw new Error('pricing_override_read_failed');
  return { status: 'available', groups: groups.flatMap(group => {
    const protection = overrideResult.data.find(row => row.group_id === group.id);
    if (group.state === 'retired' && !protection) return [];
    return [{ id: group.id, version: group.current_version, state: group.state,
      anchorItemId: group.anchor_item_id, anchorVariationId: group.anchor_variation_id,
      members: memberResult.data.filter(row => row.group_id === group.id && row.version === group.current_version)
        .map(row => ({ itemId: row.ml_item_id, variationId: row.variation_id, catalog: row.catalog_listing })),
      protection: protection ? { id: protection.id, origin: protection.origin as 'manual' | 'propagated', createdAt: protection.created_at,
        actorId: protection.actor_id, actorName: profiles.data?.find(row => row.id === protection.actor_id)?.nome ?? null, reason: protection.reason } : null,
      inFlight: operations.data.some(row => row.group_id === group.id),
    }];
  }) };
}

/** Somente o backend autenticado fornece o autor. Nenhum preço, job ou comando remoto. */
export async function managePricingOverride(client: Client, productId: string, actorId: string, command: PricingOverrideCommand) {
  const input = pricingOverrideCommandSchema.parse(command);
  const { data, error } = await client.rpc('manage_manual_pricing_override', {
    p_command_id: input.commandId, p_product_id: productId, p_group_id: input.groupId, p_group_version: input.groupVersion,
    p_action: input.action, p_actor_id: actorId, p_reason: input.reason, p_override_id: input.overrideId ?? undefined,
  });
  if (error) {
    const safe = ['override_permission_denied', 'override_group_mismatch', 'override_group_changed', 'override_group_unverified', 'override_state_conflict', 'override_idempotency_conflict'];
    throw new Error(safe.includes(error.message) ? error.message : 'pricing_override_write_failed');
  }
  if (!data) throw new Error('pricing_override_write_failed');
  return data;
}
