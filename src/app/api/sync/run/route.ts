import { NextResponse } from 'next/server';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { tipo } = await request.json();
    const apiKey = request.headers.get('x-api-key') || '';

    if (apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
    }

    const validTipos = ['todos', 'catalogo', 'precos', 'anuncios', 'pedidos'];
    const target = tipo || 'todos';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    if (!validTipos.includes(target)) {
      return NextResponse.json({ error: `tipo inválido. Valores: ${validTipos.join(', ')}` }, { status: 400 });
    }

    const results: any[] = [];

    async function trigger(path: string, body: any) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_SECRET_KEY || '' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ error: 'Falha ao parsear resposta' }));
      return { status: res.status, data };
    }

    if (target === 'todos' || target === 'catalogo') {
      const r = await trigger('/api/sync/catalogo', {});
      results.push({ tipo: 'catalogo', ...r });
    }

    if (target === 'todos' || target === 'precos') {
      const r = await trigger('/api/sync/preco-estoque', {});
      results.push({ tipo: 'precos', ...r });
    }

    if (target === 'todos' || target === 'anuncios') {
      const r = await trigger('/api/sync/anuncios', {});
      results.push({ tipo: 'anuncios', ...r });
    }

    if (target === 'todos' || target === 'pedidos') {
      const r = await trigger('/api/sync/pedidos', {});
      results.push({ tipo: 'pedidos', ...r });
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
