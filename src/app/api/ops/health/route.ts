import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getMLAuthDiagnostics } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function nowSaoPauloIso() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');
}

export async function GET() {
  const mem = process.memoryUsage();

  let runningJobs: Array<{ id: string; tipo: string; status: string; created_at: string }> = [];
  let mlAuth = {
    state: 'ok',
    blocked_until: null as string | null,
    last_refresh_at: null as string | null,
    last_refresh_error: null as string | null,
    last_refresh_error_code: null as string | null,
    conectado: false,
  };
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
  try {
    mlAuth = await getMLAuthDiagnostics();
  } catch {
    // mantém health resiliente
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
      ml_auth: mlAuth,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}
