import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

async function triggerImmediatePublish(req: Request, outboxId: string) {
  const apiKey = process.env.API_SECRET_KEY;
  if (!apiKey) {
    return { ok: false, error: 'API_SECRET_KEY ausente para disparar publicador ML' };
  }

  try {
    const origin = new URL(req.url).origin;
    const response = await fetch(`${origin}/api/sync/anuncios/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ outboxId, limit: 1, source: 'ml_anuncio_atualizar_preco_immediate' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload?.success !== false,
      status: response.status,
      payload,
      error: response.ok ? null : (payload?.error || payload?.errors?.[0]?.message || `HTTP ${response.status}`),
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Falha ao disparar publicador ML' };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const produtoId = body?.produtoId as string | undefined;
    const source = (body?.source as 'catalog_price_to_win' | 'default' | undefined) || 'default';
    const targetPriceRaw = body?.targetPrice;

    if (!produtoId) {
      return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 400 });
    }

    let targetPrice: number | null = null;
    if (targetPriceRaw !== undefined && targetPriceRaw !== null && String(targetPriceRaw).trim() !== '') {
      const parsed = Number(targetPriceRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'targetPrice inválido. Informe um número maior que zero.' }, { status: 422 });
      }
      targetPrice = Math.round(parsed * 100) / 100;
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase
      .from('produtos')
      .select('id, ml_item_id, ml_status, custom_price, custo, ml_fee, ml_shipping, estoque')
      .eq('id', produtoId)
      .single();

    if (error || !produto) {
      return NextResponse.json({ error: error?.message || 'Produto não encontrado' }, { status: 404 });
    }

    if (!produto.ml_item_id) {
      return NextResponse.json({ error: 'Produto sem anúncio no Mercado Livre' }, { status: 422 });
    }

    if (!['ativo', 'pausado'].includes(String(produto.ml_status || ''))) {
      return NextResponse.json({ error: 'A atualização de preço só é permitida para anúncio ativo ou pausado' }, { status: 422 });
    }

    let basePrice: number;
    if (targetPrice !== null) {
      basePrice = targetPrice;
    } else {
      if (typeof produto.custom_price === 'number' && Number.isFinite(produto.custom_price)) {
        basePrice = produto.custom_price;
      } else {
        const calc = calculateSuggestedPrice({
          cost: Number(produto.custo || 0),
          shipping: Number(produto.ml_shipping || 0),
          mlFee: Number(produto.ml_fee || 0.15),
        });
        basePrice = calc.suggestedPrice;
      }
    }

    basePrice = Math.round(basePrice * 100) / 100;

    const { error: persistError } = await supabase
      .from('produtos')
      .update({ custom_price: basePrice } as any)
      .eq('id', produto.id);

    if (persistError) {
      return NextResponse.json({ error: `Falha ao salvar preço desejado local: ${persistError.message}` }, { status: 500 });
    }

    const outbox = await enqueueMlPublishOutbox(supabase, {
      produtoId: String(produto.id),
      mlItemId: String(produto.ml_item_id),
      desiredStatus: (produto.ml_status || null) as any,
      desiredPrice: basePrice,
      desiredQuantity: typeof produto.estoque === 'number' ? produto.estoque : null,
      source: 'ml_anuncio_atualizar_preco',
      payload: {
        source,
        target_price_received: targetPrice,
        apply_status: false,
        apply_price: true,
        apply_quantity: false,
        apply_quantity_pricing: true,
        update_quantity_pricing: true,
      },
    });

    const errors: string[] = [];
    if (!outbox.ok) {
      errors.push(`Falha ao enfileirar publicação no ML: ${outbox.error}`);
    }

    const immediatePublish = outbox.ok
      ? await triggerImmediatePublish(req, outbox.outboxId)
      : { ok: false, error: 'outbox não criado' };

    console.log(JSON.stringify({
      event: 'ml_anuncio_atualizar_preco',
      timestamp_utc: new Date().toISOString(),
      produto_id: produto.id,
      ml_item_id: produto.ml_item_id,
      source,
      target_price_received: targetPrice,
      base_price: basePrice,
      queued_publish: outbox.ok,
      immediate_publish: immediatePublish.ok,
      quantity_pricing_queued: outbox.ok,
      outbox_id: outbox.ok ? outbox.outboxId : null,
      success: outbox.ok,
    }));

    return NextResponse.json({
      success: outbox.ok,
      produtoId: produto.id,
      mlItemId: produto.ml_item_id,
      basePrice,
      source,
      target_price_received: targetPrice,
      queued_publish: outbox.ok,
      immediate_publish: immediatePublish,
      quantity_pricing_queued: outbox.ok,
      outboxId: outbox.ok ? outbox.outboxId : null,
      price_updated: false,
      quantity_pricing_updated: false,
      message: outbox.ok
        ? 'Preço desejado salvo e publicação (preço + atacado) enfileirada para o sync de anúncios'
        : 'Preço desejado salvo, mas falhou ao enfileirar publicação',
      errors,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro interno' }, { status: 500 });
  }
}
