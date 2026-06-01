import type { Database } from '@/types/database';

type ServiceClientLike = {
  from: (table: string) => any;
};

export interface MlPublishOutboxInput {
  produtoId: string;
  mlItemId: string;
  desiredStatus?: Database['public']['Enums']['ml_status'] | null;
  desiredPrice?: number | null;
  desiredQuantity?: number | null;
  source?: string;
  payload?: Record<string, unknown>;
  dedupePending?: boolean;
}

function normalizeDesiredPrice(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeDesiredQuantity(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

export async function enqueueMlPublishOutbox(
  client: ServiceClientLike,
  input: MlPublishOutboxInput,
): Promise<
  | { ok: true; outboxId: string; action: 'inserted' | 'updated_existing' }
  | { ok: false; error: string }
> {
  const produtoId = String(input.produtoId || '').trim();
  const mlItemId = String(input.mlItemId || '').trim();
  if (!produtoId || !mlItemId) {
    return { ok: false, error: 'produtoId e mlItemId são obrigatórios para enfileirar publicação ML' };
  }

  const desiredPrice = normalizeDesiredPrice(input.desiredPrice);
  const desiredQuantity = normalizeDesiredQuantity(input.desiredQuantity);
  const desiredStatus = input.desiredStatus || null;
  const source = String(input.source || 'produto_update');
  const payload = input.payload || {};
  const dedupePending = input.dedupePending === true;

  if (dedupePending) {
    const { data: existing, error: existingError } = await (client
      .from('anuncios_ml_outbox' as any)
      .select('id, payload')
      .eq('produto_id', produtoId)
      .eq('ml_item_id', mlItemId)
      .in('status', ['pending', 'retry', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as any);

    if (existingError) {
      return { ok: false, error: existingError.message };
    }

    const existingId = String((existing as any)?.id || '').trim();
    if (existingId) {
      const mergedPayload =
        (existing as any)?.payload && typeof (existing as any).payload === 'object' && !Array.isArray((existing as any).payload)
          ? { ...((existing as any).payload as Record<string, unknown>), ...payload }
          : payload;

      const { error: updateError } = await (client
        .from('anuncios_ml_outbox' as any)
        .update({
          desired_status: desiredStatus,
          desired_price: desiredPrice,
          desired_quantity: desiredQuantity,
          source,
          payload: mergedPayload,
          available_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', existingId) as any);

      if (updateError) {
        return { ok: false, error: updateError.message };
      }

      return { ok: true, outboxId: existingId, action: 'updated_existing' };
    }
  }

  const { data, error } = await (client
    .from('anuncios_ml_outbox' as any)
    .insert({
      produto_id: produtoId,
      ml_item_id: mlItemId,
      desired_status: desiredStatus,
      desired_price: desiredPrice,
      desired_quantity: desiredQuantity,
      source,
      payload,
      status: 'pending',
      available_at: new Date().toISOString(),
    } as any)
    .select('id')
    .single() as any);

  if (error) {
    return { ok: false, error: error.message };
  }

  const outboxId = String((data as any)?.id || '').trim();
  if (!outboxId) {
    return { ok: false, error: 'Outbox criado sem identificador retornado' };
  }

  return { ok: true, outboxId, action: 'inserted' };
}
