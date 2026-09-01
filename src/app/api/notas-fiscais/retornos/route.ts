import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createFiscalReturnSchema } from '@/lib/fiscal/nfe-return';
import {
  createAndIssueFiscalReturn,
  listFiscalReturns,
} from '@/services/fiscal-return';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'fiscal.read');
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') || 20)));
  try {
    return NextResponse.json(await listFiscalReturns({
      page,
      pageSize,
      search: params.get('search') || '',
      status: params.get('status') || '',
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao listar devoluções fiscais' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const parsed = createFiscalReturnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dados inválidos para emissão da devolução', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const data = await createAndIssueFiscalReturn(parsed.data, auth.userId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao emitir a devolução fiscal';
    const status = /não encontrad|somente leitura/i.test(message) ? 409 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
