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
  forceQuantityPublish?: boolean;
  forceStatusPublish?: boolean;
}

type MlPublishOperationMode = {
  applyPrice: boolean;
  applyQuantityPricing: boolean;
  applyQuantity: boolean;
  applyStatus: boolean;
};

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

function resolveInputOperationMode(
  input: MlPublishOutboxInput,
  payload: Record<string, unknown>,
  desiredPrice: number | null,
  desiredQuantity: number | null,
  desiredStatus: Database['public']['Enums']['ml_status'] | null,
): MlPublishOperationMode {
  return {
    applyPrice: operationEnabled(
      payload,
      'apply_price',
      Object.prototype.hasOwnProperty.call(input, 'desiredPrice') && desiredPrice !== null,
    ),
    applyQuantityPricing: operationEnabled(payload, 'apply_quantity_pricing', false),
    applyQuantity: operationEnabled(
      payload,
      'apply_quantity',
      Object.prototype.hasOwnProperty.call(input, 'desiredQuantity') && desiredQuantity !== null,
    ),
    applyStatus: operationEnabled(
      payload,
      'apply_status',
      Object.prototype.hasOwnProperty.call(input, 'desiredStatus') && Boolean(desiredStatus),
    ),
  };
}

function resolveRowOperationMode(row: any): MlPublishOperationMode {
  const payload = row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {};
  return {
    applyPrice: operationEnabled(
      payload,
      'apply_price',
      row?.desired_price !== null && row?.desired_price !== undefined,
    ),
    applyQuantityPricing: operationEnabled(payload, 'apply_quantity_pricing', false),
    applyQuantity: operationEnabled(
      payload,
      'apply_quantity',
      row?.desired_quantity !== null && row?.desired_quantity !== undefined,
    ),
    applyStatus: operationEnabled(payload, 'apply_status', Boolean(row?.desired_status)),
  };
}

function samePrice(left: unknown, right: unknown): boolean {
  return normalizeDesiredPrice(left) === normalizeDesiredPrice(right);
}

function requestedOperationsAreCovered(params: {
  existing: any;
  existingPayload: Record<string, unknown>;
  existingMode: MlPublishOperationMode;
  requestedPayload: Record<string, unknown>;
  requestedMode: MlPublishOperationMode;
  desiredPrice: number | null;
  desiredQuantity: number | null;
  desiredStatus: Database['public']['Enums']['ml_status'] | null;
}): boolean {
  const requestedBasePrice = Number(params.requestedPayload.base_price_for_quantity_pricing);
  const existingBasePrice = Number(params.existingPayload.base_price_for_quantity_pricing);
  const quantityPricingCovered = !params.requestedMode.applyQuantityPricing || (
    params.existingMode.applyQuantityPricing
    && Number.isFinite(requestedBasePrice)
    && Number.isFinite(existingBasePrice)
    && samePrice(requestedBasePrice, existingBasePrice)
  );
  const deletionRequested = params.requestedPayload.delete_listing === true;
  const deletionCovered = !deletionRequested || params.existingPayload.delete_listing === true;

  return deletionCovered
    && (!params.requestedMode.applyPrice || (
      params.existingMode.applyPrice
      && samePrice(params.existing.desired_price, params.desiredPrice)
    ))
    && quantityPricingCovered
    && (!params.requestedMode.applyQuantity || (
      params.existingMode.applyQuantity
      && normalizeDesiredQuantity(params.existing.desired_quantity) === params.desiredQuantity
    ))
    && (!params.requestedMode.applyStatus || (
      params.existingMode.applyStatus
      && String(params.existing.desired_status || '') === String(params.desiredStatus || '')
    ));
}

function hasRequestedOperation(
  mode: MlPublishOperationMode,
  payload: Record<string, unknown>,
): boolean {
  return mode.applyPrice
    || mode.applyQuantityPricing
    || mode.applyQuantity
    || mode.applyStatus
    || payload.delete_listing === true;
}

async function loadLatestCompletedOperation(
  client: ServiceClientLike,
  params: {
    produtoId: string;
    mlItemId: string;
    flag: 'apply_quantity' | 'apply_status';
  },
): Promise<{ data: any | null; error: string | null }> {
  const { data, error } = await (client
    .from('anuncios_ml_outbox' as any)
    .select('id,payload,desired_quantity,desired_status,processed_at,created_at')
    .eq('produto_id', params.produtoId)
    .eq('ml_item_id', params.mlItemId)
    .eq('status', 'done')
    .contains('payload', { [params.flag]: true })
    .order('processed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as any);

  return {
    data: data || null,
    error: error ? String(error.message || error) : null,
  };
}

export async function enqueueMlPublishOutbox(
  client: ServiceClientLike,
  input: MlPublishOutboxInput,
): Promise<
  | { ok: true; outboxId: string; action: 'inserted' | 'updated_existing' | 'reopened_failed' | 'unchanged' }
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
  const requestedMode = resolveInputOperationMode(
    input,
    payload,
    desiredPrice,
    desiredQuantity,
    desiredStatus,
  );
  let processingHasDifferentState = false;

  if (dedupePending) {
    const { data: existing, error: existingError } = await (client
      .from('anuncios_ml_outbox' as any)
      .select('id,status,payload,desired_price,desired_quantity,desired_status')
      .eq('produto_id', produtoId)
      .eq('ml_item_id', mlItemId)
      .in('status', ['pending', 'retry', 'failed', 'processing'])
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
      const existingMode = resolveRowOperationMode(existing);
      const previousStatus = String((existing as any)?.status || '').trim();
      const requestAlreadyCovered = hasRequestedOperation(requestedMode, payload)
        && requestedOperationsAreCovered({
          existing,
          existingPayload,
          existingMode,
          requestedPayload: payload,
          requestedMode,
          desiredPrice,
          desiredQuantity,
          desiredStatus,
        });

      if (requestAlreadyCovered && previousStatus !== 'failed') {
        return { ok: true, outboxId: existingId, action: 'unchanged' };
      }

      // A linha em processamento nunca é alterada. Se o estado mudou, uma nova
      // pendência deve sucedê-la para não ser sobrescrita pela conclusão do worker.
      if (previousStatus === 'processing') {
        processingHasDifferentState = true;
      } else {
        const mergedPayload = {
          ...existingPayload,
          ...payload,
          apply_price: existingMode.applyPrice || requestedMode.applyPrice,
          apply_quantity_pricing: existingMode.applyQuantityPricing || requestedMode.applyQuantityPricing,
          apply_quantity: existingMode.applyQuantity || requestedMode.applyQuantity,
          apply_status: existingMode.applyStatus || requestedMode.applyStatus,
        };

        const { error: updateError } = await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            desired_status: requestedMode.applyStatus ? desiredStatus : (existing as any).desired_status,
            desired_price: requestedMode.applyPrice ? desiredPrice : (existing as any).desired_price,
            desired_quantity: requestedMode.applyQuantity ? desiredQuantity : (existing as any).desired_quantity,
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

        return {
          ok: true,
          outboxId: existingId,
          action: previousStatus === 'failed' ? 'reopened_failed' : 'updated_existing',
        };
      }
    }
  }

  let applyQuantity = requestedMode.applyQuantity;
  let applyStatus = requestedMode.applyStatus;
  let unchangedOutboxId = '';
  if (dedupePending && !processingHasDifferentState) {
    const [completedQuantity, completedStatus] = await Promise.all([
      applyQuantity && input.forceQuantityPublish !== true
        ? loadLatestCompletedOperation(client, { produtoId, mlItemId, flag: 'apply_quantity' })
        : Promise.resolve({ data: null, error: null }),
      applyStatus && input.forceStatusPublish !== true
        ? loadLatestCompletedOperation(client, { produtoId, mlItemId, flag: 'apply_status' })
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (completedQuantity.error || completedStatus.error) {
      return { ok: false, error: completedQuantity.error || completedStatus.error || 'Falha ao consultar publicação ML concluída' };
    }
    if (
      completedQuantity.data
      && normalizeDesiredQuantity(completedQuantity.data.desired_quantity) === desiredQuantity
    ) {
      applyQuantity = false;
      unchangedOutboxId = String(completedQuantity.data.id || '');
    }
    if (
      completedStatus.data
      && String(completedStatus.data.desired_status || '') === String(desiredStatus || '')
    ) {
      applyStatus = false;
      unchangedOutboxId ||= String(completedStatus.data.id || '');
    }
  }

  const normalizedPayload = {
    ...payload,
    apply_price: requestedMode.applyPrice,
    apply_quantity_pricing: requestedMode.applyQuantityPricing,
    apply_quantity: applyQuantity,
    apply_status: applyStatus,
  };
  const allRequestedOperationsUnchanged = hasRequestedOperation(requestedMode, payload)
    && !requestedMode.applyPrice
    && !requestedMode.applyQuantityPricing
    && !applyQuantity
    && !applyStatus
    && payload.delete_listing !== true;
  if (allRequestedOperationsUnchanged && unchangedOutboxId) {
    return { ok: true, outboxId: unchangedOutboxId, action: 'unchanged' };
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
      payload: normalizedPayload,
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
