import { NextResponse } from 'next/server';
import { getProductListResponse } from '@/services/product-list';
import { getPricingExecutionBlock } from '@/lib/ml/pricing-execution';
import { createClient, createServiceClient } from '@/lib/supabase';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { assertVortekSku } from '@/lib/product-master-sku';
import { loadProductFulfillmentCapacity } from '@/lib/orders/fulfillment-capacity-loader';

export async function GET(request: Request) {
  return getProductListResponse(request);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const body = await request.json();
  if (body.custom_price != null || body.customPrice != null) {
    const executionBlock = getPricingExecutionBlock();
    if (executionBlock) return NextResponse.json(executionBlock, { status: 409 });
  }
  let payload = { ...body } as Record<string, any>;
  if ('sku' in payload) {
    try {
      payload.sku = assertVortekSku(payload.sku);
    } catch (error: any) {
      return NextResponse.json({ erro: error?.message || 'SKU mestre inválido' }, { status: 422 });
    }
  } else {
    delete payload.sku;
  }
  if ('dslite_fornecedor_id' in payload) payload.dslite_fornecedor_id = String(payload.dslite_fornecedor_id || '').trim();
  if ('dslite_produto_id' in payload) payload.dslite_produto_id = String(payload.dslite_produto_id || '').trim();

  const { data, error } = await serviceClient.from('produtos').insert(payload).select().single();

  if (error) {
    const msg = error.message || '';
    const details = String((error as any).details || '');
    if (
      msg.includes('produtos_sku_upper_unique') ||
      msg.includes('produtos_sku_key') ||
      details.includes('produtos_sku_upper_unique') ||
      details.includes('produtos_sku_key')
    ) {
      return NextResponse.json({ erro: 'SKU já cadastrado' }, { status: 409 });
    }
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
  let warning: string | null = null;
  if (String((data as any)?.ml_item_id || '').trim()) {
    const capacity = await loadProductFulfillmentCapacity(
      serviceClient,
      String((data as any).id),
    );
    const outbox = await enqueueMlPublishOutbox(createServiceClient(), {
      produtoId: String((data as any).id),
      mlItemId: String((data as any).ml_item_id),
      desiredStatus: ((data as any).ml_status || null) as any,
      desiredPrice: typeof (data as any).custom_price === 'number' ? (data as any).custom_price : null,
      desiredQuantity: capacity.safe,
      source: 'produto_create',
      dedupePending: true,
      payload: {
        apply_price: typeof (data as any).custom_price === 'number',
        apply_quantity_pricing: false,
        apply_quantity: true,
        apply_status: Boolean((data as any).ml_status),
        origin: 'api/produtos POST',
        estoque_fornecedor: capacity.supplier,
        estoque_interno: capacity.internal,
        estoque_disponivel: capacity.safe,
      },
    });
    if (!outbox.ok) {
      warning = outbox.error;
    } else if (outbox.action === 'skipped_ineligible') {
      warning = `publicação ML não enfileirada: ${outbox.reason}`;
    }
  }

  return NextResponse.json(
    warning ? { data, warning: `Produto criado, mas falhou ao enfileirar publicação ML: ${warning}` } : data,
    { status: 201 },
  );
}
