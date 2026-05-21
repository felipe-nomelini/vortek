import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML, fetchMLResult, getMLAuthDiagnostics, type MLRequestError } from '@/services/integration';

export const maxDuration = 300;

const CONCURRENCY = 3;

function calcularQualidade(item: any): { total: number; itens: any[]; dica: string } {
  const tags = item.tags || [];
  const itens: any[] = [];
  let total = 0;

  const imgOk = tags.includes('good_quality_picture') || tags.includes('good_quality_thumbnail');
  itens.push({ nome: 'Imagem de qualidade', ok: imgOk, pontos: imgOk ? 25 : 0, max: 25 });
  if (imgOk) total += 25;

  const attrOk = !tags.includes('incomplete_technical_specs');
  itens.push({ nome: 'Atributos completos', ok: attrOk, pontos: attrOk ? 25 : 0, max: 25 });
  if (attrOk) total += 25;

  const precoOk = !tags.includes('not_market_price');
  itens.push({ nome: 'Preço competitivo', ok: precoOk, pontos: precoOk ? 20 : 0, max: 20 });
  if (precoOk) total += 20;

  const catalogoOk = item.catalog_listing === true && item.catalog_product_id != null;
  itens.push({ nome: 'No catálogo ML', ok: catalogoOk, pontos: catalogoOk ? 15 : 0, max: 15 });
  if (catalogoOk) total += 15;

  const freteOk = item.shipping?.free_shipping === true;
  itens.push({ nome: 'Frete grátis', ok: freteOk, pontos: freteOk ? 15 : 0, max: 15 });
  if (freteOk) total += 15;

  let dica = '';
  if (!precoOk) dica = 'Preço está acima da média do mercado. Considere ajustar.';
  else if (!imgOk) dica = 'Adicione imagens de alta qualidade para melhorar o anúncio.';
  else if (!attrOk) dica = 'Preencha todos os atributos técnicos do produto.';
  else if (!catalogoOk) dica = 'Vincular ao catálogo ML pode aumentar a visibilidade.';
  else if (!freteOk) dica = 'Oferecer frete grátis aumenta as chances de venda.';

  return { total, itens, dica };
}

function extrairSku(item: any): string {
  if (item.seller_sku) return String(item.seller_sku).trim().toUpperCase();
  if (item.seller_custom_field) return String(item.seller_custom_field).trim().toUpperCase();
  const skuAttr = (item.attributes || []).find((a: any) => a.id === 'SELLER_SKU');
  if (skuAttr?.value_name) return String(skuAttr.value_name).trim().toUpperCase();
  return String(item.id);
}

function statusMLFromItem(item: any): 'ativo' | 'pausado' | 'sem_anuncio' {
  if (item.status === 'active') return 'ativo';
  if (item.status === 'paused') return 'pausado';
  return 'sem_anuncio';
}

async function getMLFee(item: any): Promise<number> {
  try {
    const listingPrices = await fetchML<any>(
      `/sites/MLB/listing_prices?price=${item.price}&category_id=${item.category_id}&listing_type_id=${item.listing_type_id}`
    );
    if (listingPrices?.sale_fee_details?.percentage_fee) {
      return listingPrices.sale_fee_details.percentage_fee / 100;
    }
    if (listingPrices?.sale_fee_details?.meli_percentage_fee) {
      return listingPrices.sale_fee_details.meli_percentage_fee / 100;
    }
  } catch {}
  return 0.15;
}

type ShippingResult = {
  value: number;
  warning?: string;
  retrySuccess: boolean;
  retryFailed: boolean;
  authFailure: boolean;
};

async function getMLShipping(itemId: string, sellerZip: string): Promise<ShippingResult> {
  const path = `/items/${itemId}/shipping_options?zip_code=${sellerZip}`;
  let retrySuccess = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await fetchMLResult<any>(path);
    if (result.ok) {
      if (attempt > 0) retrySuccess = true;
      const options = result.data?.options || [];
      const freeOption = options.find((o: any) => o.cost === 0);
      if (freeOption?.list_cost) {
        return { value: freeOption.list_cost, retrySuccess, retryFailed: false, authFailure: false };
      }
      const firstOption = options.find((o: any) => typeof o.list_cost === 'number');
      if (firstOption?.list_cost) {
        return { value: firstOption.list_cost, retrySuccess, retryFailed: false, authFailure: false };
      }
      return { value: 0, warning: 'shipping_sem_opcoes', retrySuccess, retryFailed: false, authFailure: false };
    }

    const err = result.error as MLRequestError | null;
    if (err?.category === 'auth_fatal') {
      return { value: 0, warning: err.code || err.message, retrySuccess, retryFailed: false, authFailure: true };
    }

    if (err?.category === 'expected_operational') {
      return { value: 0, warning: err.code || err.message, retrySuccess, retryFailed: false, authFailure: false };
    }

    const shouldRetry = err?.category === 'retryable' && attempt < 2;
    if (!shouldRetry) {
      return { value: 0, warning: err?.code || err?.message || 'shipping_error', retrySuccess, retryFailed: true, authFailure: false };
    }

    const jitter = Math.floor(Math.random() * 250);
    await new Promise(resolve => setTimeout(resolve, (700 * (attempt + 1)) + jitter));
  }

  return { value: 0, warning: 'shipping_retry_exhausted', retrySuccess, retryFailed: true, authFailure: false };
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = 100;

  const meResult = await fetchMLResult<any>('/users/me');
  if (!meResult.ok || !meResult.data) {
    if (meResult.error?.category === 'auth_fatal') {
      const auth = await getMLAuthDiagnostics();
      return NextResponse.json({
        ok: false,
        error: 'Integração ML requer reconexão para sincronizar anúncios',
        failure_reason: 'auth_fatal',
        auth_state: auth.state,
        auth_blocked_until: auth.blocked_until,
      }, { status: 401 });
    }
    return NextResponse.json({ erro: 'Erro ao conectar com ML' }, { status: 502 });
  }
  const me = meResult.data;

  const sellerZip = me.address?.zip_code || '';
  const search = await fetchML<any>(`/users/${me.id}/items/search?limit=${limit}&offset=${offset}`);
  if (!search) return NextResponse.json({ erro: 'Erro ao buscar anúncios' }, { status: 502 });

  const itemIds = search.results || [];
  if (itemIds.length === 0) {
    return NextResponse.json({
      ok: true,
      sincronizados: 0,
      total: 0,
      proximo: offset,
      acabou: true,
      warnings_expected: 0,
      retry_success: 0,
      retry_failed: 0,
      auth_failures: 0,
    });
  }

  const serviceClient = createServiceClient();
  let salvos = 0;
  let warningsExpected = 0;
  let retrySuccess = 0;
  let retryFailed = 0;
  let authFailures = 0;
  let linkageWarnings = 0;
  let abortedByAuth = false;

  await runPool(itemIds, CONCURRENCY, async (itemId) => {
    if (abortedByAuth) return;

    const itemResult = await fetchMLResult<any>(`/items/${itemId}`);
    if (!itemResult.ok || !itemResult.data) {
      if (itemResult.error?.category === 'auth_fatal') {
        authFailures++;
        abortedByAuth = true;
      }
      return;
    }

    const item = itemResult.data;
    const qualidade = calcularQualidade(item);
    const sku = extrairSku(item);
    const statusML = statusMLFromItem(item);

    const { data: produtoByItemId } = await serviceClient
      .from('produtos')
      .select('id, sku')
      .eq('ml_item_id', item.id)
      .maybeSingle();

    const { data: produtoBySku } = await serviceClient
      .from('produtos')
      .select('id, sku')
      .eq('sku', sku)
      .maybeSingle();

    let produtoMatch = produtoByItemId || produtoBySku || null;
    if (produtoByItemId && produtoBySku && produtoByItemId.id !== produtoBySku.id) {
      linkageWarnings++;
      console.warn(
        `[sync-anuncios] Divergência de vínculo ml_item_id=${item.id}: sku_extraido=${sku}, produto_por_item=${produtoByItemId.id}(${produtoByItemId.sku}), produto_por_sku=${produtoBySku.id}(${produtoBySku.sku})`
      );
      produtoMatch = produtoByItemId;
    }

    await serviceClient.from('anuncios_ml').upsert({
      ml_item_id: item.id,
      sku,
      produto_id: produtoMatch?.id || null,
      titulo: item.title,
      preco_ml: item.price,
      vendidos: item.sold_quantity || 0,
      status: statusML,
      thumbnail: item.thumbnail,
      permalink: item.permalink,
      qualidade: qualidade.total,
      qualidade_info: qualidade,
      catalogo: item.catalog_listing === true,
    }, { onConflict: 'ml_item_id' });

    if (produtoMatch?.id) {
      const [mlFee, shipping] = await Promise.all([
        getMLFee(item),
        sellerZip ? getMLShipping(item.id, sellerZip) : Promise.resolve<ShippingResult>({
          value: 0,
          retrySuccess: false,
          retryFailed: false,
          authFailure: false,
        }),
      ]);

      if (shipping.warning) warningsExpected++;
      if (shipping.retrySuccess) retrySuccess++;
      if (shipping.retryFailed) retryFailed++;
      if (shipping.authFailure) {
        authFailures++;
        abortedByAuth = true;
      }

      await serviceClient
        .from('produtos')
        .update({
          ml_item_id: item.id,
          ml_status: statusML,
          ml_fee: mlFee,
          ml_shipping: shipping.value,
          ml_shipping_warning: shipping.warning || null,
        })
        .eq('id', produtoMatch.id);
    }

    salvos++;
  });

  if (abortedByAuth) {
    const auth = await getMLAuthDiagnostics();
    return NextResponse.json({
      ok: false,
      error: 'Sincronização abortada por falha de autenticação com ML',
      failure_reason: 'auth_fatal',
      auth_state: auth.state,
      auth_blocked_until: auth.blocked_until,
      sincronizados: salvos,
      warnings_expected: warningsExpected,
      retry_success: retrySuccess,
      retry_failed: retryFailed,
      auth_failures: authFailures,
      linkage_warnings: linkageWarnings,
      aborted_by_auth: true,
    }, { status: 401 });
  }

  const total = search.paging?.total || 0;
  const proximo = offset + limit;
  const acabou = proximo >= total || itemIds.length < limit;

  return NextResponse.json({
    ok: true,
    sincronizados: salvos,
    pagina: Math.floor(offset / limit) + 1,
    total,
    proximo: acabou ? null : proximo,
    acabou,
    warnings_expected: warningsExpected,
    retry_success: retrySuccess,
    retry_failed: retryFailed,
    auth_failures: authFailures,
    aborted_by_auth: false,
    linkage_warnings: linkageWarnings,
  });
}
