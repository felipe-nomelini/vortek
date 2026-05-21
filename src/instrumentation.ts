import { createServiceClient } from '@/lib/supabase';

declare global {
  // eslint-disable-next-line no-var
  var __vortekRuntimeTelemetryRegistered: boolean | undefined;
}

function nowSaoPauloIso() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');
}

async function getRunningJobsSummary() {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return null;
    }

    const client = createServiceClient();
    const { data } = await client
      .from('jobs')
      .select('id,tipo,status,created_at')
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(3);

    return data || [];
  } catch {
    return null;
  }
}

async function logRuntimeEvent(event: string, extra?: Record<string, unknown>) {
  const mem = process.memoryUsage();
  const payload = {
    event,
    pid: process.pid,
    uptime_sec: Math.round(process.uptime()),
    timestamp_utc: new Date().toISOString(),
    timestamp_sp: nowSaoPauloIso(),
    memory: {
      rss: mem.rss,
      heap_used: mem.heapUsed,
      heap_total: mem.heapTotal,
    },
    running_jobs: await getRunningJobsSummary(),
    ...extra,
  };

  if (event === 'uncaughtException' || event === 'unhandledRejection') {
    console.error('[runtime-telemetry]', JSON.stringify(payload));
  } else {
    console.warn('[runtime-telemetry]', JSON.stringify(payload));
  }
}

export async function register() {
  if (global.__vortekRuntimeTelemetryRegistered) {
    return;
  }
  global.__vortekRuntimeTelemetryRegistered = true;

  process.on('SIGTERM', () => {
    void logRuntimeEvent('SIGTERM');
  });

  process.on('SIGINT', () => {
    void logRuntimeEvent('SIGINT');
  });

  process.on('unhandledRejection', (reason) => {
    void logRuntimeEvent('unhandledRejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (error) => {
    void logRuntimeEvent('uncaughtException', {
      message: error.message,
      stack: error.stack,
    });
  });
}
