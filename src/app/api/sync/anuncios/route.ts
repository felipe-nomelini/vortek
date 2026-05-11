import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

export const maxDuration = 120;

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

    await serviceClient.from('anuncios_ml').upsert({
      ml_item_id: item.id,
      sku: item.seller_sku || item.id,
      titulo: item.title,
      preco_ml: item.price,
      vendidos: item.sold_quantity || 0,
      status: item.status === 'active' ? 'ativo' : item.status === 'paused' ? 'pausado' : 'sem_anuncio',
      thumbnail: item.thumbnail,
      permalink: item.permalink,
      saude: item.health != null ? Math.round(item.health * 100) : null,
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
