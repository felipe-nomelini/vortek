import type { Database } from '@/types/database';

type ServiceClientLike = {
  from: (table: 'anuncios_ml') => any;
};

type AnuncioRow = Database['public']['Tables']['anuncios_ml']['Row'];
type AnuncioInsert = Database['public']['Tables']['anuncios_ml']['Insert'];
type AnuncioUpdate = Database['public']['Tables']['anuncios_ml']['Update'];

type ExistingAnuncioCandidate = Pick<AnuncioRow, 'id' | 'ml_item_id' | 'sku' | 'produto_id'>;

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
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

  const { data: byItemId, error: byItemIdError } = await (client
    .from('anuncios_ml')
    .select('id, ml_item_id, sku, produto_id')
    .eq('ml_item_id', mlItemId) as any);
  if (byItemIdError) return { ok: false, error: byItemIdError.message };

  const exact = ((byItemId || []) as ExistingAnuncioCandidate[])
    .find((row) => normalizeText(row.ml_item_id) === mlItemId) || null;

  if (exact) {
    const existingProdutoId = normalizeText(exact.produto_id);
    if (produtoId && existingProdutoId && existingProdutoId !== produtoId) {
      return {
        ok: false,
        error: `Conflito de produto no anúncio ${mlItemId}: ${existingProdutoId} != ${produtoId}`,
      };
    }

    const patch: AnuncioUpdate = {
      ...normalizedPayload,
      updated_at: toIsoNow(),
    };

    const { error: updateError } = await (client
      .from('anuncios_ml')
      .update(patch as any)
      .eq('id', exact.id) as any);
    if (updateError) return { ok: false, error: updateError.message };

    return {
      ok: true,
      canonicalId: normalizeText(exact.id) || null,
      removedDuplicateIds: [],
    };
  }

  const { data: bySku, error: bySkuError } = await (client
    .from('anuncios_ml')
    .select('id, ml_item_id, sku, produto_id')
    .eq('sku', sku) as any);
  if (bySkuError) return { ok: false, error: bySkuError.message };

  const conflictingRow = ((bySku || []) as ExistingAnuncioCandidate[]).find((row) => {
    const existingProdutoId = normalizeText(row.produto_id);
    return Boolean(produtoId && existingProdutoId && existingProdutoId !== produtoId);
  });
  if (conflictingRow) {
    return {
      ok: false,
      error: `Conflito de SKU ${sku}: anúncio ${normalizeText(conflictingRow.ml_item_id)} pertence ao produto ${normalizeText(conflictingRow.produto_id)}`,
    };
  }

  const { error } = await (client
    .from('anuncios_ml')
    .upsert(normalizedPayload as any, { onConflict: 'ml_item_id' }) as any);
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    canonicalId: null,
    removedDuplicateIds: [],
  };
}
