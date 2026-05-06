import { NextResponse } from 'next/server';
import { getJob, cancelJob } from '@/services/job-queue';

function checkAuth(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey === process.env.API_SECRET_KEY) return true;
  return false;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!checkAuth(request)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ erro: 'Job não encontrado' }, { status: 404 });

  return NextResponse.json(job);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!checkAuth(request)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }

  await cancelJob(params.id);
  return NextResponse.json({ ok: true });
}
