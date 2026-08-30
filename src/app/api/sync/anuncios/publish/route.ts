import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult, type MLFailureCategory } from '@/services/integration';
import { setItemQuantityPricing } from '@/services/mercadolibre';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';
import { mapMlStatusToLocalStatus } from '@/lib/ml/status';
import { loadMlStockContext, publishAndVerifyMlStock } from '@/lib/ml/stock-publish';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';
import {
  deleteMlListingPermanently,
  detachDeletedMlListing,
  isMlListingDeletionPayload,
} from '@/lib/ml/listing-deletion';
import {
  classifyMlPublishEligibility,
  classifyMlPublishFailure,
  mlNonModifiableBlockReason,
} from '@/lib/ml/operational-listing';

export const maxDuration = 300;

const MAX_RETRY_ATTEMPTS = 5;
const CONFLICT_RETRY_BACKOFF_MINUTES = 3;
const LOCK_TTL_SECONDS = 6 * 60;
const STALE_PROCESSING_THRESHOLD_MINUTES = 10;

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

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
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

type PublishOperation = {
  op: string;
  ok: boolean;
  error?: string;
  code?: string | null;
  status?: number | null;
  category?: MLFailureCategory | null;
};

async function reconcileItemStateAfterPermanentFailure(
  client: ReturnType<typeof createServiceClient>,
  params: {
    row: any;
    outboxId: string;
    mlItemId: string;
    warnings: Array<{ code: string; message: string; context?: Record<string, unknown> }>;
  },
) {
  const itemStateResult = await fetchMLResult<any>(`/items/${params.mlItemId}`);
  if (!itemStateResult.ok || !itemStateResult.data) {
    params.warnings.push({
      code: 'ml_publish_permanent_reconcile_status_failed',
      message: itemStateResult.error?.message || 'Falha ao consultar estado final do anúncio no ML',
      context: { outboxId: params.outboxId, mlItemId: params.mlItemId, operation: 'permanent_failure_reconcile' },
    });
    return;
  }

  const anuncioReconcile = await reconcileAnuncioMlFromItem(
    client,
    itemStateResult.data,
    'publish_failure_reconcile',
  );
  if (!anuncioReconcile.ok) {
    params.warnings.push({
      code: 'ml_publish_permanent_reconcile_anuncio_update_failed',
      message: anuncioReconcile.error,
      context: { outboxId: params.outboxId, mlItemId: params.mlItemId },
    });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(20, parsePositiveInt(body?.limit, 5));
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
      ttlSeconds: LOCK_TTL_SECONDS,
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

    const staleProcessingCutoff = minutesAgoIso(STALE_PROCESSING_THRESHOLD_MINUTES);
    const { data: staleProcessingRows, error: staleProcessingSelectError } = await (client
      .from('anuncios_ml_outbox' as any)
      .select('id, payload')
      .eq('status', 'processing')
      .lte('updated_at', staleProcessingCutoff) as any);

    if (staleProcessingSelectError) {
      warnings.push({
        code: 'ml_publish_stale_processing_scan_failed',
        message: staleProcessingSelectError.message,
      });
    } else if (Array.isArray(staleProcessingRows) && staleProcessingRows.length > 0) {
      for (const staleRow of staleProcessingRows) {
        const stalePayload = normalizeOutboxPayload((staleRow as any).payload);
        const staleAttempts = Number(((stalePayload.publish_progress as Record<string, unknown> | undefined)?.attempts) || 0);
        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: 'retry',
            last_error: `Reenfileirado: item ficou preso em processing por mais de ${STALE_PROCESSING_THRESHOLD_MINUTES} minutos`,
            payload: withPublishProgress(stalePayload, {
              state: 'retry',
              last_operation: 'recover_stale_processing',
              attempts: staleAttempts,
            }) as any,
            available_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', String((staleRow as any).id)) as any);
      }

      warnings.push({
        code: 'ml_publish_stale_processing_recovered',
        message: `${staleProcessingRows.length} item(ns) presos em processing foram reenfileirados`,
        context: {
          stale_threshold_minutes: STALE_PROCESSING_THRESHOLD_MINUTES,
          count: staleProcessingRows.length,
        },
      });
    }

    if (seedFromProducts) {
      const { data: produtos } = await client
        .from('produtos')
        .select('id, ml_item_id, ml_status, custom_price')
        .eq('ativo', true)
        .not('ml_item_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (produtos?.length) {
        const capacities = await loadProductFulfillmentCapacities(
          client,
          produtos.map((produto) => String(produto.id)),
        );
        for (const produto of produtos) {
          const mlItemId = String(produto.ml_item_id || '').trim();
          if (!mlItemId) continue;
          const capacity = capacities.get(String(produto.id))
            || { internal: 0, supplier: 0, safe: 0 };
          const seeded = await enqueueMlPublishOutbox(client, {
            produtoId: String(produto.id),
            mlItemId,
            desiredStatus: produto.ml_status || null,
            desiredPrice: typeof produto.custom_price === 'number' ? produto.custom_price : null,
            desiredQuantity: capacity.safe,
            source: 'seed_from_products',
            dedupePending: true,
            payload: {
              apply_price: typeof produto.custom_price === 'number',
              apply_quantity_pricing: false,
              apply_quantity: true,
              apply_status: Boolean(produto.ml_status),
              seeded_at: new Date().toISOString(),
              estoque_fornecedor: capacity.supplier,
              estoque_interno: capacity.internal,
              estoque_disponivel: capacity.safe,
            },
          });
          if (!seeded.ok) {
            warnings.push({
              code: 'ml_publish_seed_enqueue_failed',
              message: seeded.error,
              context: { produtoId: String(produto.id), mlItemId },
            });
          }
        }
      }
    }

    let outboxQuery = client
      .from('anuncios_ml_outbox' as any)
      .select('id, produto_id, ml_item_id, desired_status, desired_price, desired_quantity, status, attempts, payload, source')
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
    const mlItemIds = Array.from(new Set(
      rows.map((row) => String(row.ml_item_id || '').trim()).filter(Boolean),
    ));
    const [observedStatesResult, listingBlocksResult] = mlItemIds.length > 0
      ? await Promise.all([
          client
            .from('catalogo_ml_snapshot')
            .select('ml_item_id,status')
            .in('ml_item_id', mlItemIds),
          client
            .from('anuncios_ml')
            .select('ml_item_id,ml_sync_block_reason,ml_sync_blocked_until')
            .in('ml_item_id', mlItemIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
    if (observedStatesResult.error) {
      throw new Error(`Falha ao consultar estado observado dos anúncios: ${observedStatesResult.error.message}`);
    }
    if (listingBlocksResult.error) {
      throw new Error(`Falha ao consultar bloqueios dos anúncios: ${listingBlocksResult.error.message}`);
    }
    const observedStatusByItemId = new Map<string, string | null>(
      (observedStatesResult.data || []).map((entry: any) => [
        String(entry.ml_item_id || '').trim(),
        entry.status ? String(entry.status) : null,
      ]),
    );
    const listingBlockByItemId = new Map<string, { reason: string | null; until: string | null }>(
      (listingBlocksResult.data || []).map((entry: any) => [
        String(entry.ml_item_id || '').trim(),
        {
          reason: entry.ml_sync_block_reason ? String(entry.ml_sync_block_reason) : null,
          until: entry.ml_sync_blocked_until ? String(entry.ml_sync_blocked_until) : null,
        },
      ]),
    );
    const eligibilityForRow = (row: any) => {
      const mlItemId = String(row.ml_item_id || '').trim();
      const block = listingBlockByItemId.get(mlItemId);
      return classifyMlPublishEligibility({
        observedStatus: observedStatusByItemId.get(mlItemId),
        blockReason: block?.reason,
        blockedUntil: block?.until,
        deleteListing: isMlListingDeletionPayload(normalizeOutboxPayload(row.payload)),
      });
    };
    const requiresStockPublish = rows.some((row) => (
      eligibilityForRow(row).eligible && resolveApplyMode(row).applyQuantity
    ));
    const mlStockContext = requiresStockPublish ? await loadMlStockContext() : null;
    const productIds = Array.from(new Set(
      rows.map((row) => String(row.produto_id || '').trim()).filter(Boolean),
    ));
    const activeProductIds = new Set<string>();
    if (productIds.length > 0) {
      const { data: productStates, error: productStatesError } = await client
        .from('produtos')
        .select('id,ativo')
        .in('id', productIds);
      if (productStatesError) {
        throw new Error(`Falha ao validar produtos da fila ML: ${productStatesError.message}`);
      }
      for (const product of productStates || []) {
        if (product.ativo !== false) activeProductIds.add(String(product.id));
      }
    }

    for (const row of rows) {
      const outboxId = String(row.id);
      const mlItemId = String(row.ml_item_id || '').trim();
      const attempts = Number(row.attempts || 0) + 1;
      const outboxPayloadBase = normalizeOutboxPayload((row as any).payload);
      const deleteListing = isMlListingDeletionPayload(outboxPayloadBase);
      const eligibility = eligibilityForRow(row);
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

      if (!eligibility.eligible && !deleteListing) {
        const now = new Date().toISOString();
        const isTemporary = eligibility.kind === 'temporarily_blocked';
        if (isTemporary) retry += 1;
        else permanentFailed += 1;

        if (!isTemporary && mlItemId) {
          const reason = mlNonModifiableBlockReason(eligibility.observedStatus || 'unknown');
          const lastError = `Estado observado no Mercado Livre não aceita publicação comum: ${eligibility.observedStatus || 'desconhecido'}`;
          await (client
            .from('anuncios_ml')
            .update({
              ml_sync_block_reason: reason,
              ml_sync_blocked_until: null,
              ml_sync_last_error: lastError,
              updated_at: now,
            } as any)
            .eq('ml_item_id', mlItemId) as any);
        }

        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: isTemporary ? 'retry' : 'cancelled',
            last_error: isTemporary
              ? `Adiado por bloqueio temporário do anúncio: ${eligibility.reason || 'ml_sync_cooldown'}`
              : `Cancelado: anúncio não modificável (${eligibility.observedStatus || eligibility.reason || 'estado desconhecido'})`,
            payload: withPublishProgress(outboxPayloadBase, {
              state: isTemporary ? 'retry' : 'cancelled',
              last_operation: isTemporary ? 'defer_ineligible_listing' : 'skip_ineligible_listing',
              eligibility,
              attempts: Number(row.attempts || 0),
            }) as any,
            processed_at: isTemporary ? null : now,
            available_at: eligibility.retryAt || now,
            updated_at: now,
          } as any)
          .eq('id', outboxId) as any);
        warnings.push({
          code: isTemporary ? 'ml_publish_listing_temporarily_blocked' : 'ml_publish_listing_not_modifiable',
          message: isTemporary
            ? 'Publicação adiada até o fim do bloqueio temporário'
            : 'Publicação cancelada sem chamar o Mercado Livre porque o anúncio não é modificável',
          context: {
            outboxId,
            mlItemId,
            observedStatus: eligibility.observedStatus,
            reason: eligibility.reason,
            retryAt: eligibility.retryAt,
          },
        });
        continue;
      }

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

      const operations: PublishOperation[] = [];

      const rowProductId = String(row.produto_id || '').trim();
      if (rowProductId && !activeProductIds.has(rowProductId) && !deleteListing) {
        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: 'cancelled',
            last_error: 'Cancelado: produto inativo não pode publicar preço, estoque ou status no ML',
            payload: withPublishProgress(outboxPayloadBase, {
              state: 'cancelled',
              last_operation: 'skip_inactive_product',
              attempts,
            }) as any,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', outboxId) as any);
        warnings.push({
          code: 'ml_publish_skip_inactive_product',
          message: 'Publicação cancelada para produto inativo',
          context: { outboxId, mlItemId, produtoId: rowProductId },
        });
        continue;
      }

      if (!mlItemId) {
        await updateProcessingMarker('validate');
        operations.push({ op: 'validate', ok: false, error: 'ml_item_id ausente no outbox' });
      } else if (deleteListing) {
        await updateProcessingMarker('delete_listing');
        const deletion = await deleteMlListingPermanently(mlItemId);
        operations.push({
          op: 'delete_listing',
          ok: deletion.ok,
          error: deletion.ok ? undefined : deletion.error,
          code: deletion.ok ? null : deletion.code,
        });
      } else {
        const applyMode = resolveApplyMode(row);
        const outboxSource = String((row as any).source || '').trim().toLowerCase();
        const desiredStatusRaw = String(row.desired_status || '').trim().toLowerCase();

        if (outboxSource === 'pricing_strategy_reprice' && desiredStatusRaw === 'sem_anuncio') {
          await (client
            .from('anuncios_ml_outbox' as any)
            .update({
              status: 'cancelled',
              last_error: 'Cancelado: repricing ignorado para item sem anúncio publicável no ML',
              payload: withPublishProgress(outboxPayloadBase, {
                state: 'cancelled',
                last_operation: 'skip_non_publishable_local_status',
                attempts,
              }) as any,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', outboxId) as any);
          warnings.push({
            code: 'ml_publish_skip_non_publishable_local_status',
            message: 'Repricing cancelado para item sem anúncio publicável no ML',
            context: { outboxId, mlItemId, source: outboxSource, desiredStatus: desiredStatusRaw },
          });
          continue;
        }

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
              code: result.error?.code,
              status: result.status,
              category: result.error?.category,
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
              status: quantityPricingResult.httpStatus,
            });
          }
        }

        if (applyMode.applyQuantity) {
          await updateProcessingMarker('quantity');
          const quantity = Math.max(0, Math.trunc(Number(row.desired_quantity)));
          const result = mlStockContext
            ? await publishAndVerifyMlStock(mlItemId, quantity, mlStockContext)
            : {
                ok: false,
                code: 'ml_stock_context_unavailable',
                error: 'Falha ao identificar o modo de estoque da conta Mercado Livre',
                status: null,
                category: null,
              };
          operations.push({
            op: 'quantity',
            ok: result.ok,
            error: result.ok ? undefined : (result.error || 'Falha ao publicar estoque no ML'),
            code: result.code,
            status: result.status,
            category: result.category,
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
              code: result.error?.code,
              status: result.status,
              category: result.error?.category,
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

        if (deleteListing) {
          try {
            await detachDeletedMlListing(client, mlItemId);
            await (client
              .from('anuncios_ml_outbox' as any)
              .update({
                status: 'done',
                last_error: null,
                processed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as any)
              .eq('id', outboxId) as any);
          } catch (error: any) {
            errors.push({
              code: 'ml_listing_detach_failed',
              message: error?.message || 'Anúncio excluído no ML, mas referências locais não foram removidas',
              context: { outboxId, mlItemId },
            });
          }
          continue;
        }

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
        const failure = classifyMlPublishFailure(failedOperation);
        const isNonPublishableState = failure.kind === 'non_modifiable';
        const isPermanentAuthorization = failure.kind === 'auth_terminal';
        const isTerminalFailure = failure.kind === 'terminal';
        const isHardFail = isPermanentAuthorization
          || isTerminalFailure
          || (failure.kind === 'unknown' && attempts >= MAX_RETRY_ATTEMPTS);
        const shouldRetry = failure.kind === 'retryable'
          || (failure.kind === 'unknown' && !isHardFail);
        const retryDelayMinutes = failure.retryConflict
          ? CONFLICT_RETRY_BACKOFF_MINUTES
          : Math.min(15, attempts);
        if (isNonPublishableState) {
          permanentFailed += 1;
        } else if (isHardFail) {
          failed += 1;
          if (isPermanentAuthorization) permanentFailed += 1;
        } else if (shouldRetry) retry += 1;

        if ((isNonPublishableState || isPermanentAuthorization) && mlItemId) {
          if (isNonPublishableState) {
            const blockedUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
            await (client
              .from('anuncios_ml')
              .update({
                ml_sync_block_reason: failedOperation.code || 'ml_non_modifiable_state',
                ml_sync_blocked_until: blockedUntil,
                ml_sync_last_error: failedOperation.error || 'Anúncio não modificável no Mercado Livre',
                updated_at: new Date().toISOString(),
              } as any)
              .eq('ml_item_id', mlItemId) as any);
          }
          await reconcileItemStateAfterPermanentFailure(client, {
            row,
            outboxId,
            mlItemId,
            warnings,
          });
        }

        await (client
          .from('anuncios_ml_outbox' as any)
          .update({
            status: isNonPublishableState ? 'cancelled' : (isHardFail ? 'failed' : 'retry'),
            last_error: `[${failedOperation.op}${failedOperation.code ? `:${failedOperation.code}` : ''}] ${failedOperation.error || 'Falha na publicação ML'}`,
            payload: withPublishProgress(outboxPayloadBase, {
              state: isNonPublishableState ? 'cancelled' : (isHardFail ? 'failed' : 'retry'),
              last_operation: failedOperation.op,
              operations,
              attempts,
            }) as any,
            processed_at: isNonPublishableState ? new Date().toISOString() : null,
            available_at: (isNonPublishableState || isHardFail)
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
            permanent: isNonPublishableState || isHardFail,
            failure_kind: failure.kind,
          },
        };

        if (isNonPublishableState || isPermanentAuthorization) {
          warnings.push(issue);
        } else {
          errors.push(issue);
        }
      }
    }

    const hasPermanentAuthorizationFailures = warnings.some((warning) => {
      const raw = `${warning.message || ''} ${warning.context?.operation || ''}`.toLowerCase();
      return raw.includes('not authorized')
        || raw.includes('unauthorized')
        || raw.includes('forbidden')
        || raw.includes('access this resource');
    });
    const hasProgress = done > 0;
    const hasOnlyRetriableFailures = failed === 0 && retry > 0;
    const hasOnlyPermanentItemFailures = errors.length === 0 && retry === 0 && failed > 0 && permanentFailed === failed;
    const success = !hasPermanentAuthorizationFailures
      && (errors.length === 0 || (hasProgress && hasOnlyRetriableFailures) || hasOnlyPermanentItemFailures);

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
      auth_failure: hasPermanentAuthorizationFailures,
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
