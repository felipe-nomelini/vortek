import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { reconcileProdutoMlFinancials } from '@/lib/ml/reconcile-produto-financials';
import type { Database } from '@/types/database';

type ProdutoFinancialBackfillRow = Pick<
  Database['public']['Tables']['produtos']['Row'],
  'id' | 'sku' | 'nome' | 'ml_item_id' | 'ml_status' | 'ml_shipping' | 'ml_fee'
>;

function isAuthorizedRequest(request: Request): boolean {
  const apiKey = request.headers.get('x-api-key') || '';
  return Boolean(apiKey && apiKey === process.env.API_SECRET_KEY);
}

function round2(value: number | null | undefined): number | null {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const productIds = Array.isArray(body?.productIds)
    ? body.productIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const mlItemIds = Array.isArray(body?.mlItemIds)
    ? body.mlItemIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 100)));

  const serviceClient = createServiceClient();
  let query = serviceClient
    .from('produtos')
    .select('id,sku,nome,ml_item_id,ml_status,ml_shipping,ml_fee')
    .eq('ml_status', 'ativo')
    .not('ml_item_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (productIds.length > 0) {
    query = query.in('id', productIds);
  } else if (mlItemIds.length > 0) {
    query = query.in('ml_item_id', mlItemIds);
  } else {
    query = query.or('ml_shipping.eq.0,ml_fee.eq.0.15');
  }

  const { data: produtos, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Falha ao carregar produtos: ${error.message}` }, { status: 500 });
  }

  const rows = (produtos || []) as ProdutoFinancialBackfillRow[];
  const results: Array<Record<string, any>> = [];
  let updatedCount = 0;
  let unchangedCount = 0;
  let unavailableCount = 0;
  let errorCount = 0;

  for (const produto of rows) {
    const reconcile = await reconcileProdutoMlFinancials(serviceClient, {
      produtoId: produto.id,
      mlItemId: String(produto.ml_item_id || ''),
      source: 'financial_backfill',
    });

    if (!reconcile.ok) {
      errorCount += 1;
      results.push({
        produto_id: produto.id,
        sku: produto.sku,
        nome: produto.nome,
        ml_item_id: produto.ml_item_id,
        status: 'error',
        error: reconcile.error,
      });
      continue;
    }

    const feeUnavailable = reconcile.financials?.feeSourceStatus === 'unavailable';
    const shippingUnavailable = reconcile.financials?.shippingSourceStatus === 'unavailable';
    const hasUnavailableSource = feeUnavailable || shippingUnavailable;

    if (reconcile.updated) {
      updatedCount += 1;
    } else if (hasUnavailableSource) {
      unavailableCount += 1;
    } else {
      unchangedCount += 1;
    }

    results.push({
      produto_id: produto.id,
      sku: produto.sku,
      nome: produto.nome,
      ml_item_id: produto.ml_item_id,
      status: reconcile.updated
        ? 'updated'
        : hasUnavailableSource
          ? 'partial_unavailable'
          : 'unchanged',
      previous: {
        ml_fee: round2(produto.ml_fee),
        ml_shipping: round2(produto.ml_shipping),
      },
      current: {
        ml_fee: round2(reconcile.financials?.mlFee),
        ml_shipping: round2(reconcile.financials?.mlShipping),
      },
      fee_source_status: reconcile.financials?.feeSourceStatus || null,
      shipping_source_status: reconcile.financials?.shippingSourceStatus || null,
      found_produto: reconcile.found,
    });
  }

  return NextResponse.json({
    success: true,
    requested_filters: {
      productIds,
      mlItemIds,
      limit,
      automatic_default_scope: productIds.length === 0 && mlItemIds.length === 0,
    },
    analyzed_count: rows.length,
    updated_count: updatedCount,
    unchanged_count: unchangedCount,
    unavailable_count: unavailableCount,
    error_count: errorCount,
    results,
  });
}
