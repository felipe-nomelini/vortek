import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { reconcileProdutoMlFinancials } from '@/lib/ml/reconcile-produto-financials';

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

    if (produto.ml_status !== 'ativo') {
      return NextResponse.json({ error: 'A atualização de preço só é permitida para anúncio ativo' }, { status: 422 });
    }

    const produtoFinancials = produto.ml_item_id
      ? await reconcileProdutoMlFinancials(supabase, {
          produtoId: produto.id,
          mlItemId: String(produto.ml_item_id),
          source: 'price_update',
        })
      : null;

    const reconciledFinancials = produtoFinancials?.ok && produtoFinancials.found
      ? produtoFinancials.financials
      : null;
    const effectiveMlFee = reconciledFinancials?.mlFee !== null && reconciledFinancials?.mlFee !== undefined
      ? reconciledFinancials.mlFee
      : Number(produto.ml_fee || 0.15);
    const effectiveMlShipping = reconciledFinancials?.mlShipping !== null && reconciledFinancials?.mlShipping !== undefined
      ? reconciledFinancials.mlShipping
      : Number(produto.ml_shipping || 0);

    let basePrice: number;
    if (targetPrice !== null) {
      basePrice = targetPrice;
    } else {
      if (typeof produto.custom_price === 'number' && Number.isFinite(produto.custom_price)) {
        basePrice = produto.custom_price;
      } else {
        const calc = calculateSuggestedPrice({
          cost: Number(produto.custo || 0),
          shipping: effectiveMlShipping,
          mlFee: effectiveMlFee,
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
        update_quantity_pricing: true,
      },
    });

    const errors: string[] = [];
    if (!outbox.ok) {
      errors.push(`Falha ao enfileirar publicação no ML: ${outbox.error}`);
    }

    console.log(JSON.stringify({
      event: 'ml_anuncio_atualizar_preco',
      timestamp_utc: new Date().toISOString(),
      produto_id: produto.id,
      ml_item_id: produto.ml_item_id,
      source,
      target_price_received: targetPrice,
      base_price: basePrice,
      queued_publish: outbox.ok,
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
