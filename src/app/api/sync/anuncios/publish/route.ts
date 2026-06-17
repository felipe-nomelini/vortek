import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { setItemQuantityPricing } from '@/services/mercadolibre';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';

export const maxDuration = 300;

const MAX_RETRY_ATTEMPTS = 5;
const CONFLICT_RETRY_BACKOFF_MINUTES = 3;

function parsePositiveInt(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function toMlStatus(value: unknown): 'active' | 'paused' | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'ativo' || raw === 'active') return 'active';
  if (raw === 'pausado' || raw === 'paused') return 'paused';
  return null;
}

function mapMlStatusToLocalStatus(value: unknown): 'ativo' | 'pausado' | 'sem_anuncio' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'active') return 'ativo';
  if (raw === 'paused') return 'pausado';
  return 'sem_anuncio';
}

function wantsQuantityPricing(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const raw = (payload as Record<string, unknown>).update_quantity_pricing;
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

function parseBooleanFlag(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function resolveApplyMode(row: any): {
  applyPrice: boolean;
  applyQuantityPricing: boolean;
  applyQuantity: boolean;
  applyStatus: boolean;
  basePriceForQuantityPricing: number | null;
} {
  const payload = normalizeOutboxPayload(row?.payload);

  const applyPriceFlag = parseBooleanFlag(payload.apply_price);
  const applyQuantityPricingFlag = parseBooleanFlag(payload.apply_quantity_pricing);
  const applyQuantityFlag = parseBooleanFlag(payload.apply_quantity);
  const applyStatusFlag = parseBooleanFlag(payload.apply_status);

  const hasDesiredPrice = row?.desired_price !== null && row?.desired_price !== undefined;
  const hasDesiredQuantity = row?.desired_quantity !== null && row?.desired_quantity !== undefined;
  const hasDesiredStatus = Boolean(toMlStatus(row?.desired_status));

  const basePriceRaw = Number(payload.base_price_for_quantity_pricing);
  const basePriceForQuantityPricing = Number.isFinite(basePriceRaw) && basePriceRaw > 0
    ? Math.round(basePriceRaw * 100) / 100
    : null;

  return {
    applyPrice: applyPriceFlag ?? hasDesiredPrice,
    applyQuantityPricing: applyQuantityPricingFlag ?? wantsQuantityPricing(payload),
    applyQuantity: applyQuantityFlag ?? hasDesiredQuantity,
    applyStatus: applyStatusFlag ?? hasDesiredStatus,
    basePriceForQuantityPricing,
  };
}

function normalizeOutboxPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function withPublishProgress(
  payload: Record<string, unknown>,
  progress: Record<string, unknown>,
): Record<string, unknown> {
  const current = payload.publish_progress && typeof payload.publish_progress === 'object' && !Array.isArray(payload.publish_progress)
    ? payload.publish_progress as Record<string, unknown>
    : {};
  return {
    ...payload,
    publish_progress: {
      ...current,
      ...progress,
      updated_at: new Date().toISOString(),
    },
  };
}

function isMlConflictError(operation: { error?: string; code?: string | null }): boolean {
  const raw = `${operation.code || ''} ${operation.error || ''}`.toLowerCase();
  return raw.includes('409') || raw.includes('conflict');
}

function isMlNonPublishableStateError(operation: { error?: string; code?: string | null }): boolean {
  const raw = `${operation.code || ''} ${operation.error || ''}`.toLowerCase();
  return raw.includes('cannot update item')
    && (raw.includes('status:closed') || raw.includes('status:under_review'));
}

function isMlPermanentAuthorizationError(operation: { error?: string; code?: string | null }): boolean {
  const raw = `${operation.code || ''} ${operation.error || ''}`.toLowerCase();
  return raw.includes('not authorized')
    || raw.includes('unauthorized')
    || raw.includes('forbidden')
    || raw.includes('caller is not authorized')
    || raw.includes('access this resource');
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(50, parsePositiveInt(body?.limit, 20));
  const seedFromProducts = Boolean(body?.seedFromProducts);
  const targetOutboxId = String(body?.outboxId || '').trim();

  let lockOwnerToken = '';
  let lockAcquired = false;
  const domain = 'anuncios:ml_push';
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  const warnings: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_listings_publish',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/anuncios/publish' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_ml_listings_publish',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { pulled: 0, done: 0, retry: 0, failed: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const client = createServiceClient();

    await (client
      .from('anuncios_ml_outbox' as any)
      .update({
        status: 'cancelled',
        last_error: 'Cancelado: stock_stale_guard removido; não pausar por falha/atraso de sync',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('source', 'stock_stale_guard')
      .in('status', ['pending', 'retry', 'processing']) as any);

    if (seedFromProducts) {
      const { data: produtos } = await client
        .from('produtos')
        .select('id, ml_item_id, ml_status, custom_price, estoque')
        .not('ml_item_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (produtos?.length) {
        const seedRows = produtos
          .filter((p) => String(p.ml_item_id || '').trim())
          .map((p) => ({
            produto_id: p.id,
            ml_item_id: String(p.ml_item_id),
            desired_status: p.ml_status || null,
            desired_price: typeof p.custom_price === 'number' ? p.custom_price : null,
            desired_quantity: typeof p.estoque === 'number' ? p.estoque : null,
            source: 'seed_from_products',
            payload: { seeded_at: new Date().toISOString() },
            status: 'pending',
            available_at: new Date().toISOString(),
          }));

        if (seedRows.length > 0) {
          await (client.from('anuncios_ml_outbox' as any).insert(seedRows as any) as any).catch(() => null);
        }
      }
    }

    let outboxQuery = client
      .from('anuncios_ml_outbox' as any)
      .select('id, produto_id, ml_item_id, desired_status, desired_price, desired_quantity, status, attempts, payload')
      .in('status', ['pending', 'retry']);

    if (targetOutboxId) {
      outboxQuery = outboxQuery.eq('id', targetOutboxId).limit(1);
    } else {
      outboxQuery = outboxQuery
        .lte('available_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(limit);
    }

    const { data: outboxRows, error: outboxError } = await (outboxQuery as any);

    if (outboxError) {
      throw new Error(`Falha ao consultar outbox de anúncios: ${outboxError.message}`);
    }

    const rows = Array.isArray(outboxRows) ? outboxRows : [];
    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        domain,
        job: {
          key: 'sync_ml_listings_publish',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: null,
        records: { pulled: 0, done: 0, retry: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
        ok: true,
        message: 'Outbox de publicação sem itens pendentes',
      });
    }

    let done = 0;
    let retry = 0;
    let failed = 0;
    let permanentFailed = 0;

    for (const row of rows) {
      const outboxId = String(row.id);
      const mlItemId = String(row.ml_item_id || '').trim();
      const attempts = Number(row.attempts || 0) + 1;
      const outboxPayloadBase = normalizeOutboxPayload((row as any).payload);
      let lastOperationMarker: string | null = null;
      const updateProcessingMarker = async (operation: string) => {
        lastOperationMarker = operation;
        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            payload: withPublishProgress(outboxPayloadBase, {
              last_operation: operation,
              state: 'processing',
              attempts,
            }) as any,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', outboxId) as any);
      };

      await (client
        .from('anuncios_ml_outbox' as any)
        .update({
          status: 'processing',
          attempts,
          payload: withPublishProgress(outboxPayloadBase, {
            last_operation: 'processing_start',
            state: 'processing',
            attempts,
          }) as any,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', outboxId) as any);

      const operations: Array<{ op: string; ok: boolean; error?: string; code?: string | null }> = [];

      if (!mlItemId) {
        await updateProcessingMarker('validate');
        operations.push({ op: 'validate', ok: false, error: 'ml_item_id ausente no outbox' });
      } else {
        const applyMode = resolveApplyMode(row);
        let pricePublishedOk = false;
        let pricePublishedValue: number | null = null;
        if (applyMode.applyPrice) {
          await updateProcessingMarker('price');
          const price = Number(row.desired_price);
          if (!Number.isFinite(price) || price <= 0) {
            operations.push({ op: 'price', ok: false, error: 'Preço desejado inválido' });
          } else {
            const result = await fetchMLResult<any>(`/items/${mlItemId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ price }),
            });
            operations.push({
              op: 'price',
              ok: result.ok,
              error: result.ok ? undefined : (result.error?.message || 'Falha ao publicar preço no ML'),
            });
            pricePublishedOk = result.ok;
            pricePublishedValue = price;
          }
        }

        if (applyMode.applyQuantityPricing) {
          await updateProcessingMarker('quantity_pricing');
          const basePrice = applyMode.basePriceForQuantityPricing
            ?? (Number.isFinite(Number(pricePublishedValue)) ? Number(pricePublishedValue) : null)
            ?? (Number.isFinite(Number(row.desired_price)) ? Number(row.desired_price) : null);

          if (applyMode.applyPrice && !pricePublishedOk) {
            operations.push({
              op: 'quantity_pricing',
              ok: false,
              error: 'Falha ao publicar preço base antes do atacado',
            });
          } else if (!Number.isFinite(Number(basePrice)) || Number(basePrice) <= 0) {
            operations.push({
              op: 'quantity_pricing',
              ok: false,
              error: 'Preço base inválido para publicar atacado',
            });
          } else {
            const quantityPricingResult = await setItemQuantityPricing(mlItemId, Number(basePrice));
            operations.push({
              op: 'quantity_pricing',
              ok: quantityPricingResult.ok,
              error: quantityPricingResult.ok
                ? undefined
                : (quantityPricingResult.error || 'Falha ao publicar preços de atacado no ML'),
              code: quantityPricingResult.code,
            });
          }
        }

        if (applyMode.applyQuantity) {
          await updateProcessingMarker('quantity');
          const quantity = Math.max(0, Math.trunc(Number(row.desired_quantity)));
          const result = await fetchMLResult<any>(`/items/${mlItemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ available_quantity: quantity }),
          });
          operations.push({
            op: 'quantity',
            ok: result.ok,
            error: result.ok ? undefined : (result.error?.message || 'Falha ao publicar estoque no ML'),
          });
        }

        const statusMl = toMlStatus(row.desired_status);
        if (applyMode.applyStatus && statusMl) {
          await updateProcessingMarker('status');
          const result = await fetchMLResult<any>(`/items/${mlItemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: statusMl }),
          });
          operations.push({
            op: 'status',
            ok: result.ok,
            error: result.ok ? undefined : (result.error?.message || 'Falha ao publicar status no ML'),
          });
        }
      }

      console.log(JSON.stringify({
        event: 'ml_publish_outbox_operations',
        timestamp_utc: new Date().toISOString(),
        outbox_id: outboxId,
        ml_item_id: mlItemId,
        operations,
      }));

      const failedOperation = operations.find((entry) => !entry.ok);
      if (!failedOperation) {
        done += 1;
        const lastSuccessfulOperation = operations.length > 0
          ? operations[operations.length - 1].op
          : (lastOperationMarker || 'done');
        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: 'done',
            last_error: null,
            payload: withPublishProgress(outboxPayloadBase, {
              state: 'done',
              last_operation: lastSuccessfulOperation,
              operations,
              attempts,
            }) as any,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', outboxId) as any);

        const itemStateResult = await fetchMLResult<any>(`/items/${mlItemId}`);
        if (!itemStateResult.ok || !itemStateResult.data) {
          errors.push({
            code: 'ml_publish_reconcile_status_failed',
            message: itemStateResult.error?.message || 'Falha ao consultar estado final do anúncio no ML',
            context: { outboxId, mlItemId, operation: 'status_reconcile' },
          });
        } else {
          const resolvedLocalStatus = mapMlStatusToLocalStatus(itemStateResult.data?.status);
          const reconciledMlPrice = Number(itemStateResult.data?.price);
          const hasDesiredPriceForReconcile = row.desired_price !== null && row.desired_price !== undefined;
          const desiredPrice = Number(row.desired_price);

          const produtoUpdate = row.produto_id
            ? await client
                .from('produtos')
                .update({ ml_status: resolvedLocalStatus } as any)
                .eq('id', String(row.produto_id))
            : await client
                .from('produtos')
                .update({ ml_status: resolvedLocalStatus } as any)
                .eq('ml_item_id', mlItemId);

          if (produtoUpdate.error) {
            errors.push({
              code: 'ml_publish_reconcile_produto_update_failed',
              message: produtoUpdate.error.message,
              context: { outboxId, mlItemId, localStatus: resolvedLocalStatus },
            });
          }

          const anuncioReconcile = await reconcileAnuncioMlFromItem(
            client,
            itemStateResult.data,
            'publish_reconcile',
          );
          if (!anuncioReconcile.ok) {
            errors.push({
              code: 'ml_publish_reconcile_anuncio_update_failed',
              message: anuncioReconcile.error,
              context: { outboxId, mlItemId, localStatus: resolvedLocalStatus },
            });
          }

          if (hasDesiredPriceForReconcile && Number.isFinite(desiredPrice) && Number.isFinite(reconciledMlPrice)) {
            const roundedDesiredPrice = Math.round(desiredPrice * 100) / 100;
            const roundedMlPrice = Math.round(reconciledMlPrice * 100) / 100;
            if (Math.abs(roundedDesiredPrice - roundedMlPrice) > 0.009) {
              const mismatchPayload = withPublishProgress(outboxPayloadBase, {
                state: 'done',
                last_operation: 'price_reconcile_mismatch',
                operations,
                attempts,
                desired_price: roundedDesiredPrice,
                reconciled_item_price: roundedMlPrice,
              });
              await (client
                .from('anuncios_ml_outbox' as any)
                .update({
                  last_error: `[price_reconcile_mismatch] preço final no ML (${roundedMlPrice}) difere do desejado (${roundedDesiredPrice})`,
                  payload: mismatchPayload as any,
                  updated_at: new Date().toISOString(),
                } as any)
                .eq('id', outboxId) as any);
              console.warn(JSON.stringify({
                event: 'ml_publish_price_reconcile_mismatch',
                timestamp_utc: new Date().toISOString(),
                outbox_id: outboxId,
                ml_item_id: mlItemId,
                desired_price: roundedDesiredPrice,
                reconciled_item_price: roundedMlPrice,
              }));
            }
          }
        }
      } else {
        const isNonPublishableState = isMlNonPublishableStateError(failedOperation);
        const isPermanentAuthorization = isMlPermanentAuthorizationError(failedOperation);
        const isPermanentFailure = isNonPublishableState || isPermanentAuthorization;
        const isHardFail = isPermanentFailure || attempts >= MAX_RETRY_ATTEMPTS;
        const isConflictRetry = isMlConflictError(failedOperation);
        const retryDelayMinutes = isConflictRetry
          ? CONFLICT_RETRY_BACKOFF_MINUTES
          : Math.min(15, attempts);
        if (isHardFail) failed += 1;
        else retry += 1;
        if (isPermanentFailure) permanentFailed += 1;

        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: isHardFail ? 'failed' : 'retry',
            last_error: `[${failedOperation.op}${failedOperation.code ? `:${failedOperation.code}` : ''}] ${failedOperation.error || 'Falha na publicação ML'}`,
            payload: withPublishProgress(outboxPayloadBase, {
              state: isHardFail ? 'failed' : 'retry',
              last_operation: failedOperation.op,
              operations,
              attempts,
            }) as any,
            available_at: isHardFail
              ? new Date().toISOString()
              : new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', outboxId) as any);

        const issue = {
          code: 'ml_publish_operation_failed',
          message: failedOperation.error || 'Falha na publicação',
          context: {
            outboxId,
            mlItemId,
            operation: failedOperation.op,
            attempts,
            permanent: isPermanentFailure,
          },
        };

        if (isPermanentFailure) {
          warnings.push(issue);
        } else {
          errors.push(issue);
        }
      }
    }

    const hasProgress = done > 0;
    const hasOnlyRetriableFailures = failed === 0 && retry > 0;
    const hasOnlyPermanentItemFailures = errors.length === 0 && retry === 0 && failed > 0 && permanentFailed === failed;
    const success = errors.length === 0 || (hasProgress && hasOnlyRetriableFailures) || hasOnlyPermanentItemFailures;

    return NextResponse.json({
      success,
      domain,
      job: {
        key: 'sync_ml_listings_publish',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: null,
      records: {
        pulled: rows.length,
        done,
        retry,
        failed,
        permanent_failed: permanentFailed,
      },
      errors,
      warnings,
      duration: { ms: Date.now() - startedAt },
      ok: success,
      processados: rows.length,
      publicados: done,
      reprocessar: retry,
      falhas: failed,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      job: {
        key: 'sync_ml_listings_publish',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      records: { pulled: 0, done: 0, retry: 0, failed: 0 },
      errors: [{ code: 'ml_publish_unexpected_error', message: err?.message || 'Erro inesperado no sync de publicação ML' }],
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
