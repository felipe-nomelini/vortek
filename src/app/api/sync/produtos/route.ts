import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { fetchBling } from '@/services/integration';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

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
