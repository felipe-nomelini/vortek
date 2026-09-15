export type CatalogIdentityTargetOrigin = 'manual_input' | 'price_to_win' | 'rule' | 'existing_price';

type Client = { rpc: (name: any, args: any) => PromiseLike<{ error?: { message?: string } | null }> };

/** Guard final de preço. A entrada manual explícita é preservada pelo contrato executivo. */
export async function assertCatalogIdentityPriceGuard(client: Client, input: {
  sellerId: string | number;
  itemId: string;
  targetOrigin: CatalogIdentityTargetOrigin;
  auditId?: number | null;
}) {
  if (input.targetOrigin === 'manual_input') return;
  const sellerId = Number(input.sellerId);
  if (!Number.isSafeInteger(sellerId) || sellerId <= 0 || !/^MLB\d+$/.test(input.itemId))
    throw new Error('ml_identity_price_write_blocked');
  const result = await client.rpc('assert_ml_catalog_identity_price_guard', {
    p_seller_id: sellerId,
    p_item_id: input.itemId,
    p_target_origin: input.targetOrigin,
    p_audit_id: input.auditId ?? null,
  });
  if (result.error) throw new Error('ml_identity_price_write_blocked');
}
