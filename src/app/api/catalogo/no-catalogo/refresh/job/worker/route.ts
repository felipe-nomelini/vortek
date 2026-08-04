import { NextResponse } from 'next/server';
import { runCatalogRefreshJobBatch } from '@/services/catalog-refresh-job';

export const maxDuration = 300;

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const jobId = String(body?.jobId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ success: false, error: 'jobId inválido' }, { status: 400 });
  }

  const result = await runCatalogRefreshJobBatch(jobId);
  return NextResponse.json(result, { status: result.status === 'erro' ? 500 : 200 });
}
