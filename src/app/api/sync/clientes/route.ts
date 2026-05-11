import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getValidBlingToken } from '@/services/integration';

export const maxDuration = 120;

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
    const res = await fetch(`https://api.bling.com.br/Api/v3/contatos?pagina=${pagina}&limite=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: '1.0' },
    });
    if (!res.ok) break;

    const body = await res.json();
    const contatos = body.data || [];
    if (contatos.length === 0) break;

    totalGeral += contatos.length;

    for (const c of contatos) {
      const { error } = await serviceClient.from('clientes').upsert({
        nome: c.nome || '',
        documento: c.numeroDocumento || '',
        telefone: c.celular || c.telefone || '',
        bling_contato_id: String(c.id),
      }, { onConflict: 'bling_contato_id' });

      if (!error) salvos++;
    }

    if (contatos.length < 100) break;
    pagina++;
  }

  return NextResponse.json({ ok: true, sincronizados: salvos, total: totalGeral });
}
