import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

const SUPABASE_IN_FILTER_CHUNK_SIZE = 500;

type ListingStatus = 'ativo' | 'pausado';

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetStatus = String(body?.targetStatus || '').trim() as ListingStatus;
  const produtoIds: string[] = Array.isArray(body?.produtoIds)
    ? body.produtoIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];

  if (!['ativo', 'pausado'].includes(targetStatus)) {
    return NextResponse.json({ error: 'targetStatus inválido. Use ativo ou pausado.' }, { status: 422 });
  }

  if (produtoIds.length === 0) {
    return NextResponse.json({ error: 'Nenhum produto selecionado para alteração em massa.' }, { status: 422 });
  }

  const serviceClient = createServiceClient();
  const products: any[] = [];

  for (const idsChunk of chunk(produtoIds, SUPABASE_IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await serviceClient
      .from('produtos')
      .select('id, sku, ml_item_id, custom_price, estoque, ml_status')
      .in('id', idsChunk);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    products.push(...(data || []));
  }

  const records = products.filter((product) => String(product?.id || '').trim());
  const actionable = records.filter((product) => String(product?.ml_status || '').trim() !== targetStatus);
  const alreadyInTarget = records.length - actionable.length;

  let enqueued = 0;
  let updatedExisting = 0;
  let reopenedFailed = 0;
  let skippedNoItem = 0;
  let failed = 0;
  const outboxIds: string[] = [];
  const errors: Array<{ produtoId: string; sku: string; mlItemId: string | null; error: string }> = [];

  for (const product of actionable) {
    const produtoId = String(product.id || '').trim();
    const sku = String(product.sku || '').trim();
    const mlItemId = String(product.ml_item_id || '').trim();

    if (!mlItemId) {
      skippedNoItem += 1;
      continue;
    }

    const outbox = await enqueueMlPublishOutbox(serviceClient, {
      produtoId,
      mlItemId,
      desiredStatus: targetStatus,
      desiredPrice: typeof product.custom_price === 'number' ? product.custom_price : null,
      desiredQuantity: typeof product.estoque === 'number' ? product.estoque : null,
      source: 'anuncios_batch_status',
      dedupePending: true,
      payload: {
        apply_price: false,
        apply_quantity_pricing: false,
        apply_quantity: false,
        apply_status: true,
        origin: 'api/anuncios/status-lote',
        sku,
        target_status: targetStatus,
      },
    });

    if (!outbox.ok) {
      failed += 1;
      errors.push({ produtoId, sku, mlItemId: mlItemId || null, error: outbox.error });
      continue;
    }

    outboxIds.push(outbox.outboxId);
    if (outbox.action === 'updated_existing') {
      updatedExisting += 1;
    } else if (outbox.action === 'reopened_failed') {
      reopenedFailed += 1;
    } else {
      enqueued += 1;
    }
  }

  return NextResponse.json({
    success: failed === 0,
    targetStatus,
    queued_publish: outboxIds.length > 0,
    outboxIds,
    records: {
      selected: produtoIds.length,
      found: records.length,
      actionable: actionable.length,
      already_in_target: alreadyInTarget,
      enqueued,
      updated_existing: updatedExisting,
      reopened_failed: reopenedFailed,
      skipped_no_item: skippedNoItem,
      failed,
    },
    errors,
  }, { status: failed === 0 ? 200 : 207 });
}
