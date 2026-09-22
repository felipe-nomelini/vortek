import type { createServiceClient } from '@/lib/supabase';
import { evaluateScheduledTaskHealth } from './registry';
import type { SupplierSyncHealth } from '@/types/fornecedores';

export type SupplierSyncSource = 'dslite' | 'evolusom';

export type EvolusomSyncTimes = {
  catalogAt: string | null;
  priceStockAt: string | null;
};

export async function loadEvolusomSyncTimes(
  client: ReturnType<typeof createServiceClient>,
): Promise<EvolusomSyncTimes> {
  const latest = async (tipo: string) => {
    const { data, error } = await client.from('jobs')
      .select('finished_at')
      .eq('tipo', tipo)
      .eq('status', 'completo')
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Falha ao consultar sincronização Evolusom: ${error.message}`);
    return data?.finished_at || null;
  };

  const [catalogAt, priceStockAt] = await Promise.all([
    latest('sync_evolusom_catalogo'),
    latest('sync_evolusom_preco_estoque'),
  ]);
  return { catalogAt, priceStockAt };
}

export function resolveSupplierSync(input: {
  supplierId: string | null;
  dsliteLastSyncAt: string | null;
  evolusomTimes: EvolusomSyncTimes | null;
  dsliteIntervalMinutes: number;
  evolusomIntervalMinutes: number;
  nowMs?: number;
}): { lastSyncAt: string | null; source: SupplierSyncSource; health: SupplierSyncHealth } {
  const directEvolusom = input.supplierId === '133' && input.evolusomTimes !== null;
  const times = input.evolusomTimes;
  const lastSyncAt = directEvolusom
    ? times?.catalogAt && times.priceStockAt
      ? (times.catalogAt < times.priceStockAt ? times.catalogAt : times.priceStockAt)
      : null
    : input.dsliteLastSyncAt;
  const intervalMinutes = directEvolusom
    ? input.evolusomIntervalMinutes
    : input.dsliteIntervalMinutes;
  const state = evaluateScheduledTaskHealth({
    intervalMinutes,
    lastRunAt: lastSyncAt,
    nowMs: input.nowMs,
  }).state;
  return {
    lastSyncAt,
    source: directEvolusom ? 'evolusom' : 'dslite',
    health: state === 'healthy' ? 'healthy' : state === 'stale' ? 'attention' : 'unknown',
  };
}

export function applySupplierSyncView<T extends {
  sync_last_at: string | null;
  sync_health: SupplierSyncHealth;
}>(
  rows: T[],
  freshness: string | null,
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): T[] {
  const filtered = rows.filter((supplier) =>
    freshness === 'healthy' ? supplier.sync_health === 'healthy'
      : freshness === 'attention' ? supplier.sync_health !== 'healthy' : true);
  if (sortBy === 'dslite_ultima_sync') {
    filtered.sort((left, right) => {
      if (!left.sync_last_at) return 1;
      if (!right.sync_last_at) return -1;
      return sortOrder === 'asc'
        ? left.sync_last_at.localeCompare(right.sync_last_at)
        : right.sync_last_at.localeCompare(left.sync_last_at);
    });
  }
  return filtered;
}
