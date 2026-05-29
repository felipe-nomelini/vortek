import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Chave de API inválida' }, { status: 401 });
  }
  return NextResponse.json(
    {
      ok: false,
      error: 'Reconciliação fiscal via Mercado Livre desativada por política. Use somente Brasil NFe.',
      code: 'ml_fiscal_reconciliation_disabled',
    },
    { status: 410 },
  );
}
