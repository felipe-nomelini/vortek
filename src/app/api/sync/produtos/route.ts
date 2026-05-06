import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { createJob, registerJobHandler, isCancelled, getJob } from '@/services/job-queue';
import { getValidBlingToken } from '@/services/integration';
import type { UpdateFn } from '@/services/job-queue';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

registerJobHandler('sync-produtos', async (jobId: string, update: UpdateFn) => {
  const token = await getValidBlingToken();
  if (!token) throw new Error('Token Bling inválido');

  const serviceClient = createServiceClient();
  let totalGeral = 0;
  let salvos = 0;
  let pagina = 1;

  await update({ log: [{ type: 'info', message: 'Iniciando sync de produtos do Bling...', timestamp: new Date().toISOString() }] });

  while (true) {
    if (isCancelled(jobId)) {
      await update({ log: [{ type: 'info', message: 'Sync cancelado pelo usuário', timestamp: new Date().toISOString() }] });
      return;
    }

    const res = await fetch(`https://api.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: '1.0' },
    });
    if (!res.ok) {
      await update({ log: [{ type: 'error', message: `Erro HTTP ${res.status} na página ${pagina}`, timestamp: new Date().toISOString() }] });
      break;
    }

    const body = await res.json();
    const produtos = body.data || [];
    if (produtos.length === 0) break;

    totalGeral += produtos.length;

    for (const p of produtos) {
      const sku = p.codigo || String(p.id);
      const { error } = await serviceClient.from('produtos').upsert({
        sku,
        nome: p.nome || '',
        estoque: p.estoque?.saldoVirtualTotal ?? 0,
        custo: p.precoCusto || 0,
        preco_bling: p.preco || 0,
        bling_id: String(p.id),
        bling_status: p.situacao === 'A' ? 'ativo' : 'inativo',
        descricao: p.descricaoCurta ? stripHtml(p.descricaoCurta) : '',
        imagens: p.imagemURL ? [p.imagemURL] : [],
      }, { onConflict: 'sku' });

      if (!error) salvos++;
    }

    const pct = Math.round((totalGeral / (totalGeral + 100)) * 100);
    await update({
      processados: salvos,
      total: totalGeral,
      progresso: Math.min(pct, 99),
      log: [{ type: 'success', message: `Página ${pagina}: ${produtos.length} produtos processados`, timestamp: new Date().toISOString() }],
    });

    if (produtos.length < 100) break;
    if (body.paging?.pages || body.total) {
      const totalPages = body.paging?.pages || Math.ceil((body.total || 0) / 100);
      if (pagina >= totalPages) break;
    }
    pagina++;
  }

  await update({ log: [{ type: 'info', message: `Sync concluído: ${salvos} produtos sincronizados em ${pagina} página(s)`, timestamp: new Date().toISOString() }] });
});

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const job = await createJob('sync-produtos', 0);
  return NextResponse.json({ jobId: job.id, status: job.status });
}
