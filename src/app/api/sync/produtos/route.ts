import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchBling } from '@/services/integration';

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const data = await fetchBling<any>('/produtos?pagina=1&limite=100');
  if (!data) return NextResponse.json({ erro: 'Erro ao sincronizar com Bling' }, { status: 502 });

  const produtos = data.data || [];
  const serviceClient = createServiceClient();
  let salvos = 0;

  for (const p of produtos) {
    const { error } = await serviceClient.from('produtos').upsert({
      sku: p.codigo || p.sku || `BLING-${p.id}`,
      nome: p.descricao,
      estoque: p.estoque || 0,
      custo: p.preco_custo || 0,
      preco_bling: p.preco || 0,
      bling_id: String(p.id),
      bling_status: p.situacao === 'Ativo' ? 'ativo' : 'inativo',
    }, { onConflict: 'sku' });

    if (!error) salvos++;
  }

  return NextResponse.json({ ok: true, sincronizados: salvos, total: produtos.length });
}
