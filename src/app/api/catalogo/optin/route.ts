import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';

function isEligibilityAllowed(status: string): boolean {
  const normalized = String(status || '').toUpperCase();
  return normalized === 'READY_FOR_OPTIN' || normalized === 'ALREADY_OPTED_IN';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const itemId = String(body?.itemId || '').trim();
    const catalogProductId = String(body?.catalogProductId || '').trim();
    const variationId = body?.variationId;

    if (!itemId || !catalogProductId) {
      return NextResponse.json({ erro: 'itemId e catalogProductId são obrigatórios' }, { status: 422 });
    }

    const eligibilityResult = await fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}/catalog_listing_eligibility`);
    if (!eligibilityResult.ok || !eligibilityResult.data) {
      return NextResponse.json({ erro: eligibilityResult.error?.message || 'Falha ao validar elegibilidade', auth_fatal: eligibilityResult.error?.category === 'auth_fatal' }, { status: eligibilityResult.status || 500 });
    }

    const status = String(eligibilityResult.data.status || '').toUpperCase();
    const buyBoxEligible = Boolean(eligibilityResult.data.buy_box_eligible);

    if (!isEligibilityAllowed(status) || !buyBoxEligible) {
      return NextResponse.json({ erro: 'Item não está elegível para opt-in de catálogo', eligibility_status: status, buy_box_eligible: buyBoxEligible, reason: eligibilityResult.data.reason || null }, { status: 422 });
    }

    const payload: Record<string, any> = {
      item_id: itemId,
      catalog_product_id: catalogProductId,
    };
    if (variationId !== undefined && variationId !== null && String(variationId) !== '') {
      payload.variation_id = Number(variationId);
    }

    const optinResult = await fetchMLResult<any>('/items/catalog_listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!optinResult.ok || !optinResult.data) {
      console.error(JSON.stringify({ event: 'catalog_optin_failed', item_id: itemId, catalog_product_id: catalogProductId, status: optinResult.status, error: optinResult.error?.message || null, timestamp_utc: new Date().toISOString() }));
      return NextResponse.json({ erro: optinResult.error?.message || 'Falha ao criar anúncio de catálogo', details: optinResult.error || null }, { status: optinResult.status || 500 });
    }

    const itemRefresh = await fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}`);
    const service = createServiceClient();
    if (itemRefresh.ok && itemRefresh.data) {
      const item = itemRefresh.data;
      await service
        .from('anuncios_ml')
        .upsert({
          ml_item_id: item.id,
          sku: item.seller_custom_field || null,
          titulo: item.title,
          preco_ml: item.price,
          vendidos: item.sold_quantity || 0,
          status: item.status,
          thumbnail: item.thumbnail,
          permalink: item.permalink,
          catalogo: item.catalog_listing === true,
        }, { onConflict: 'ml_item_id' });
    }

    console.log(JSON.stringify({ event: 'catalog_optin_success', item_id: itemId, catalog_product_id: catalogProductId, result_id: optinResult.data?.id || null, timestamp_utc: new Date().toISOString() }));

    return NextResponse.json({ success: true, data: optinResult.data, refreshed: itemRefresh.ok });
  } catch (error: any) {
    return NextResponse.json({ erro: error?.message || 'Erro inesperado' }, { status: 500 });
  }
}
