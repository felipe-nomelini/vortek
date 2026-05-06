import { NextResponse } from 'next/server';
import { createJob, registerJobHandler, isCancelled } from '@/services/job-queue';
import { getValidBlingToken } from '@/services/integration';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { UpdateFn } from '@/services/job-queue';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

registerJobHandler('sync-produtos-detalhes', async (jobId: string, update: UpdateFn) => {
  const token = await getValidBlingToken();
  if (!token) throw new Error('Token Bling inválido');

  const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: produtos } = await supabase.from('produtos').select('id,bling_id,sku');
  if (!produtos || produtos.length === 0) throw new Error('Nenhum produto para sincronizar');

  await update({ total: produtos.length, processados: 0, progresso: 0, log: [{ type: 'info', message: `Iniciando sync detalhado de ${produtos.length} produtos...`, timestamp: new Date().toISOString() }] });

  let processados = 0;
  let erros = 0;

  for (const p of produtos) {
    if (isCancelled(jobId)) {
      await update({ log: [{ type: 'info', message: 'Job cancelado pelo usuário', timestamp: new Date().toISOString() }] });
      return;
    }

    if (!p.bling_id) { processados++; continue; }

    try {
      const res = await fetch(`https://api.bling.com.br/Api/v3/produtos/${p.bling_id}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: '1.0' },
      });

      if (!res.ok) { erros++; processados++; continue; }

      const body = await res.json();
      const d = body.data;

      const imagens: string[] = [];
      if (d?.midia?.imagens?.externas) {
        for (const img of d.midia.imagens.externas) {
          if (img.link) imagens.push(img.link);
        }
      }
      if (d?.midia?.imagens?.internas) {
        for (const img of d.midia.imagens.internas) {
          if (img.link) imagens.push(img.link);
        }
      }

      await supabase.from('produtos').update({
        gtin: d.gtin || null,
        peso_liq: d.pesoLiquido || null,
        peso_bruto: d.pesoBruto || null,
        largura: d.dimensoes?.largura || null,
        altura: d.dimensoes?.altura || null,
        profundidade: d.dimensoes?.profundidade || null,
        marca: d.marca || null,
        descricao: d.descricaoCurta ? stripHtml(d.descricaoCurta) : undefined,
        imagens: imagens.length > 0 ? imagens : undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', p.id);

      processados++;
    } catch {
      erros++;
      processados++;
    }

    const pct = Math.round((processados / produtos.length) * 100);
    await update({ processados, progresso: pct });
  }

  await update({ log: [{ type: 'info', message: `Sync concluído: ${processados - erros} atualizados, ${erros} erros`, timestamp: new Date().toISOString() }] });
});

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const job = await createJob('sync-produtos-detalhes', 0);
  return NextResponse.json({ jobId: job.id, status: job.status });
}
