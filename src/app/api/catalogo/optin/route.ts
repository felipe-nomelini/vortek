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

function normalizeText(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function getAttribute(source: any, attributeId: string): any | null {
  return Array.isArray(source?.attributes)
    ? source.attributes.find((row: any) => String(row?.id || '').toUpperCase() === attributeId.toUpperCase()) || null
    : null;
}

function getAttributeValue(source: any, attributeId: string): string | null {
  const attr = getAttribute(source, attributeId);
  const value = String(attr?.value_name || attr?.value_id || '').trim();
  return value || null;
}

function getAttributeNumber(source: any, attributeId: string): number | null {
  const attr = getAttribute(source, attributeId);
  const structNumber = Number(attr?.value_struct?.number);
  if (Number.isFinite(structNumber)) return structNumber;
  const value = String(attr?.value_name || '').replace(',', '.');
  const match = value.match(/\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function extractLengthMetersFromText(...values: unknown[]): number | null {
  const text = normalizeText(values.filter(Boolean).join(' ')).replace(',', '.');
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:m|mt|mts|metro|metros)\b/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function getLengthMeters(source: any): number | null {
  return getAttributeNumber(source, 'LENGTH') ?? extractLengthMetersFromText(source?.title, source?.name);
}

function getColorAttributeValue(source: any): string | null {
  return getAttributeValue(source, 'COLOR') || getAttributeValue(source, 'MAIN_COLOR');
}

function getNetworkCableCategory(source: any): string | null {
  const attrValue = getAttributeValue(source, 'NETWORK_CABLE_CATEGORY');
  if (attrValue) return attrValue;

  const text = normalizeText([source?.title, source?.name].filter(Boolean).join(' '));
  const match = text.match(/\bcat\s*\.?\s*(5e|5|6a|6|7|8)\b/);
  return match ? `Categoria ${match[1].toUpperCase()}` : null;
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

async function findLocalProductForItem(params: {
  service: ReturnType<typeof createServiceClient>;
  itemId: string;
  item: any;
}) {
  const { service, itemId, item } = params;
  const sellerSku = getSellerSkuFromItem(item);

  const { data: byItem, error: byItemError } = await service
    .from('produtos')
    .select('id,sku,nome,gtin,descricao,ml_item_id')
    .eq('ml_item_id', itemId)
    .maybeSingle();
  if (byItemError) {
    return { produto: null, error: `Falha ao buscar produto por item ML: ${byItemError.message}` };
  }
  if (byItem) return { produto: byItem, error: null };

  if (!sellerSku) return { produto: null, error: 'SKU do anúncio original não encontrado.' };

  const { data: bySku, error: bySkuError } = await service
    .from('produtos')
    .select('id,sku,nome,gtin,descricao,ml_item_id')
    .eq('sku', sellerSku)
    .maybeSingle();
  if (bySkuError) {
    return { produto: null, error: `Falha ao buscar produto por SKU: ${bySkuError.message}` };
  }
  if (bySku) return { produto: bySku, error: null };

  return { produto: null, error: `Produto local não encontrado para SKU ${sellerSku}.` };
}

async function validateCatalogCompatibility(params: {
  service: ReturnType<typeof createServiceClient>;
  itemId: string;
  catalogProductId: string;
  item: any;
  catalogProduct: any;
}): Promise<{ ok: boolean; statusCode: number; message?: string; details?: Record<string, any> }> {
  const { service, itemId, catalogProductId, item, catalogProduct } = params;
  const localLookup = await findLocalProductForItem({ service, itemId, item });
  if (localLookup.error || !localLookup.produto) {
    return {
      ok: false,
      statusCode: 422,
      message: localLookup.error || 'Produto local não encontrado para validar catálogo.',
    };
  }

  const produto = localLookup.produto;
  const localColor = getColorAttributeValue(item);
  const catalogColor = getColorAttributeValue(catalogProduct);
  if (localColor && catalogColor && normalizeText(localColor) !== normalizeText(catalogColor)) {
    return {
      ok: false,
      statusCode: 422,
      message: `Catálogo incompatível: cor do anúncio ${localColor} diverge da cor do catálogo ${catalogColor}.`,
      details: {
        local_sku: produto.sku,
        local_product_name: produto.nome,
        catalog_product_id: catalogProductId,
        catalog_product_name: catalogProduct?.name || null,
        local_color: localColor,
        catalog_color: catalogColor,
      },
    };
  }

  const itemLength = getLengthMeters(item);
  const catalogLength = getLengthMeters(catalogProduct);
  if (itemLength !== null && catalogLength !== null && Math.abs(itemLength - catalogLength) > 0.01) {
    return {
      ok: false,
      statusCode: 422,
      message: `Catálogo incompatível: comprimento do anúncio ${itemLength}m diverge do catálogo ${catalogLength}m.`,
      details: {
        local_sku: produto.sku,
        local_product_name: produto.nome,
        catalog_product_id: catalogProductId,
        catalog_product_name: catalogProduct?.name || null,
        item_length_meters: itemLength,
        catalog_length_meters: catalogLength,
      },
    };
  }

  const itemCableCategory = getNetworkCableCategory(item);
  const catalogCableCategory = getNetworkCableCategory(catalogProduct);
  if (itemCableCategory && catalogCableCategory && normalizeText(itemCableCategory) !== normalizeText(catalogCableCategory)) {
    return {
      ok: false,
      statusCode: 422,
      message: `Catálogo incompatível: categoria do cabo ${itemCableCategory} diverge do catálogo ${catalogCableCategory}.`,
      details: {
        local_sku: produto.sku,
        local_product_name: produto.nome,
        catalog_product_id: catalogProductId,
        catalog_product_name: catalogProduct?.name || null,
        item_network_cable_category: itemCableCategory,
        catalog_network_cable_category: catalogCableCategory,
      },
    };
  }

  const { data: existingSnapshots, error: snapshotError } = await service
    .from('catalogo_ml_snapshot')
    .select('ml_item_id,produto_id,sku_local,seller_sku,catalog_listing,status')
    .eq('catalog_product_id', catalogProductId)
    .eq('catalog_listing', true)
    .eq('status', 'active')
    .neq('produto_id', produto.id)
    .limit(20);
  if (snapshotError) {
    return {
      ok: false,
      statusCode: 500,
      message: `Falha ao validar duplicidade de catálogo: ${snapshotError.message}`,
    };
  }

  const existingProductIds = Array.from(
    new Set((existingSnapshots || []).map((row: any) => String(row?.produto_id || '').trim()).filter(Boolean)),
  );
  if (existingProductIds.length > 0) {
    const { data: existingProducts, error: productsError } = await service
      .from('produtos')
      .select('id,sku,nome,gtin')
      .in('id', existingProductIds);
    if (productsError) {
      return {
        ok: false,
        statusCode: 500,
        message: `Falha ao validar produtos já vinculados ao catálogo: ${productsError.message}`,
      };
    }

    const localGtin = String(produto.gtin || '').replace(/\D/g, '');
    const conflictingGtins = (existingProducts || [])
      .map((existing: any) => ({
        sku: existing?.sku || null,
        gtin: String(existing?.gtin || '').replace(/\D/g, ''),
      }))
      .filter((existing) => existing.gtin && localGtin && existing.gtin !== localGtin);
    if (conflictingGtins.length > 0) {
      console.warn(JSON.stringify({
        event: 'catalog_optin_same_catalog_different_gtin_allowed',
        catalog_product_id: catalogProductId,
        local_sku: produto.sku,
        local_gtin: localGtin || null,
        conflicts: conflictingGtins,
        reason: 'Mercado Livre returned the same catalog_product_id; GTIN differs between local products but item/catalog attributes are compatible.',
        timestamp_utc: new Date().toISOString(),
      }));
    }
  }

  return { ok: true, statusCode: 200 };
}

async function validateCatalogProductActive(catalogProductId: string): Promise<{
  ok: boolean;
  statusCode: number;
  status: string | null;
  message?: string;
  product?: any;
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
    product: productResult.data,
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

    const originalItemResult = await fetchMLResult<any>(`/items/${encodeURIComponent(itemId)}`);
    if (!originalItemResult.ok || !originalItemResult.data) {
      return NextResponse.json({
        erro: originalItemResult.error?.message || 'Falha ao carregar anúncio original no Mercado Livre',
      }, { status: originalItemResult.status || 500 });
    }

    const service = createServiceClient();
    const compatibility = await validateCatalogCompatibility({
      service,
      itemId,
      catalogProductId,
      item: originalItemResult.data,
      catalogProduct: catalogProductValidation.product,
    });
    if (!compatibility.ok) {
      return NextResponse.json({
        erro: compatibility.message || 'Produto de catálogo incompatível com o anúncio local',
        catalog_product_id: catalogProductId,
        details: compatibility.details || null,
      }, { status: compatibility.statusCode });
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
