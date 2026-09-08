import { NextResponse } from 'next/server';
import { loadPricingDetail } from '@/services/pricing-detail';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try { return await loadPricingDetail({ produtoId: params.get('produtoId') || '', ...(params.get('mlItemId') ? { mlItemId: params.get('mlItemId') } : {}) }); }
  catch { return json({ error: 'Falha ao consultar fontes econômicas.' }, 503); }
}

/** Consulta explícita, nunca grava configuração ou preço. */
export async function POST(request: Request) {
  try { return await loadPricingDetail(await request.json().catch(() => null)); }
  catch { return json({ error: 'Falha ao consultar fontes econômicas.' }, 503); }
}
