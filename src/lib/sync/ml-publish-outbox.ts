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
): Promise<{ ok: true; outboxId: string } | { ok: false; error: string }> {
  const produtoId = String(input.produtoId || '').trim();
  const mlItemId = String(input.mlItemId || '').trim();
  if (!produtoId || !mlItemId) {
    return { ok: false, error: 'produtoId e mlItemId são obrigatórios para enfileirar publicação ML' };
  }

  const desiredPrice = normalizeDesiredPrice(input.desiredPrice);
  const desiredQuantity = normalizeDesiredQuantity(input.desiredQuantity);
  const desiredStatus = input.desiredStatus || null;

  const { data, error } = await (client
    .from('anuncios_ml_outbox' as any)
    .insert({
      produto_id: produtoId,
      ml_item_id: mlItemId,
      desired_status: desiredStatus,
      desired_price: desiredPrice,
      desired_quantity: desiredQuantity,
      source: String(input.source || 'produto_update'),
      payload: input.payload || {},
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

  return { ok: true, outboxId };
}
