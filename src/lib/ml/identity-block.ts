type ServiceClientLike = {
  from: (table: string) => any;
};

export const ML_IDENTITY_GATE_CREATED_BY = "ml_identity_gate";

export async function ensureAutomaticMlIdentityBlock(
  client: ServiceClientLike,
  itemId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: lookupError } = await client
    .from("ml_manual_blocklist")
    .select("id")
    .eq("ml_item_id", itemId)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();

  if (lookupError) return { ok: false, error: lookupError.message };
  if (existing?.id) return { ok: true };

  const { error } = await client.from("ml_manual_blocklist").insert({
    ml_item_id: itemId,
    sku: null,
    ativo: true,
    motivo: reason,
    created_by: ML_IDENTITY_GATE_CREATED_BY,
  });

  return error
    ? { ok: false, error: error.message }
    : { ok: true };
}

export async function clearAutomaticMlIdentityBlock(
  client: ServiceClientLike,
  itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client
    .from("ml_manual_blocklist")
    .update({ ativo: false })
    .eq("ml_item_id", itemId)
    .eq("ativo", true)
    .eq("created_by", ML_IDENTITY_GATE_CREATED_BY);

  return error
    ? { ok: false, error: error.message }
    : { ok: true };
}
