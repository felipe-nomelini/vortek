import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { getFiscalReturn } from '@/services/fiscal-return';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.read');
  if (!auth.ok) return auth.response;
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: 'Identificador inválido' }, { status: 422 });
  try {
    const data = await getFiscalReturn(parsed.data);
    if (!data) return NextResponse.json({ error: 'Nota de retorno não encontrada' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao carregar o retorno' }, { status: 500 });
  }
}
