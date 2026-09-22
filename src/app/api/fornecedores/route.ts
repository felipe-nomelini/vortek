import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import {
  evaluateScheduledTaskHealth,
  getIntervalMinutesForTask,
  getSaoPauloHour,
  getSyncTaskByKey,
} from '@/lib/sync/registry';
import { applySupplierSyncView, loadEvolusomSyncTimes, resolveSupplierSync } from '@/lib/sync/supplier-freshness';
import type {
  FornecedorListItem,
  FornecedorSortKey,
  FornecedoresListResponse,
} from '@/types/fornecedores';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const LIST_FIELDS = 'id,dslite_id,apelido,nome,cnpj,email,telefone,status_dslite,crossdocking,dropshipping,ativo,dropshipping_retired_at,dslite_ultima_sync';
const SUMMARY_FIELDS = 'dslite_id,ativo,dslite_ultima_sync,status_dslite,crossdocking,dropshipping';

const allowedSortColumns = new Set<FornecedorSortKey>([
  'dslite_id',
  'apelido',
  'status_dslite',
  'crossdocking',
  'dropshipping',
  'nome',
  'cnpj',
  'email',
  'telefone',
  'dslite_ultima_sync',
  'created_at',
  'ativo',
]);

type SupplierListRow = Omit<FornecedorListItem, 'activation_blocked' | 'sync_health' | 'sync_last_at' | 'sync_source'>;
type SupplierSummaryRow = Pick<
  SupplierListRow,
  'dslite_id' | 'ativo' | 'dslite_ultima_sync' | 'status_dslite' | 'crossdocking' | 'dropshipping'
>;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSearch(value: string): string {
  return value.replace(/[,]/g, ' ').trim();
}

function uniqueValues(rows: SupplierSummaryRow[], key: 'status_dslite' | 'crossdocking' | 'dropshipping'): string[] {
  return Array.from(new Set(
    rows.map((row) => String(row[key] || '').trim()).filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, 'pt-BR'));
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const page = positiveInteger(searchParams.get('page'), 1);
    const limit = Math.min(PAGE_SIZE_MAX, positiveInteger(searchParams.get('limit'), PAGE_SIZE_DEFAULT));
    const start = (page - 1) * limit;
    const end = start + limit - 1;
    const search = normalizeSearch(searchParams.get('search') || '');
    const statusDslite = searchParams.get('status_dslite')?.trim() || '';
    const crossdocking = searchParams.get('crossdocking')?.trim() || '';
    const dropshipping = searchParams.get('dropshipping')?.trim() || '';
    const operationalStatus = searchParams.get('ativo');
    const freshness = searchParams.get('freshness');
    const requestedSort = searchParams.get('sortBy')?.trim() as FornecedorSortKey | undefined;
    const sortBy = requestedSort && allowedSortColumns.has(requestedSort) ? requestedSort : 'dslite_id';
    const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';

    const task = getSyncTaskByKey('sync_dslite_fornecedores');
    const intervalMinutes = task ? getIntervalMinutesForTask(task, getSaoPauloHour()) : null;
    const effectiveIntervalMinutes = intervalMinutes || 120;
    const evolusomTask = getSyncTaskByKey('sync_evolusom_preco_estoque');
    const evolusomIntervalMinutes = evolusomTask
      ? getIntervalMinutesForTask(evolusomTask, getSaoPauloHour()) || 2
      : 2;
    const staleThresholdMinutes = evaluateScheduledTaskHealth({
      intervalMinutes: effectiveIntervalMinutes,
      lastRunAt: null,
    }).staleThresholdMinutes;
    const supabase = createServiceClient();

    let dataQuery = supabase
      .from('fornecedores')
      .select(LIST_FIELDS)
      .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
      .range(0, 999);

    if (search) {
      const searchFilter = `dslite_id.ilike.%${search}%,apelido.ilike.%${search}%,nome.ilike.%${search}%,cnpj.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%`;
      dataQuery = dataQuery.or(searchFilter);
    }
    if (statusDslite) {
      dataQuery = dataQuery.eq('status_dslite', statusDslite);
    }
    if (crossdocking) {
      dataQuery = dataQuery.eq('crossdocking', crossdocking);
    }
    if (dropshipping) {
      dataQuery = dataQuery.eq('dropshipping', dropshipping);
    }
    if (operationalStatus === 'active') {
      dataQuery = dataQuery.eq('ativo', true);
    }
    if (operationalStatus === 'inactive') {
      dataQuery = dataQuery.eq('ativo', false);
    }

    const [dataResult, summaryResult, evolusomTimes] = await Promise.all([
      dataQuery,
      supabase.from('fornecedores').select(SUMMARY_FIELDS),
      process.env.EVOLUSOM_DIRECT_ENABLED === 'true'
        ? loadEvolusomSyncTimes(supabase)
        : Promise.resolve(null),
    ]);

    if (dataResult.error || summaryResult.error) {
      return NextResponse.json(
        { error: 'Não foi possível carregar os fornecedores' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const allRows = (summaryResult.data || []) as SupplierSummaryRow[];
    const syncFor = (supplier: SupplierSummaryRow) => resolveSupplierSync({
      supplierId: supplier.dslite_id || null,
      dsliteLastSyncAt: supplier.dslite_ultima_sync,
      evolusomTimes,
      dsliteIntervalMinutes: effectiveIntervalMinutes,
      evolusomIntervalMinutes,
    });
    const projectedRows = ((dataResult.data || []) as SupplierListRow[]).map((supplier) => {
      const sync = syncFor(supplier);
      return {
        ...supplier,
        activation_blocked: Boolean(supplier.dropshipping_retired_at),
        sync_last_at: sync.lastSyncAt,
        sync_source: sync.source,
        sync_health: sync.health,
      } satisfies FornecedorListItem;
    });
    const filteredRows = applySupplierSyncView(projectedRows, freshness, sortBy, sortOrder);
    const summarySync = allRows.map(syncFor);
    const response: FornecedoresListResponse = {
      data: filteredRows.slice(start, end + 1),
      total: filteredRows.length,
      page,
      limit,
      summary: {
        total: allRows.length,
        active: allRows.filter((supplier) => supplier.ativo !== false).length,
        inactive: allRows.filter((supplier) => supplier.ativo === false).length,
        sync_attention: summarySync.filter((sync) => sync.health !== 'healthy').length,
        last_sync_at: summarySync
          .map((sync) => sync.lastSyncAt)
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => right.localeCompare(left))[0] || null,
      },
      filters: {
        status_dslite: uniqueValues(allRows, 'status_dslite'),
        crossdocking: uniqueValues(allRows, 'crossdocking'),
        dropshipping: uniqueValues(allRows, 'dropshipping'),
      },
      sync_policy: {
        interval_minutes: effectiveIntervalMinutes,
        stale_threshold_minutes: staleThresholdMinutes,
      },
    };

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível carregar os fornecedores' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
