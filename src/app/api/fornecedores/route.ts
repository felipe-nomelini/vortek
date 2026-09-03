import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { isBlockedDropshippingDsliteSupplier } from '@/lib/dslite/supplier-policy';
import { createServiceClient } from '@/lib/supabase';
import {
  evaluateScheduledTaskHealth,
  getIntervalMinutesForTask,
  getSaoPauloHour,
  getSyncTaskByKey,
} from '@/lib/sync/registry';
import type {
  FornecedorListItem,
  FornecedorSortKey,
  FornecedoresListResponse,
  SupplierSyncHealth,
} from '@/types/fornecedores';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const LIST_FIELDS = 'id,dslite_id,apelido,nome,cnpj,email,telefone,status_dslite,crossdocking,dropshipping,ativo,dslite_ultima_sync';
const SUMMARY_FIELDS = 'ativo,dslite_ultima_sync,status_dslite,crossdocking,dropshipping';

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

type SupplierListRow = Omit<FornecedorListItem, 'activation_blocked' | 'sync_health'>;
type SupplierSummaryRow = Pick<
  SupplierListRow,
  'ativo' | 'dslite_ultima_sync' | 'status_dslite' | 'crossdocking' | 'dropshipping'
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

function syncHealth(value: string | null, intervalMinutes: number): SupplierSyncHealth {
  const health = evaluateScheduledTaskHealth({ intervalMinutes, lastRunAt: value });
  if (health.state === 'healthy') return 'healthy';
  if (health.state === 'stale') return 'attention';
  return 'unknown';
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
    const staleThresholdMinutes = evaluateScheduledTaskHealth({
      intervalMinutes: effectiveIntervalMinutes,
      lastRunAt: null,
    }).staleThresholdMinutes;
    const staleCutoff = new Date(Date.now() - staleThresholdMinutes * 60_000).toISOString();
    const supabase = createServiceClient();

    let countQuery = supabase.from('fornecedores').select('id', { count: 'exact', head: true });
    let dataQuery = supabase
      .from('fornecedores')
      .select(LIST_FIELDS)
      .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
      .range(start, end);

    if (search) {
      const searchFilter = `dslite_id.ilike.%${search}%,apelido.ilike.%${search}%,nome.ilike.%${search}%,cnpj.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%`;
      countQuery = countQuery.or(searchFilter);
      dataQuery = dataQuery.or(searchFilter);
    }
    if (statusDslite) {
      countQuery = countQuery.eq('status_dslite', statusDslite);
      dataQuery = dataQuery.eq('status_dslite', statusDslite);
    }
    if (crossdocking) {
      countQuery = countQuery.eq('crossdocking', crossdocking);
      dataQuery = dataQuery.eq('crossdocking', crossdocking);
    }
    if (dropshipping) {
      countQuery = countQuery.eq('dropshipping', dropshipping);
      dataQuery = dataQuery.eq('dropshipping', dropshipping);
    }
    if (operationalStatus === 'active') {
      countQuery = countQuery.eq('ativo', true);
      dataQuery = dataQuery.eq('ativo', true);
    }
    if (operationalStatus === 'inactive') {
      countQuery = countQuery.eq('ativo', false);
      dataQuery = dataQuery.eq('ativo', false);
    }
    if (freshness === 'healthy') {
      countQuery = countQuery.gte('dslite_ultima_sync', staleCutoff);
      dataQuery = dataQuery.gte('dslite_ultima_sync', staleCutoff);
    }
    if (freshness === 'attention') {
      const freshnessFilter = `dslite_ultima_sync.is.null,dslite_ultima_sync.lt.${staleCutoff}`;
      countQuery = countQuery.or(freshnessFilter);
      dataQuery = dataQuery.or(freshnessFilter);
    }

    const [countResult, dataResult, summaryResult] = await Promise.all([
      countQuery,
      dataQuery,
      supabase.from('fornecedores').select(SUMMARY_FIELDS),
    ]);

    if (countResult.error || dataResult.error || summaryResult.error) {
      return NextResponse.json(
        { error: 'Não foi possível carregar os fornecedores' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const allRows = (summaryResult.data || []) as SupplierSummaryRow[];
    const response: FornecedoresListResponse = {
      data: ((dataResult.data || []) as SupplierListRow[]).map((supplier) => ({
        ...supplier,
        activation_blocked: isBlockedDropshippingDsliteSupplier(supplier.dslite_id),
        sync_health: syncHealth(supplier.dslite_ultima_sync, effectiveIntervalMinutes),
      })),
      total: countResult.count || 0,
      page,
      limit,
      summary: {
        total: allRows.length,
        active: allRows.filter((supplier) => supplier.ativo !== false).length,
        inactive: allRows.filter((supplier) => supplier.ativo === false).length,
        sync_attention: allRows.filter((supplier) => syncHealth(supplier.dslite_ultima_sync, effectiveIntervalMinutes) !== 'healthy').length,
        last_sync_at: allRows
          .map((supplier) => supplier.dslite_ultima_sync)
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
