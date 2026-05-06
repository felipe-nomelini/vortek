import { NextResponse } from 'next/server';
import { getValidBlingToken } from '@/services/integration';

export async function GET(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }

  const token = await getValidBlingToken();
  if (!token) return NextResponse.json({ erro: 'Token Bling inválido' }, { status: 502 });

  const res = await fetch('https://api.bling.com.br/Api/v3/produtos?pagina=1&limite=1', {
    headers: { Authorization: `Bearer ${token}`, Accept: '1.0' },
  });

  const text = await res.text();
  return NextResponse.json({
    status: res.status,
    raw: text,
  });
}
