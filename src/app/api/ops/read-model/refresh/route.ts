import { NextResponse } from 'next/server';
import { drainUiReadModel, processUiReadModelBatch } from '@/services/ui-read-model';

export const maxDuration = 300;

export async function POST(request: Request) {
  const configuredKey = String(process.env.API_SECRET_KEY || '').trim();
  const suppliedKey = String(request.headers.get('x-api-key') || '').trim();
  if (!configuredKey || suppliedKey !== configuredKey) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body?.batchSize || 100), 1), 250);
    const maxDurationMs = Math.min(Math.max(Number(body?.maxDurationMs || 240_000), 5_000), 240_000);
    const result = body?.drain === true
      ? await drainUiReadModel({ batchSize, maxDurationMs })
      : await processUiReadModelBatch(undefined, batchSize);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[ui-read-model] Falha ao atualizar projeções:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Falha ao atualizar projeções de leitura' }, { status: 500 });
  }
}
