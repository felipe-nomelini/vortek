import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';
import { setItemQuantityPricing, updateItemPrice } from '@/services/mercadolibre';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const produtoId = body?.produtoId as string | undefined;

    if (!produtoId) {
      return NextResponse.json({ error: 'produtoId é obrigatório' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: produto, error } = await supabase
      .from('produtos')
      .select('id, ml_item_id, ml_status, custom_price, custo, ml_fee, ml_shipping')
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

    let basePrice: number;
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

    basePrice = Math.round(basePrice * 100) / 100;

    const errors: string[] = [];

    const priceUpdated = await updateItemPrice(produto.ml_item_id, basePrice);
    if (!priceUpdated) {
      errors.push('Falha ao atualizar preço principal do anúncio');
    }

    const quantityPricingUpdated = await setItemQuantityPricing(produto.ml_item_id, basePrice);
    if (!quantityPricingUpdated) {
      errors.push('Falha ao atualizar preços de atacado');
    }

    return NextResponse.json({
      success: priceUpdated && quantityPricingUpdated,
      produtoId: produto.id,
      mlItemId: produto.ml_item_id,
      basePrice,
      price_updated: priceUpdated,
      quantity_pricing_updated: quantityPricingUpdated,
      errors,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro interno' }, { status: 500 });
  }
}
