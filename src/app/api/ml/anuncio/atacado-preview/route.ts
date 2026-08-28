import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { serializeQuantityPricingTiers } from '@/lib/ml/quantity-pricing';
import { previewItemQuantityPricing } from '@/services/mercadolibre';

function normalizePrice(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
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
  const produtoId = String(body?.produtoId || '').trim();
  const requestedMlItemId = String(body?.mlItemId || '').trim().toUpperCase();
  const basePrice = normalizePrice(body?.basePrice);

  if (!produtoId || !requestedMlItemId || basePrice === null) {
    return NextResponse.json(
      { error: 'produtoId, mlItemId e basePrice válido são obrigatórios.' },
      { status: 422 },
    );
  }

  const service = createServiceClient();
  const { data: anuncio, error } = await service
    .from('anuncios_ml')
    .select('ml_item_id,produto_id,status')
    .eq('ml_item_id', requestedMlItemId)
    .eq('produto_id', produtoId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `Falha ao validar anúncio: ${error.message}` },
      { status: 500 },
    );
  }
  if (!anuncio) {
    return NextResponse.json(
      { error: 'O anúncio informado não pertence a este produto.' },
      { status: 422 },
    );
  }
  if (!['ativo', 'pausado'].includes(String(anuncio.status || ''))) {
    return NextResponse.json(
      { error: 'A prévia de atacado exige um anúncio ativo ou pausado.' },
      { status: 422 },
    );
  }

  const preview = await previewItemQuantityPricing(
    requestedMlItemId,
    basePrice,
  );
  if (!preview.ok) {
    return NextResponse.json(
      {
        success: false,
        error: preview.error,
        code: preview.code,
        provider_status: preview.httpStatus,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    mlItemId: requestedMlItemId,
    basePrice: preview.basePrice,
    currencyId: preview.currencyId,
    recommendationSource: preview.source,
    quantityPricing: serializeQuantityPricingTiers(preview.tiers),
  });
}
