import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { loadFiscalReturnOrigin } from '@/services/fiscal-return';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ pedidoId: string }> },
) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const parsed = z.string().uuid().safeParse((await context.params).pedidoId);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Identificador da venda inválido' }, { status: 422 });
  }
  try {
    return NextResponse.json({ data: await loadFiscalReturnOrigin(parsed.data) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao carregar a venda' },
      { status: 422 },
    );
  }
}
