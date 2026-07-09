import type { Database } from '@/types/database';

type ServiceClientLike = {
  from: (table: 'anuncios_ml') => any;
};

type AnuncioRow = Database['public']['Tables']['anuncios_ml']['Row'];
type AnuncioInsert = Database['public']['Tables']['anuncios_ml']['Insert'];
type AnuncioUpdate = Database['public']['Tables']['anuncios_ml']['Update'];

type ExistingAnuncioCandidate = Pick<AnuncioRow, 'id' | 'ml_item_id' | 'sku' | 'produto_id' | 'updated_at'>;

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function byMostRecentlyUpdated(a: ExistingAnuncioCandidate, b: ExistingAnuncioCandidate) {
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

function uniqueCandidates(rows: ExistingAnuncioCandidate[]) {
  const seen = new Set<string>();
  const unique: ExistingAnuncioCandidate[] = [];

  for (const row of rows) {
    const id = normalizeText(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(row);
  }

  return unique;
}

export async function persistSingleAnuncioBySku(
  client: ServiceClientLike,
  payload: AnuncioInsert,
): Promise<{ ok: true; canonicalId: string | null; removedDuplicateIds: string[] } | { ok: false; error: string }> {
  const mlItemId = normalizeText(payload.ml_item_id);
  if (!mlItemId) return { ok: false, error: 'ml_item_id ausente para persistir anúncio' };

  const sku = normalizeText(payload.sku);
  const produtoId = normalizeText(payload.produto_id);
  const normalizedPayload: AnuncioInsert = {
    ...payload,
    ml_item_id: mlItemId,
    sku,
    produto_id: produtoId || null,
    updated_at: toIsoNow(),
  };

  if (!sku) {
    const { error } = await (client
      .from('anuncios_ml')
      .upsert(normalizedPayload as any, { onConflict: 'ml_item_id' }) as any);

    if (error) return { ok: false, error: error.message };
    return { ok: true, canonicalId: null, removedDuplicateIds: [] };
  }

  const { data: bySku, error: bySkuError } = await (client
    .from('anuncios_ml')
    .select('id, ml_item_id, sku, produto_id, updated_at')
    .eq('sku', sku) as any);
  if (bySkuError) return { ok: false, error: bySkuError.message };

  const { data: byItemId, error: byItemIdError } = await (client
    .from('anuncios_ml')
    .select('id, ml_item_id, sku, produto_id, updated_at')
    .eq('ml_item_id', mlItemId) as any);
  if (byItemIdError) return { ok: false, error: byItemIdError.message };

  const candidates = uniqueCandidates([
    ...((byItemId || []) as ExistingAnuncioCandidate[]),
    ...((bySku || []) as ExistingAnuncioCandidate[]),
  ]);

  const canonical = candidates.find((row) => normalizeText(row.ml_item_id) === mlItemId)
    || candidates.find((row) => produtoId && normalizeText(row.produto_id) === produtoId)
    || [...candidates].sort(byMostRecentlyUpdated)[0]
    || null;

  if (!canonical) {
    const { error } = await (client
      .from('anuncios_ml')
      .upsert(normalizedPayload as any, { onConflict: 'ml_item_id' }) as any);

    if (error) return { ok: false, error: error.message };
    return { ok: true, canonicalId: null, removedDuplicateIds: [] };
  }

  const patch: AnuncioUpdate = {
    ...normalizedPayload,
    updated_at: toIsoNow(),
  };

  const { error: updateError } = await (client
    .from('anuncios_ml')
    .update(patch as any)
    .eq('id', canonical.id) as any);
  if (updateError) return { ok: false, error: updateError.message };

  const duplicateIds = candidates
    .map((row) => normalizeText(row.id))
    .filter((id) => id && id !== normalizeText(canonical.id));

  if (duplicateIds.length > 0) {
    const { error: deleteError } = await (client
      .from('anuncios_ml')
      .delete()
      .in('id', duplicateIds) as any);
    if (deleteError) return { ok: false, error: deleteError.message };
  }

  return {
    ok: true,
    canonicalId: normalizeText(canonical.id) || null,
    removedDuplicateIds: duplicateIds,
  };
}
