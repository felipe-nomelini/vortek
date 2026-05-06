import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchBling } from '@/services/integration';

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  let totalGeral = 0;
  let salvos = 0;
  let pagina = 1;

  while (true) {
    const data = await fetchBling<any>(`/produtos?pagina=${pagina}&limite=100`);
    if (!data) break;

    const produtos = data.data || [];
    if (produtos.length === 0) break;

    totalGeral += produtos.length;

    for (const p of produtos) {
      const sku = p.codigo || p.sku || `BLING-${p.id}`;
      const { error } = await serviceClient.from('produtos').upsert({
        sku,
        nome: p.descricao || p.nome || '',
        estoque: p.estoque || 0,
        custo: p.preco_custo || 0,
        preco_bling: p.preco || p.preco_atual || 0,
        bling_id: String(p.id),
        bling_status: p.situacao === 'Ativo' ? 'ativo' : 'inativo',
      }, { onConflict: 'sku' });

      if (!error) salvos++;
    }

    const totalPaginas = data.totalPages || Math.ceil((data.total || 0) / 100);
    if (pagina >= totalPaginas) break;
    pagina++;
  }

  return NextResponse.json({ ok: true, sincronizados: salvos, total: totalGeral });
}
