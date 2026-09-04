import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { PRODUCT_COST_INACTIVE_THRESHOLD } from '@/lib/product-activity';
import { obterSaldoEstoqueInternoProduto } from '@/lib/estoque-interno';
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
    .from('produto_fornecedor_ofertas')
    .select('id,produto_id,dslite_fornecedor_id,custo,ativo')
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
  const offerIds = rows.map((row: any) => String(row.id)).filter(Boolean);
  const productIds = Array.from(new Set(rows.map((row: any) => String(row.produto_id || '').trim()).filter(Boolean)));
  let offersInactivated = 0;
  let productsUnavailable = 0;
  let mlPauseEnqueued = 0;
  let mlPauseSkippedNoItem = 0;

  if (!dryRun && offerIds.length > 0) {
    for (const idChunk of chunk(offerIds, 100)) {
      const { error: updateError } = await client
        .from('produto_fornecedor_ofertas')
        .update({ ativo: false } as any)
        .in('id', idChunk);

      if (updateError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_offer_update_failed', message: updateError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
      offersInactivated += idChunk.length;
    }

    const { data: activeSuppliers, error: supplierError } = await client
      .from('fornecedores')
      .select('dslite_id')
      .eq('ativo', true)
      .not('dslite_id', 'is', null);
    if (supplierError) {
      return NextResponse.json({
        success: false,
        errors: [{ code: 'cost_threshold_supplier_select_failed', message: supplierError.message }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 500 });
    }
    const activeSupplierIds = new Set((activeSuppliers || []).map((row: any) => String(row.dslite_id || '').trim()));

    const productsWithEligibleOffer = new Set<string>();
    for (const productIdChunk of chunk(productIds, 100)) {
      const { data: eligibleOffers, error: eligibleError } = await client
        .from('produto_fornecedor_ofertas')
        .select('produto_id,dslite_fornecedor_id')
        .in('produto_id', productIdChunk)
        .eq('ativo', true)
        .gt('custo', 0)
        .lte('custo', PRODUCT_COST_INACTIVE_THRESHOLD);
      if (eligibleError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_eligible_offer_select_failed', message: eligibleError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
      for (const offer of eligibleOffers || []) {
        if (activeSupplierIds.has(String((offer as any).dslite_fornecedor_id || '').trim())) {
          productsWithEligibleOffer.add(String((offer as any).produto_id || '').trim());
        }
      }
    }

    const unavailableProductIds = productIds.filter((productId) => !productsWithEligibleOffer.has(productId));
    productsUnavailable = unavailableProductIds.length;
    const productsById = new Map<string, any>();
    for (const productIdChunk of chunk(unavailableProductIds, 100)) {
      const { data: products, error: productError } = await client
        .from('produtos')
        .update({ estoque: 0 } as any)
        .in('id', productIdChunk)
        .select('id,sku,ml_item_id,ml_status');
      if (productError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_product_snapshot_failed', message: productError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
      for (const product of products || []) productsById.set(String((product as any).id), product);
    }

    for (const productId of unavailableProductIds) {
      const internalStock = await obterSaldoEstoqueInternoProduto(productId);
      if (internalStock > 0) continue;

      const product = productsById.get(productId);
      const { error: pauseLocalError } = await client
        .from('produtos')
        .update({ ml_status: 'pausado' } as any)
        .eq('id', productId);
      if (pauseLocalError) {
        errors.push({
          code: 'cost_threshold_product_pause_failed',
          message: pauseLocalError.message,
          context: { productId },
        });
        continue;
      }

      const mlItemId = String(product?.ml_item_id || '').trim();
      if (!mlItemId) {
        mlPauseSkippedNoItem += 1;
        continue;
      }

      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: productId,
        mlItemId,
        desiredStatus: 'pausado',
        desiredQuantity: 0,
        desiredPrice: null,
        source: 'supplier_offer_cost_threshold_unavailable',
        dedupePending: true,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: true,
          sku: product?.sku,
          previous_status: product?.ml_status,
          threshold: PRODUCT_COST_INACTIVE_THRESHOLD,
          origin: 'api/produtos/inativar-custo-alto',
        },
      });
      if (!outbox.ok) {
        errors.push({
          code: 'cost_threshold_ml_outbox_failed',
          message: outbox.error,
          context: { productId, sku: product?.sku, mlItemId },
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
      inactivated: 0,
      offers_inactivated: offersInactivated,
      products_unavailable: productsUnavailable,
      ml_pause_enqueued: mlPauseEnqueued,
      ml_pause_skipped_no_item: mlPauseSkippedNoItem,
      errors: errors.length,
    },
    errors,
    duration: { ms: Date.now() - startedAt },
  }, { status: errors.length === 0 ? 200 : 207 });
}
