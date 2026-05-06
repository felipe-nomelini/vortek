import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { listJobs } from '@/services/job-queue';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const jobs = await listJobs();
  return NextResponse.json({ data: jobs });
}
