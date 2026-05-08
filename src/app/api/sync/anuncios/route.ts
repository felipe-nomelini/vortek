import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { createJob, registerJobHandler, isCancelled } from '@/services/job-queue';
import { fetchML } from '@/services/integration';
import type { UpdateFn } from '@/services/job-queue';

registerJobHandler('sync-anuncios', async (jobId: string, update: UpdateFn) => {
  const me = await fetchML<any>('/users/me');
  if (!me) throw new Error('Erro ao conectar com ML');

  const serviceClient = createServiceClient();
  let totalGeral = 0;
  let salvos = 0;
  let offset = 0;
  const limit = 100;

  await update({ log: [{ type: 'info', message: 'Iniciando sync de anúncios do ML...', timestamp: new Date().toISOString() }] });

  while (true) {
    if (isCancelled(jobId)) {
      await update({ log: [{ type: 'info', message: 'Sync cancelado', timestamp: new Date().toISOString() }] });
      return;
    }

    const search = await fetchML<any>(`/users/${me.id}/items/search?limit=${limit}&offset=${offset}`);
    if (!search) break;

    const itemIds = search.results || [];
    if (itemIds.length === 0) break;

    totalGeral += itemIds.length;

    for (const itemId of itemIds) {
      if (isCancelled(jobId)) return;
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
    }

    const pct = Math.round((salvos / 556) * 100);
    await update({ processados: salvos, total: Math.max(totalGeral, salvos), progresso: Math.min(pct, 99) });

    const total = search.paging?.total || 0;
    offset += limit;
    if (offset >= total) break;
    if (itemIds.length < limit) break;
  }

  await update({ progresso: 100, log: [{ type: 'info', message: `Sync concluído: ${salvos} anúncios sincronizados`, timestamp: new Date().toISOString() }] });
});

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const job = await createJob('sync-anuncios', 0);
  return NextResponse.json({ jobId: job.id, status: job.status });
}
