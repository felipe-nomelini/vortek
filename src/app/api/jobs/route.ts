import { NextResponse } from 'next/server';
import { listJobs } from '@/services/job-queue';

export async function GET(request: Request) {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  }

  const jobs = await listJobs();
  return NextResponse.json({ data: jobs });
}
