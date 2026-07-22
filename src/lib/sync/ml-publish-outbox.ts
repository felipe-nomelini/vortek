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

function parseBooleanFlag(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function operationEnabled(
  payload: Record<string, unknown>,
  key: 'apply_price' | 'apply_quantity_pricing' | 'apply_quantity' | 'apply_status',
  hasDesiredValue: boolean,
): boolean {
  return parseBooleanFlag(payload[key]) ?? hasDesiredValue;
}

export async function enqueueMlPublishOutbox(
  client: ServiceClientLike,
  input: MlPublishOutboxInput,
): Promise<
  | { ok: true; outboxId: string; action: 'inserted' | 'updated_existing' | 'reopened_failed' }
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
      .select('id,status,payload,desired_price,desired_quantity,desired_status')
      .eq('produto_id', produtoId)
      .eq('ml_item_id', mlItemId)
      // Nunca altera a linha em processamento: o worker poderia finalizar depois
      // e sobrescrever uma atualização de preço/estoque recém-enfileirada.
      .in('status', ['pending', 'retry', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as any);

    if (existingError) {
      return { ok: false, error: existingError.message };
    }

    const existingId = String((existing as any)?.id || '').trim();
    if (existingId) {
      const existingPayload =
        (existing as any)?.payload && typeof (existing as any).payload === 'object' && !Array.isArray((existing as any).payload)
          ? ((existing as any).payload as Record<string, unknown>)
          : {};
      const hasDesiredPrice = Object.prototype.hasOwnProperty.call(input, 'desiredPrice');
      const hasDesiredQuantity = Object.prototype.hasOwnProperty.call(input, 'desiredQuantity');
      const hasDesiredStatus = Object.prototype.hasOwnProperty.call(input, 'desiredStatus');
      const existingApplyPrice = operationEnabled(existingPayload, 'apply_price', (existing as any).desired_price !== null);
      const existingApplyQuantityPricing = operationEnabled(existingPayload, 'apply_quantity_pricing', false);
      const existingApplyQuantity = operationEnabled(existingPayload, 'apply_quantity', (existing as any).desired_quantity !== null);
      const existingApplyStatus = operationEnabled(existingPayload, 'apply_status', Boolean((existing as any).desired_status));
      const nextApplyPrice = operationEnabled(payload, 'apply_price', hasDesiredPrice && desiredPrice !== null);
      const nextApplyQuantityPricing = operationEnabled(payload, 'apply_quantity_pricing', false);
      const nextApplyQuantity = operationEnabled(payload, 'apply_quantity', hasDesiredQuantity && desiredQuantity !== null);
      const nextApplyStatus = operationEnabled(payload, 'apply_status', hasDesiredStatus && Boolean(desiredStatus));
      const mergedPayload = {
        ...existingPayload,
        ...payload,
        apply_price: existingApplyPrice || nextApplyPrice,
        apply_quantity_pricing: existingApplyQuantityPricing || nextApplyQuantityPricing,
        apply_quantity: existingApplyQuantity || nextApplyQuantity,
        apply_status: existingApplyStatus || nextApplyStatus,
      };

      const { error: updateError } = await (client
        .from('anuncios_ml_outbox' as any)
        .update({
          desired_status: nextApplyStatus ? desiredStatus : (existing as any).desired_status,
          desired_price: nextApplyPrice ? desiredPrice : (existing as any).desired_price,
          desired_quantity: nextApplyQuantity ? desiredQuantity : (existing as any).desired_quantity,
          source,
          payload: mergedPayload,
          status: 'pending',
          attempts: 0,
          last_error: null,
          processed_at: null,
          available_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', existingId) as any);

      if (updateError) {
        return { ok: false, error: updateError.message };
      }

      const previousStatus = String((existing as any)?.status || '').trim();
      return {
        ok: true,
        outboxId: existingId,
        action: previousStatus === 'failed' ? 'reopened_failed' : 'updated_existing',
      };
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
