import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { buildCatalogEnrichment } from '@/lib/catalogo/no-catalogo';

function isEligibilityAllowed(status: string): boolean {
  const normalized = String(status || '').toUpperCase();
  return normalized === 'READY_FOR_OPTIN';
}

function getSellerSkuFromItem(item: any): string | null {
  const direct = String(item?.seller_custom_field || item?.seller_sku || '').trim();
  if (direct) return direct;
  const attr = Array.isArray(item?.attributes)
    ? item.attributes.find((row: any) => String(row?.id || '').toUpperCase() === 'SELLER_SKU')
    : null;
  const attrValue = String(attr?.value_name || attr?.value_id || '').trim();
  return attrValue || null;
}

function mapMlStatusToLocalStatus(value: unknown): 'ativo' | 'pausado' | 'sem_anuncio' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'active') return 'ativo';
  if (raw === 'paused') return 'pausado';
  return 'sem_anuncio';
}

async function getRelatedPermalink(relatedItemId: string | null): Promise<string | null> {
  if (!relatedItemId) return null;
  const relatedResult = await fetchMLResult<any>(`/items/${encodeURIComponent(relatedItemId)}`);
  return relatedResult.ok && relatedResult.data ? (relatedResult.data.permalink || null) : null;
}

async function syncCatalogOptinLocally(params: {
  service: ReturnType<typeof createServiceClient>;
  originalItemId: string;
  catalogItem: any;
  sellerId: number | null;
}) {
  const { service, originalItemId, catalogItem, sellerId } = params;
  const warnings: string[] = [];
  const catalogItemId = String(catalogItem?.id || '').trim();
  if (!catalogItemId) {
    return { ok: false, warnings: ['Anúncio de catálogo sem ID para sincronizar localmente.'], produtoId: null, sku: null };
  }

  const { data: originalAnuncio, error: originalError } = await service
    .from('anuncios_ml')
    .select('produto_id,sku')
    .eq('ml_item_id', originalItemId)
    .maybeSingle();
  if (originalError) warnings.push(`Falha ao buscar anúncio original: ${originalError.message}`);

  const sku = String(originalAnuncio?.sku || '').trim() || getSellerSkuFromItem(catalogItem) || null;
  const produtoId = String(originalAnuncio?.produto_id || '').trim() || null;
  const statusLocal = mapMlStatusToLocalStatus(catalogItem.status);

  const { error: anuncioError } = await service
    .from('anuncios_ml')
    .upsert({
      ml_item_id: catalogItemId,
      sku: sku || '',
      produto_id: produtoId,
      titulo: catalogItem.title || '',
      preco_ml: Number(catalogItem.price || 0),
      vendidos: Number(catalogItem.sold_quantity || 0),
      status: statusLocal,
      thumbnail: catalogItem.thumbnail || null,
      permalink: catalogItem.permalink || null,
      catalogo: catalogItem.catalog_listing === true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'ml_item_id' });
  if (anuncioError) warnings.push(`Falha ao salvar anúncio de catálogo: ${anuncioError.message}`);

  if (produtoId) {
    const { error: productError } = await service
      .from('produtos')
      .update({
        ml_item_id: catalogItemId,
        ml_status: statusLocal,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', produtoId);
    if (productError) warnings.push(`Falha ao atualizar produto principal: ${productError.message}`);
  } else {
    warnings.push('Produto local não encontrado para vincular o anúncio de catálogo.');
  }

  const priceToWinResult = await fetchMLResult<any>(`/items/${encodeURIComponent(catalogItemId)}/price_to_win?version=v2`);
  const baseRelatedId = buildCatalogEnrichment({
    item: catalogItem,
    priceToWinPayload: null,
    relatedPermalink: null,
  }).relatedItemId;
  const relatedPermalink = await getRelatedPermalink(baseRelatedId);
  const enrichment = buildCatalogEnrichment({
    item: catalogItem,
    priceToWinPayload: priceToWinResult.ok ? priceToWinResult.data : null,
    relatedPermalink,
  });

  const { error: snapshotError } = await service
    .from('catalogo_ml_snapshot')
    .upsert({
      ml_item_id: catalogItemId,
      seller_id: Number(catalogItem.seller_id || sellerId || 0),
      catalog_listing: catalogItem.catalog_listing === true,
      title: catalogItem.title || null,
      status: catalogItem.status || null,
      price: Number(catalogItem.price || 0),
      price_to_win: enrichment.priceToWin,
      buy_box_status: enrichment.buyBoxStatus,
      buy_box_winning: enrichment.buyBoxWinning,
      permalink: catalogItem.permalink || null,
      thumbnail: catalogItem.thumbnail || null,
      seller_sku: sku,
      catalog_product_id: catalogItem.catalog_product_id || null,
      category_id: catalogItem.category_id || null,
      domain_id: catalogItem.domain_id || null,
      related_item_id: enrichment.relatedItemId,
      related_permalink: enrichment.relatedPermalink,
      produto_id: produtoId,
      sku_local: sku,
      last_updated_ml: catalogItem.last_updated || null,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'ml_item_id' });
  if (snapshotError) warnings.push(`Falha ao salvar snapshot de catálogo: ${snapshotError.message}`);

  return { ok: warnings.length === 0, warnings, produtoId, sku };
}

async function validateCatalogProductActive(catalogProductId: string): Promise<{
  ok: boolean;
  statusCode: number;
  status: string | null;
  message?: string;
}> {
  const productResult = await fetchMLResult<any>(`/products/${encodeURIComponent(catalogProductId)}`);
  if (!productResult.ok || !productResult.data) {
    return {
      ok: false,
      statusCode: productResult.status || 500,
      status: null,
      message: productResult.error?.message || 'Falha ao validar produto de catálogo no Mercado Livre',
    };
  }

  const status = String(productResult.data.status || '').toLowerCase();
  return {
    ok: status === 'active',
    statusCode: status === 'active' ? 200 : 422,
    status,
    message: status === 'active'
      ? undefined
      : `Produto de catálogo ${catalogProductId} está ${status || 'indisponível'} no Mercado Livre`,
  };
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

    if (!isEligibilityAllowed(status)) {
      return NextResponse.json({ erro: 'Item não está elegível para opt-in de catálogo', eligibility_status: status, reason: eligibilityResult.data.reason || null }, { status: 422 });
    }

    const catalogProductValidation = await validateCatalogProductActive(catalogProductId);
    if (!catalogProductValidation.ok) {
      return NextResponse.json({
        erro: catalogProductValidation.message || 'Produto de catálogo indisponível no Mercado Livre',
        catalog_product_id: catalogProductId,
        catalog_product_status: catalogProductValidation.status,
      }, { status: catalogProductValidation.statusCode });
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

    const service = createServiceClient();
    const catalogItemId = String(optinResult.data?.id || '').trim();
    const catalogItemRefresh = catalogItemId
      ? await fetchMLResult<any>(`/items/${encodeURIComponent(catalogItemId)}`)
      : { ok: false, data: null } as any;
    const localSync = catalogItemRefresh.ok && catalogItemRefresh.data
      ? await syncCatalogOptinLocally({
        service,
        originalItemId: itemId,
        catalogItem: catalogItemRefresh.data,
        sellerId: catalogItemRefresh.data?.seller_id || null,
      })
      : {
        ok: false,
        warnings: [catalogItemId ? 'Anúncio de catálogo criado, mas não foi possível carregar detalhes no ML.' : 'ML não retornou ID do anúncio de catálogo.'],
        produtoId: null,
        sku: null,
      };

    console.log(JSON.stringify({
      event: 'catalog_optin_success',
      item_id: itemId,
      catalog_product_id: catalogProductId,
      result_id: catalogItemId || null,
      synced_local: localSync.ok,
      warnings: localSync.warnings,
      timestamp_utc: new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: optinResult.data,
      original_item_id: itemId,
      catalog_item_id: catalogItemId || null,
      catalog_permalink: catalogItemRefresh.ok ? (catalogItemRefresh.data?.permalink || null) : null,
      synced_local: localSync.ok,
      warnings: localSync.warnings,
    });
  } catch (error: any) {
    return NextResponse.json({ erro: error?.message || 'Erro inesperado' }, { status: 500 });
  }
}
