import { NextResponse } from 'next/server';
import { runDsliteJob } from '@/services/sync-dslite-job';

export const maxDuration = 300;

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'API key inválida' }, { status: 401 });
  }

  const { jobId } = await request.json().catch(() => ({}));
  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json({ error: 'jobId é obrigatório' }, { status: 400 });
  }

  try {
    const result = await runDsliteJob(jobId);

    return NextResponse.json({
      success: true,
      jobId,
      status: result.status,
      processados: result.processados,
      total: result.total,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Erro ao processar sincronização DSLite' },
      { status: 500 }
    );
  }
}
