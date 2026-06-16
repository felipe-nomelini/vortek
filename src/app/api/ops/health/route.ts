import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getMLAuthDiagnostics } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function nowSaoPauloIso() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');
}

function getBrasilNfeTipoAmbienteHealth() {
  const envValue = process.env.BRASILNFE_TIPO_AMBIENTE;
  const raw = typeof envValue === 'string' ? envValue.trim() : '';
  const interpreted = raw === '' ? null : Number(raw);
  const interpretedSafe = interpreted === null || Number.isNaN(interpreted) ? null : interpreted;
  const ok = interpretedSafe === 1;
  return {
    status: ok ? 'ok' : 'invalid',
    expected: 1,
    brasilnfe_tipo_ambiente_raw: raw || null,
    tipo_ambiente_interpretado: interpretedSafe,
  } as const;
}

export async function GET() {
  const mem = process.memoryUsage();
  const fiscalConfig = getBrasilNfeTipoAmbienteHealth();

  let runningJobs: Array<{ id: string; tipo: string; status: string; created_at: string }> = [];
  let mlAuth = {
    state: 'ok',
    blocked_until: null as string | null,
    last_refresh_at: null as string | null,
    last_refresh_error: null as string | null,
    last_refresh_error_code: null as string | null,
    conectado: false,
    read_ok: false,
    read_error: null as string | null,
    has_access_token: false,
    has_refresh_token: false,
    token_expires_at: null as string | null,
    token_expired: null as boolean | null,
    token_expires_in_minutes: null as number | null,
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
      fiscal_config: fiscalConfig,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}
