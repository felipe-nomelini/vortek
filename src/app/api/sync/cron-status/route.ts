import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getMLAuthDiagnostics } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TASKS = [
  { key: 'dslite_stock', tipo: 'sync_dslite_stock', label: 'DSLite Preço/Estoque', interval: (h: number) => (h >= 0 && h < 7 ? 20 : 10) },
  { key: 'dslite_catalog', tipo: 'sync_dslite_catalog', label: 'DSLite Catálogo', interval: (h: number) => (h >= 8 && h < 22 ? 120 : 240) },
  { key: 'ml_anuncios', tipo: 'sync_anuncios_ml', label: 'ML Anúncios', interval: () => 30 },
  { key: 'ml_pedidos', tipo: 'sync_pedidos_ml', label: 'ML Pedidos', interval: (h: number) => (h >= 8 && h < 23 ? 15 : 30) },
] as const;

function getSaoPauloHour() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  return Number(hour);
}

export async function GET() {
  const serviceClient = createServiceClient();
  const hour = getSaoPauloHour();
  const mlAuth = await getMLAuthDiagnostics();

  const rows = await Promise.all(TASKS.map(async (task) => {
    const { data: running } = await serviceClient
      .from('jobs')
      .select('id, status, created_at')
      .eq('tipo', task.tipo)
      .in('status', ['pendente', 'rodando'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: last } = await serviceClient
      .from('jobs')
      .select('id, status, created_at, finished_at')
      .eq('tipo', task.tipo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const interval = task.interval(hour);
    const nextRun = last?.finished_at
      ? new Date(new Date(last.finished_at).getTime() + interval * 60 * 1000).toISOString()
      : null;

    return {
      task: task.key,
      tipo: task.tipo,
      label: task.label,
      interval_minutes: interval,
      running: running || null,
      last: last || null,
      next_run_estimate: nextRun,
    };
  }));

  return NextResponse.json({
    success: true,
    timezone: 'America/Sao_Paulo',
    hour,
    ml_auth: mlAuth,
    tasks: rows,
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
