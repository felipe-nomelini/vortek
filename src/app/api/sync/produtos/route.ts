import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getValidBlingToken } from '@/services/integration';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const token = await getValidBlingToken();
  if (!token) return NextResponse.json({ erro: 'Token Bling inválido' }, { status: 502 });

  const serviceClient = createServiceClient();
  let totalGeral = 0;
  let salvos = 0;
  let pagina = 1;

  while (true) {
    const res = await fetch(`https://api.bling.com.br/Api/v3/produtos?pagina=${pagina}&limite=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: '1.0' },
    });
    if (!res.ok) break;

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

    const totalPages = body.paging?.pages || Math.ceil((body.total || 0) / 100);
    if (pagina >= totalPages) break;
    if (!body.paging && !body.total && produtos.length < 100) break;
    pagina++;
  }

  return NextResponse.json({ ok: true, sincronizados: salvos, total: totalGeral });
}
