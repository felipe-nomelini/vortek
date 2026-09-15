import { NextResponse } from 'next/server';
import { markCatalogIdentityRunFailure, runCatalogIdentityAuditBatch } from '@/services/catalog-identity-audit';

export const maxDuration = 300;

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const runId = String(body?.runId || '');
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ error: 'runId inválido' }, { status: 422 });
  try {
    return NextResponse.json(await runCatalogIdentityAuditBatch(runId));
  } catch (error) {
    await markCatalogIdentityRunFailure(runId, error);
    return NextResponse.json({ error: 'Falha no worker de identidade.' }, { status: 500 });
  }
}
