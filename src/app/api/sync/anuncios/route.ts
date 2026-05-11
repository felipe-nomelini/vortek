import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

export const maxDuration = 120;

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
  if (item.seller_sku) return item.seller_sku;
  if (item.seller_custom_field) return item.seller_custom_field;
  const skuAttr = (item.attributes || []).find((a: any) => a.id === 'SELLER_SKU');
  if (skuAttr?.value_name) return skuAttr.value_name;
  return item.id;
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = 100;

  const me = await fetchML<any>('/users/me');
  if (!me) return NextResponse.json({ erro: 'Erro ao conectar com ML' }, { status: 502 });

  const search = await fetchML<any>(
    `/users/${me.id}/items/search?limit=${limit}&offset=${offset}`
  );
  if (!search) return NextResponse.json({ erro: 'Erro ao buscar anúncios' }, { status: 502 });

  const itemIds = search.results || [];
  if (itemIds.length === 0) {
    return NextResponse.json({ ok: true, sincronizados: 0, total: 0, proximo: offset, acabou: true });
  }

  const serviceClient = createServiceClient();
  let salvos = 0;

  for (const itemId of itemIds) {
    const item = await fetchML<any>(`/items/${itemId}`);
    if (!item) continue;

    const qualidade = calcularQualidade(item);

    await serviceClient.from('anuncios_ml').upsert({
      ml_item_id: item.id,
      sku: extrairSku(item),
      titulo: item.title,
      preco_ml: item.price,
      vendidos: item.sold_quantity || 0,
      status: item.status === 'active' ? 'ativo' : item.status === 'paused' ? 'pausado' : 'sem_anuncio',
      thumbnail: item.thumbnail,
      permalink: item.permalink,
      qualidade: qualidade.total,
      qualidade_info: qualidade,
      catalogo: item.catalog_listing === true,
    }, { onConflict: 'ml_item_id' });

    salvos++;
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
  });
}
