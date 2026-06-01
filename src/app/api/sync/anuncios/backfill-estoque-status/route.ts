import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

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
  const limit = Math.min(5000, parsePositiveInt(body?.limit, 500));
  const dryRun = Boolean(body?.dryRun);
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;
  const domain = 'anuncios:ml_stock_backfill';

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_stock_status_backfill',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/anuncios/backfill-estoque-status' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        records: { scanned: 0, enqueued: 0, updated_existing: 0, skipped_manual_block: 0, failed: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const client = createServiceClient();
    const { data: produtos, error: produtosError } = await client
      .from('produtos')
      .select('id,sku,estoque,ml_item_id')
      .not('ml_item_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (produtosError) {
      return NextResponse.json({
        success: false,
        domain,
        records: { scanned: 0, enqueued: 0, updated_existing: 0, skipped_manual_block: 0, failed: 0 },
        errors: [{ code: 'produtos_query_failed', message: produtosError.message }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 500 });
    }

    const rows = Array.isArray(produtos) ? produtos : [];
    const mlItemIds = Array.from(new Set(rows.map((row) => String(row.ml_item_id || '').trim()).filter(Boolean)));
    const skuUpperList = Array.from(new Set(rows.map((row) => String(row.sku || '').trim().toUpperCase()).filter(Boolean)));
    const manualBlockedByItemId = new Set<string>();
    const manualBlockedBySku = new Set<string>();

    const [manualByItemResp, manualBySkuResp] = await Promise.all([
      mlItemIds.length > 0
        ? client
            .from('ml_manual_blocklist')
            .select('ml_item_id')
            .eq('ativo', true)
            .in('ml_item_id', mlItemIds)
        : Promise.resolve({ data: [], error: null } as any),
      skuUpperList.length > 0
        ? client
            .from('ml_manual_blocklist')
            .select('sku')
            .eq('ativo', true)
            .in('sku', skuUpperList)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (manualByItemResp.error || manualBySkuResp.error) {
      const message = manualByItemResp.error?.message || manualBySkuResp.error?.message || 'Falha ao consultar bloqueio manual ML';
      return NextResponse.json({
        success: false,
        domain,
        records: { scanned: rows.length, enqueued: 0, updated_existing: 0, skipped_manual_block: 0, failed: 0 },
        errors: [{ code: 'ml_manual_blocklist_query_failed', message }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 500 });
    }

    for (const row of manualByItemResp.data || []) {
      const mlItemId = String((row as any).ml_item_id || '').trim();
      if (mlItemId) manualBlockedByItemId.add(mlItemId);
    }
    for (const row of manualBySkuResp.data || []) {
      const skuUpper = String((row as any).sku || '').trim().toUpperCase();
      if (skuUpper) manualBlockedBySku.add(skuUpper);
    }

    let enqueued = 0;
    let updatedExisting = 0;
    let skippedManualBlock = 0;
    let failed = 0;

    for (const row of rows) {
      const mlItemId = String(row.ml_item_id || '').trim();
      const sku = String(row.sku || '').trim();
      const skuUpper = sku.toUpperCase();
      const estoque = Number(row.estoque || 0);

      const isManualBlocked = manualBlockedByItemId.has(mlItemId) || (skuUpper ? manualBlockedBySku.has(skuUpper) : false);
      if (isManualBlocked) {
        skippedManualBlock += 1;
        continue;
      }

      if (dryRun) {
        enqueued += 1;
        continue;
      }

      const desiredStatus = resolveDesiredMlStatusByStock(estoque);
      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: String(row.id),
        mlItemId,
        desiredStatus,
        desiredQuantity: estoque,
        desiredPrice: null,
        source: 'dslite_stock_backfill',
        dedupePending: true,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: true,
          sku,
          estoque_origem: estoque,
          status_desejado: desiredStatus,
          origin: 'api/sync/anuncios/backfill-estoque-status',
          backfill: true,
        },
      });

      if (!outbox.ok) {
        failed += 1;
        errors.push({
          code: 'ml_outbox_enqueue_failed',
          message: outbox.error,
          context: { sku, mlItemId },
        });
      } else if (outbox.action === 'updated_existing') {
        updatedExisting += 1;
      } else {
        enqueued += 1;
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      domain,
      dry_run: dryRun,
      records: {
        scanned: rows.length,
        enqueued,
        updated_existing: updatedExisting,
        skipped_manual_block: skippedManualBlock,
        failed,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      records: { scanned: 0, enqueued: 0, updated_existing: 0, skipped_manual_block: 0, failed: 0 },
      errors: [{ code: 'ml_stock_backfill_unexpected_error', message: err?.message || 'Erro inesperado no backfill de estoque/status ML' }],
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
