import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

function normalizePrice(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const produtoId = String(body?.produtoId || '').trim() || null;
    const mlItemIdInput = String(body?.mlItemId || '').trim() || null;
    const source = String(body?.source || 'manual_quantity_pricing').trim();
    const basePrice = normalizePrice(body?.basePrice);

    if (!basePrice) {
      return NextResponse.json({ error: 'basePrice inválido. Informe um número maior que zero.' }, { status: 422 });
    }

    if (!produtoId && !mlItemIdInput) {
      return NextResponse.json({ error: 'Informe produtoId ou mlItemId.' }, { status: 422 });
    }

    const service = createServiceClient();

    let produto: any = null;
    if (produtoId) {
      const { data, error } = await service
        .from('produtos')
        .select('id,ml_item_id,ml_status,estoque')
        .eq('id', produtoId)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: `Falha ao buscar produto: ${error.message}` }, { status: 500 });
      }
      produto = data;
    } else if (mlItemIdInput) {
      const { data, error } = await service
        .from('produtos')
        .select('id,ml_item_id,ml_status,estoque')
        .eq('ml_item_id', mlItemIdInput)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: `Falha ao buscar produto por anúncio: ${error.message}` }, { status: 500 });
      }
      produto = data;
    }

    const mlItemId = String(produto?.ml_item_id || mlItemIdInput || '').trim();
    if (!mlItemId) {
      return NextResponse.json({ error: 'Anúncio ML não identificado para aplicar atacado.' }, { status: 422 });
    }

    if (produto && produto.ml_status !== 'ativo') {
      return NextResponse.json({ error: 'A aplicação de atacado só é permitida para anúncio ativo.' }, { status: 422 });
    }

    if (!produto) {
      return NextResponse.json({
        error: 'Não foi possível localizar produto local vinculado a este anúncio para enfileirar aplicação de atacado.',
      }, { status: 422 });
    }

    const outbox = await enqueueMlPublishOutbox(service, {
      produtoId: String(produto.id),
      mlItemId,
      desiredStatus: null,
      desiredPrice: null,
      desiredQuantity: null,
      source: 'ml_anuncio_aplicar_atacado',
      payload: {
        source,
        apply_price: false,
        apply_quantity_pricing: true,
        apply_quantity: false,
        apply_status: false,
        base_price_for_quantity_pricing: basePrice,
      },
    });

    if (!outbox.ok) {
      return NextResponse.json({
        success: false,
        queued_publish: false,
        quantity_pricing_queued: false,
        error: outbox.error,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      queued_publish: true,
      quantity_pricing_queued: true,
      outboxId: outbox.outboxId,
      mlItemId,
      basePrice,
      message: 'Aplicação de atacado enfileirada para processamento no ML.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro interno' }, { status: 500 });
  }
}
