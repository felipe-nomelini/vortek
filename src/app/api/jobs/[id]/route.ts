import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { getJob, cancelJob } from '@/services/job-queue';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ erro: 'Job não encontrado' }, { status: 404 });

  return NextResponse.json(job);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  await cancelJob(params.id);
  return NextResponse.json({ ok: true });
}
