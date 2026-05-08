import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const me = await fetchML<any>('/users/me');
  if (!me) return NextResponse.json({ erro: 'Erro ao conectar com ML' }, { status: 502 });

  const serviceClient = createServiceClient();
  let totalGeral = 0;
  let salvos = 0;
  let offset = 0;
  const limit = 50;

  while (true) {
    const search = await fetchML<any>(
      `/users/${me.id}/items/search?search_type=scan&limit=${limit}&offset=${offset}`
    );

    if (!search) break;

    const itemIds = search.results || [];
    if (itemIds.length === 0) break;

    totalGeral += itemIds.length;

    for (let i = 0; i < itemIds.length; i++) {
      const itemId = itemIds[i];
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
      }, { onConflict: 'ml_item_id' });

      salvos++;

      if (i % 10 === 0) await delay(1000);
    }

    const paging = search.paging;
    const total = paging?.total || 0;
    offset += limit;

    if (offset >= total) break;
    if (itemIds.length < limit) break;
    await delay(2000);
  }

  return NextResponse.json({ ok: true, sincronizados: salvos, total: totalGeral });
}
