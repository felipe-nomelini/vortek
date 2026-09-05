import { NextResponse } from 'next/server';
import { loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';
import { loadProductFulfillmentCapacities } from '@/lib/orders/fulfillment-capacity-loader';
import { syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { createServiceClient } from '@/lib/supabase';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { loadCommercialPricingConfiguration } from '@/services/commercial-pricing-configuration';

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
  const [commercial, operationalSupplierIds] = await Promise.all([
    loadCommercialPricingConfiguration(client),
    loadOperationalDropshippingSupplierIds(client),
  ]);
  const threshold = commercial.inactiveCostThreshold;
  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];

  const { data: candidates, error: selectError } = await client
    .from('produto_fornecedor_ofertas')
    .select('id,produto_id,dslite_fornecedor_id,custo,ativo')
    .gt('custo', threshold)
    .neq('ativo', false)
    .order('custo', { ascending: false })
    .limit(limit);

  if (selectError) {
    return NextResponse.json({
      success: false,
      errors: [{ code: 'cost_threshold_offer_select_failed', message: selectError.message }],
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  }

  const rows = Array.isArray(candidates) ? candidates : [];
  const offerIds = rows.map((row: any) => String(row.id || '').trim()).filter(Boolean);
  const productIds = Array.from(new Set(
    rows.map((row: any) => String(row.produto_id || '').trim()).filter(Boolean),
  ));
  let offersInactivated = 0;
  let productsWithoutEligibleOffer = 0;
  let productsReconciled = 0;
  let mlOutboxEnqueued = 0;
  let mlOutboxUpdatedExisting = 0;
  let mlOutboxUnchanged = 0;
  let mlOutboxSkippedIneligible = 0;
  let mlOutboxSkippedNoItem = 0;
  let mlOutboxFailed = 0;
  let mlPauseEnqueued = 0;
  let mlPauseUnchanged = 0;
  let mlPauseSkippedIneligible = 0;
  let mlPauseSkippedNoItem = 0;

  if (!dryRun && offerIds.length > 0) {
    for (const offerIdChunk of chunk(offerIds, 100)) {
      const { error: updateError } = await client
        .from('produto_fornecedor_ofertas')
        .update({ ativo: false } as any)
        .in('id', offerIdChunk);

      if (updateError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_offer_update_failed', message: updateError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
      offersInactivated += offerIdChunk.length;
    }

    const productsWithEligibleOffer = new Set<string>();
    for (const productIdChunk of chunk(productIds, 100)) {
      const { data: eligibleOffers, error: eligibleError } = await client
        .from('produto_fornecedor_ofertas')
        .select('produto_id,dslite_fornecedor_id')
        .in('produto_id', productIdChunk)
        .eq('ativo', true)
        .gt('custo', 0)
        .lte('custo', threshold);

      if (eligibleError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_eligible_offer_select_failed', message: eligibleError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }

      for (const offer of eligibleOffers || []) {
        const supplierId = String((offer as any).dslite_fornecedor_id || '').trim();
        if (operationalSupplierIds.has(supplierId)) {
          productsWithEligibleOffer.add(String((offer as any).produto_id || '').trim());
        }
      }
    }

    const eligibleProductIds = productIds.filter((productId) => productsWithEligibleOffer.has(productId));
    const unavailableProductIds = productIds.filter((productId) => !productsWithEligibleOffer.has(productId));
    productsWithoutEligibleOffer = unavailableProductIds.length;

    try {
      await syncPreferredProductSnapshot(client, eligibleProductIds);
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        errors: [{
          code: 'cost_threshold_preferred_snapshot_failed',
          message: error?.message || 'Falha ao recalcular oferta preferencial',
        }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 500 });
    }

    for (const productIdChunk of chunk(unavailableProductIds, 100)) {
      const { error: zeroStockError } = await client
        .from('produtos')
        .update({ estoque: 0 } as any)
        .in('id', productIdChunk);
      if (zeroStockError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_product_snapshot_failed', message: zeroStockError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
    }

    const products: any[] = [];
    for (const productIdChunk of chunk(productIds, 100)) {
      const { data, error: productError } = await client
        .from('produtos')
        .select('id,sku,ml_item_id,ml_status')
        .in('id', productIdChunk);
      if (productError) {
        return NextResponse.json({
          success: false,
          errors: [{ code: 'cost_threshold_product_select_failed', message: productError.message }],
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
      products.push(...(data || []));
    }

    const capacitiesByProduct = await loadProductFulfillmentCapacities(client, productIds);
    productsReconciled = products.length;

    for (const product of products) {
      const productId = String(product.id || '').trim();
      const mlItemId = String(product.ml_item_id || '').trim();
      const capacity = capacitiesByProduct.get(productId) || { internal: 0, supplier: 0, safe: 0 };
      const shouldPause = capacity.safe <= 0;
      if (!mlItemId || String(product.ml_status || '').trim().toLowerCase() === 'sem_anuncio') {
        mlOutboxSkippedNoItem += 1;
        if (shouldPause) mlPauseSkippedNoItem += 1;
        continue;
      }

      const outbox = await enqueueMlPublishOutbox(client, {
        produtoId: productId,
        mlItemId,
        desiredStatus: shouldPause ? 'pausado' : undefined,
        desiredQuantity: capacity.safe,
        desiredPrice: null,
        source: 'supplier_offer_cost_threshold_unavailable',
        dedupePending: true,
        payload: {
          apply_price: false,
          apply_quantity_pricing: false,
          apply_quantity: true,
          apply_status: shouldPause,
          sku: product.sku,
          estoque_origem: capacity.safe,
          estoque_fornecedor: capacity.supplier,
          estoque_interno: capacity.internal,
          threshold,
          origin: 'api/produtos/inativar-custo-alto',
        },
      });

      if (!outbox.ok) {
        mlOutboxFailed += 1;
        errors.push({
          code: 'cost_threshold_ml_outbox_failed',
          message: outbox.error,
          context: { productId, sku: product.sku, mlItemId },
        });
      } else if (outbox.action === 'unchanged') {
        mlOutboxUnchanged += 1;
        if (shouldPause) mlPauseUnchanged += 1;
      } else if (outbox.action === 'skipped_ineligible') {
        mlOutboxSkippedIneligible += 1;
        if (shouldPause) mlPauseSkippedIneligible += 1;
      } else if (outbox.action === 'updated_existing' || outbox.action === 'reopened_failed') {
        mlOutboxUpdatedExisting += 1;
        if (shouldPause) mlPauseEnqueued += 1;
      } else {
        mlOutboxEnqueued += 1;
        if (shouldPause) mlPauseEnqueued += 1;
      }
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    dryRun,
    threshold,
    records: {
      candidates: rows.length,
      inactivated: 0,
      already_inactive: 0,
      offers_inactivated: offersInactivated,
      products_without_eligible_offer: productsWithoutEligibleOffer,
      products_reconciled: productsReconciled,
      ml_outbox_enqueued: mlOutboxEnqueued,
      ml_outbox_updated_existing: mlOutboxUpdatedExisting,
      ml_outbox_unchanged: mlOutboxUnchanged,
      ml_outbox_skipped_ineligible: mlOutboxSkippedIneligible,
      ml_outbox_skipped_no_item: mlOutboxSkippedNoItem,
      ml_outbox_failed: mlOutboxFailed,
      ml_pause_enqueued: mlPauseEnqueued,
      ml_pause_unchanged: mlPauseUnchanged,
      ml_pause_skipped_ineligible: mlPauseSkippedIneligible,
      ml_pause_skipped_no_item: mlPauseSkippedNoItem,
      errors: errors.length,
    },
    errors,
    duration: { ms: Date.now() - startedAt },
  }, { status: errors.length === 0 ? 200 : 207 });
}
