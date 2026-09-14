import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';
import { shouldSkipManuallyBlockedStockUpdate } from '@/lib/ml/protective-stock';

export const maxDuration = 300;

function parsePositiveInt(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function resolveDesiredMlStatusByStock(estoque: number): 'ativo' | 'pausado' {
  return estoque > 0 ? 'ativo' : 'pausado';
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(500, parsePositiveInt(body?.limit, 500));
  const cursor = String(body?.cursor || '').trim();
  const dryRun = Boolean(body?.dryRun);
  const zeroStockOnly = Boolean(body?.zeroStockOnly);
  const targetMlItemIds: string[] = Array.from(new Set<string>(
    (Array.isArray(body?.mlItemIds) ? body.mlItemIds : [])
      .map((value: unknown) => String(value || '').trim().toUpperCase())
      .filter(Boolean),
  )).slice(0, 500);
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  const domain = 'anuncios:ml_stock_backfill';

  const emptyRecords = {
    scanned: 0,
    enqueued: 0,
    updated_existing: 0,
    unchanged: 0,
    skipped_manual_block: 0,
    manual_block_bypassed_zero_stock: 0,
    skipped_positive_stock: 0,
    skipped_ineligible: 0,
    skipped_without_product: 0,
    failed: 0,
  };

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_stock_status_backfill',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/anuncios/backfill-estoque-status' },
    });
    lockOwnerToken = lock.ownerToken;

    if (!lock.acquired) {
      return NextResponse.json({
        success: false,
        domain,
        cursor: null,
        records: emptyRecords,
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const client = createServiceClient();
    let listingsQuery = client
      .from('anuncios_ml')
      .select('id,produto_id,ml_item_id,status,sku')
      .in('status', ['ativo', 'pausado'])
      .not('produto_id', 'is', null)
      .order('id', { ascending: true })
      .limit(limit);
    if (targetMlItemIds.length > 0) listingsQuery = listingsQuery.in('ml_item_id', targetMlItemIds);
    else if (cursor) listingsQuery = listingsQuery.gt('id', cursor);

    const { data: listings, error: listingsError } = await listingsQuery;
    if (listingsError) {
      return NextResponse.json({
        success: false,
        domain,
        cursor: null,
        records: emptyRecords,
        errors: [{ code: 'anuncios_query_failed', message: listingsError.message }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 500 });
    }

    const rows = Array.isArray(listings) ? listings : [];
    const productIds = Array.from(new Set(
      rows.map((row) => String(row.produto_id || '').trim()).filter(Boolean),
    ));
    const capacitiesByProduct = await loadProductFulfillmentCapacities(client, productIds);
    const mlItemIds = Array.from(new Set(rows.map((row) => String(row.ml_item_id || '').trim()).filter(Boolean)));
    const skuUpperList = Array.from(new Set(rows.map((row) => String(row.sku || '').trim().toUpperCase()).filter(Boolean)));
    const manualBlockedByItemId = new Set<string>();
    const manualBlockedBySku = new Set<string>();

    const [manualByItemResp, manualBySkuResp] = await Promise.all([
      mlItemIds.length > 0
        ? client.from('ml_manual_blocklist').select('ml_item_id').eq('ativo', true).in('ml_item_id', mlItemIds)
        : Promise.resolve({ data: [], error: null } as any),
      skuUpperList.length > 0
        ? client.from('ml_manual_blocklist').select('sku').eq('ativo', true).in('sku', skuUpperList)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    const manualBlockLookupFailed = Boolean(manualByItemResp.error || manualBySkuResp.error);
    if (manualBlockLookupFailed) {
      errors.push({
        code: 'ml_manual_blocklist_query_failed',
        message: manualByItemResp.error?.message || manualBySkuResp.error?.message || 'Falha ao consultar bloqueio manual ML',
      });
    } else {
      for (const row of manualByItemResp.data || []) {
        const mlItemId = String((row as any).ml_item_id || '').trim();
        if (mlItemId) manualBlockedByItemId.add(mlItemId);
      }
      for (const row of manualBySkuResp.data || []) {
        const skuUpper = String((row as any).sku || '').trim().toUpperCase();
        if (skuUpper) manualBlockedBySku.add(skuUpper);
      }
    }

    let enqueued = 0;
    let updatedExisting = 0;
    let unchanged = 0;
    let skippedManualBlock = 0;
    let manualBlockBypassedZeroStock = 0;
    let skippedPositiveStock = 0;
    let skippedIneligible = 0;
    let skippedWithoutProduct = 0;
    let failed = 0;

    for (const row of rows) {
      const productId = String(row.produto_id || '').trim();
      const mlItemId = String(row.ml_item_id || '').trim();
      const sku = String(row.sku || '').trim();
      if (!productId || !mlItemId) {
        skippedWithoutProduct += 1;
        continue;
      }
      const capacity = capacitiesByProduct.get(productId) || { internal: 0, supplier: 0, safe: 0 };
      const estoque = capacity.safe;
      if (zeroStockOnly && estoque > 0) {
        skippedPositiveStock += 1;
        continue;
      }

      const desiredStatus = resolveDesiredMlStatusByStock(estoque);
      const isManualBlocked = manualBlockedByItemId.has(mlItemId)
        || manualBlockedBySku.has(sku.toUpperCase());
      if (manualBlockLookupFailed && estoque > 0) {
        skippedManualBlock += 1;
        continue;
      }
      if (shouldSkipManuallyBlockedStockUpdate({
        manuallyBlocked: isManualBlocked,
        desiredStatus,
        desiredQuantity: estoque,
      })) {
        skippedManualBlock += 1;
        continue;
      }
      if (isManualBlocked && estoque <= 0) manualBlockBypassedZeroStock += 1;

      if (dryRun) {
        enqueued += 1;
        continue;
      }

      const observedActive = String(row.status || '').trim().toLowerCase() === 'ativo';
      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: productId,
        mlItemId,
        desiredStatus,
        desiredQuantity: estoque,
        desiredPrice: null,
        source: 'dslite_stock_backfill',
        dedupePending: true,
        forceQuantityPublish: estoque <= 0 && observedActive,
        forceStatusPublish: estoque <= 0 && observedActive,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: true,
          sku,
          estoque_fornecedor: capacity.supplier,
          estoque_interno: capacity.internal,
          estoque_disponivel: estoque,
          status_desejado: desiredStatus,
          manual_block_bypassed_for_zero_stock: isManualBlocked && estoque <= 0,
          origin: 'api/sync/anuncios/backfill-estoque-status',
          backfill: true,
          zero_stock_only: zeroStockOnly,
        },
      });

      if (!outbox.ok) {
        failed += 1;
        errors.push({ code: 'ml_outbox_enqueue_failed', message: outbox.error, context: { sku, mlItemId } });
      } else if (outbox.action === 'unchanged') unchanged += 1;
      else if (outbox.action === 'skipped_ineligible') skippedIneligible += 1;
      else if (outbox.action === 'updated_existing' || outbox.action === 'reopened_failed') updatedExisting += 1;
      else enqueued += 1;
    }

    const nextCursor = targetMlItemIds.length === 0 && rows.length === limit
      ? String(rows[rows.length - 1]?.id || '') || null
      : null;
    return NextResponse.json({
      success: errors.length === 0,
      domain,
      dry_run: dryRun,
      zero_stock_only: zeroStockOnly,
      cursor: nextCursor,
      cursor_exhausted: nextCursor === null,
      records: {
        scanned: rows.length,
        enqueued,
        updated_existing: updatedExisting,
        unchanged,
        skipped_manual_block: skippedManualBlock,
        manual_block_bypassed_zero_stock: manualBlockBypassedZeroStock,
        skipped_positive_stock: skippedPositiveStock,
        skipped_ineligible: skippedIneligible,
        skipped_without_product: skippedWithoutProduct,
        failed,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
    }, { status: errors.length === 0 ? 200 : 207 });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      cursor: null,
      records: emptyRecords,
      errors: [{ code: 'ml_stock_backfill_unexpected_error', message: err?.message || 'Erro inesperado no backfill de estoque/status ML' }],
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({ domain, ownerToken: lockOwnerToken }).catch(() => null);
    }
  }
}
