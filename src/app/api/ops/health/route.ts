import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function nowSaoPauloIso() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');
}

export async function GET() {
  const mem = process.memoryUsage();

  let runningJobs: Array<{ id: string; tipo: string; status: string; created_at: string }> = [];
  try {
    const client = createServiceClient();
    const { data } = await client
      .from('jobs')
      .select('id,tipo,status,created_at')
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(10);

    runningJobs = (data || []) as Array<{ id: string; tipo: string; status: string; created_at: string }>;
  } catch {
    // health endpoint deve responder mesmo sem acesso ao banco
  }

  return NextResponse.json(
    {
      success: true,
      service: 'vortek',
      timestamp_utc: new Date().toISOString(),
      timestamp_sp: nowSaoPauloIso(),
      process: {
        pid: process.pid,
        uptime_sec: Math.round(process.uptime()),
        memory: {
          rss: mem.rss,
          heap_used: mem.heapUsed,
          heap_total: mem.heapTotal,
        },
      },
      running_jobs: runningJobs,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}
