import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { PRODUCT_COST_INACTIVE_THRESHOLD } from '@/lib/product-activity';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

function parsePositiveInt(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

export async function POST(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const startedAt = Date.now();
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(1000, parsePositiveInt(body?.limit, 1000));
  const dryRun = body?.dryRun === true;
  const client = createServiceClient();
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];

  const { data: candidates, error: selectError } = await client
    .from('produtos')
    .select('id,sku,custo,ativo,ml_item_id,estoque,ml_status')
    .gt('custo', PRODUCT_COST_INACTIVE_THRESHOLD)
    .neq('ativo', false)
    .order('custo', { ascending: false })
    .limit(limit);

  if (selectError) {
    return NextResponse.json({
      success: false,
      errors: [{ code: 'cost_threshold_select_failed', message: selectError.message }],
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  }

  const rows = Array.isArray(candidates) ? candidates : [];
  const ids = rows.map((row: any) => String(row.id)).filter(Boolean);
  let inactivated = 0;
  let mlPauseEnqueued = 0;
  let mlPauseSkippedNoItem = 0;

  if (!dryRun && ids.length > 0) {
    for (const idChunk of chunk(ids, 100)) {
      const { error: updateError } = await client
        .from('produtos')
        .update({ ativo: false } as any)
        .in('id', idChunk);

      if (updateError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_update_failed', message: updateError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
      inactivated += idChunk.length;
    }

    for (const row of rows as any[]) {
      const mlItemId = String(row.ml_item_id || '').trim();
      if (!mlItemId) {
        mlPauseSkippedNoItem += 1;
        continue;
      }

      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: String(row.id),
        mlItemId,
        desiredStatus: 'pausado',
        desiredQuantity: 0,
        desiredPrice: null,
        source: 'produto_cost_threshold_inactive',
        dedupePending: true,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: true,
          sku: row.sku,
          previous_status: row.ml_status,
          previous_stock: row.estoque,
          previous_cost: row.custo,
          threshold: PRODUCT_COST_INACTIVE_THRESHOLD,
          origin: 'api/produtos/inativar-custo-alto',
        },
      });

      if (!outbox.ok) {
        errors.push({
          code: 'cost_threshold_ml_outbox_failed',
          message: outbox.error,
          context: { produtoId: row.id, sku: row.sku, mlItemId },
        });
      } else {
        mlPauseEnqueued += 1;
      }
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    dryRun,
    threshold: PRODUCT_COST_INACTIVE_THRESHOLD,
    records: {
      candidates: rows.length,
      inactivated,
      already_inactive: 0,
      ml_pause_enqueued: mlPauseEnqueued,
      ml_pause_skipped_no_item: mlPauseSkippedNoItem,
      errors: errors.length,
    },
    errors,
    duration: { ms: Date.now() - startedAt },
  }, { status: errors.length === 0 ? 200 : 207 });
}
