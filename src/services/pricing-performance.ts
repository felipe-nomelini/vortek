import 'server-only';

import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { loadPricingOverrides } from '@/services/pricing-overrides';
import {
  buildPricingPerformanceWindows,
  parseMlVisitWindow,
  performancePeriod,
  saoPauloDateKey,
  shiftDateKey,
  type MlVisitPoint,
  type PerformanceSale,
  type PricingPerformanceWindow,
  type VisitCoverage,
} from '@/lib/ml/pricing-performance';

type PerformanceScope = 'listing' | 'verified_group';

export type PricingPerformanceResponse = {
  scope: PerformanceScope;
  group: { id: string; version: number } | null;
  itemIds: string[];
  selectedItemId: string;
  asOf: string;
  updatedAt: string | null;
  stale: boolean;
  visitSemantics: 'listing_visits' | 'summed_listing_visits';
  windows: PricingPerformanceWindow[];
  warnings: string[];
};

type CoverageRow = {
  ml_item_id: string;
  coverage_start: string | null;
  coverage_end: string | null;
  complete: boolean;
  last_success_at: string | null;
  last_error_code: string | null;
};

const PAGE_SIZE = 1000;
const VISIT_REFRESH_CONCURRENCY = 3;

function errorCode(value: unknown): string {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized.slice(0, 120) || 'ml_visit_window_unavailable';
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function loadCoverage(client: ReturnType<typeof createServiceClient>, sellerId: number, itemIds: string[]) {
  const { data, error } = await (client as any)
    .from('ml_listing_visit_coverage')
    .select('ml_item_id,coverage_start,coverage_end,complete,last_success_at,last_error_code')
    .eq('seller_id', sellerId)
    .in('ml_item_id', itemIds);
  if (error) throw new Error('performance_coverage_read_failed');
  return (data || []) as CoverageRow[];
}

function hasCoverage(row: CoverageRow | undefined, start: string, end: string) {
  return Boolean(row?.complete && row.coverage_start && row.coverage_end
    && row.coverage_start <= start && row.coverage_end >= end);
}

async function persistVisitFailure(input: {
  client: ReturnType<typeof createServiceClient>;
  sellerId: number;
  itemId: string;
  start: string;
  end: string;
  collectedAt: string;
  code: string;
}) {
  await (input.client as any).rpc('persist_ml_listing_visit_window', {
    p_seller_id: input.sellerId,
    p_item_id: input.itemId,
    p_range_start: input.start,
    p_range_end: input.end,
    p_complete: false,
    p_points: [],
    p_collected_at: input.collectedAt,
    p_error_code: errorCode(input.code),
  });
}

async function refreshVisitWindow(input: {
  client: ReturnType<typeof createServiceClient>;
  sellerId: number;
  itemId: string;
  start: string;
  end: string;
}): Promise<{ ok: boolean; warning: string | null }> {
  const collectedAt = new Date().toISOString();
  const inclusiveEnd = shiftDateKey(input.end, -1);
  const path = `/items/${encodeURIComponent(input.itemId)}/visits/time_window?last=149&unit=day&ending=${encodeURIComponent(inclusiveEnd)}`;
  const result = await fetchMLResult<any>(path);
  if (!result.ok || !result.data) {
    await persistVisitFailure({ ...input, collectedAt, code: result.error?.code || result.error?.category || 'ml_visit_window_unavailable' });
    return { ok: false, warning: `Não foi possível atualizar as visitas de ${input.itemId}.` };
  }
  const parsed = parseMlVisitWindow({
    itemId: input.itemId,
    payload: result.data,
    expectedStart: input.start,
    expectedEnd: input.end,
  });
  if (!parsed.complete) {
    await persistVisitFailure({ ...input, collectedAt, code: 'ml_visit_window_incomplete' });
    return { ok: false, warning: `O Mercado Livre não enviou o período completo de ${input.itemId}.` };
  }
  const { error } = await (input.client as any).rpc('persist_ml_listing_visit_window', {
    p_seller_id: input.sellerId,
    p_item_id: input.itemId,
    p_range_start: input.start,
    p_range_end: input.end,
    p_complete: true,
    p_points: parsed.points.map((point) => ({ date: point.date, visits: point.visits })),
    p_collected_at: collectedAt,
    p_error_code: null,
  });
  if (error) throw new Error('performance_visit_persist_failed');
  return { ok: true, warning: null };
}

async function loadVisitPoints(input: {
  client: ReturnType<typeof createServiceClient>;
  sellerId: number;
  itemIds: string[];
  start: string;
  end: string;
}): Promise<MlVisitPoint[]> {
  const { data, error } = await (input.client as any)
    .from('ml_listing_visit_days')
    .select('ml_item_id,metric_date,visits')
    .eq('seller_id', input.sellerId)
    .in('ml_item_id', input.itemIds)
    .gte('metric_date', input.start)
    .lt('metric_date', input.end)
    .order('metric_date', { ascending: true });
  if (error) throw new Error('performance_visits_read_failed');
  return (data || []).map((row: any) => ({
    itemId: String(row.ml_item_id),
    date: String(row.metric_date),
    visits: Number(row.visits),
  }));
}

function nestedPedido(value: any): any | null {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

async function loadSales(input: {
  client: ReturnType<typeof createServiceClient>;
  itemIds: string[];
  startIso: string;
  endIso: string;
}): Promise<{ rows: PerformanceSale[]; complete: boolean }> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await (input.client as any)
      .from('pedido_itens')
      .select('id,ml_item_id,quantidade,valor_total_liquido,frete_rateado_item,pedido:pedidos!inner(id,ml_order_id,buyer_ml_id,situacao,data_venda)')
      .in('ml_item_id', input.itemIds)
      .gte('pedido.data_venda', input.startIso)
      .lt('pedido.data_venda', input.endIso)
      .neq('pedido.situacao', 'cancelado')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error('performance_sales_read_failed');
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  let complete = true;
  const normalized = rows.flatMap((row): PerformanceSale[] => {
    const pedido = nestedPedido(row.pedido);
    const quantity = Number(row.quantidade);
    const net = Number(row.valor_total_liquido);
    const freight = Number(row.frete_rateado_item || 0);
    const orderId = String(pedido?.ml_order_id || pedido?.id || '').trim();
    const itemId = String(row.ml_item_id || '').trim();
    const soldAt = pedido?.data_venda ? new Date(pedido.data_venda) : null;
    if (!pedido || !orderId || !itemId || !Number.isSafeInteger(quantity) || quantity <= 0
      || !Number.isFinite(net) || !Number.isFinite(freight) || net - freight < 0
      || !soldAt || Number.isNaN(soldAt.getTime())) {
      complete = false;
      return [];
    }
    return [{
      orderId,
      itemId,
      soldAt: saoPauloDateKey(soldAt),
      quantity,
      revenueCents: Math.round((net - freight) * 100),
      buyerId: String(pedido.buyer_ml_id || '').trim() || null,
    }];
  });
  return { rows: normalized, complete };
}

async function loadSalesCoverageStart(client: ReturnType<typeof createServiceClient>): Promise<string | null> {
  const { data, error } = await client
    .from('pedidos')
    .select('data_venda')
    .not('data_venda', 'is', null)
    .order('data_venda', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('performance_sales_coverage_read_failed');
  return data?.data_venda ? saoPauloDateKey(new Date(data.data_venda)) : null;
}

function effectiveEndDate(currentEnd: string, itemIds: string[], coverage: CoverageRow[]): string {
  const currentStart = shiftDateKey(currentEnd, -150);
  if (itemIds.every((itemId) => hasCoverage(coverage.find((row) => row.ml_item_id === itemId), currentStart, currentEnd))) {
    return currentEnd;
  }
  const ends = itemIds.map((itemId) => coverage.find((row) => row.ml_item_id === itemId))
    .filter((row): row is CoverageRow => Boolean(row?.complete && row.coverage_end))
    .map((row) => row.coverage_end!);
  if (ends.length !== itemIds.length) return currentEnd;
  const candidate = [...ends].sort()[0];
  const candidateStart = shiftDateKey(candidate, -150);
  return itemIds.every((itemId) => hasCoverage(coverage.find((row) => row.ml_item_id === itemId), candidateStart, candidate))
    ? candidate
    : currentEnd;
}

export async function loadPricingPerformance(input: {
  produtoId: string;
  mlItemId: string;
  forceRefresh?: boolean;
}): Promise<PricingPerformanceResponse> {
  const client = createServiceClient();
  const [{ data: product, error: productError }, { data: listing, error: listingError }] = await Promise.all([
    client.from('produtos').select('id').eq('id', input.produtoId).maybeSingle(),
    client.from('anuncios_ml').select('ml_item_id,produto_id').eq('ml_item_id', input.mlItemId).maybeSingle(),
  ]);
  if (productError || listingError) throw new Error('performance_binding_read_failed');
  if (!product) throw new Error('performance_product_not_found');
  if (!listing || listing.produto_id !== product.id) throw new Error('performance_listing_mismatch');

  const me = await fetchMLResult<any>('/users/me');
  if (!me.ok || !me.data?.id || me.data.site_id !== 'MLB') throw new Error('performance_ml_account_unavailable');
  const sellerId = Number(me.data.id);
  if (!Number.isSafeInteger(sellerId) || sellerId <= 0) throw new Error('performance_ml_account_unavailable');
  const ownedItem = await fetchMLResult<any>(`/items/${encodeURIComponent(input.mlItemId)}`);
  if (!ownedItem.ok || !ownedItem.data) throw new Error('performance_listing_unavailable');
  if (String(ownedItem.data.id || '') !== input.mlItemId || Number(ownedItem.data.seller_id) !== sellerId) {
    throw new Error('performance_listing_owner_mismatch');
  }

  const protection = await loadPricingOverrides(client, product.id)
    .catch(() => ({ status: 'unavailable' as const, groups: [] }));
  const matchingGroups = protection.groups.filter((group) => (
    group.sellerId === sellerId
    && group.state !== 'retired'
    && group.members.some((member) => member.itemId === input.mlItemId)
  ));
  const verifiedGroups = matchingGroups.filter((group) => group.state === 'verified');
  const verifiedGroup = verifiedGroups.length === 1 ? verifiedGroups[0] : null;
  const itemIds = verifiedGroup
    ? [...new Set(verifiedGroup.members.map((member) => member.itemId))].sort()
    : [input.mlItemId];
  const warnings: string[] = [];
  if (!verifiedGroup && matchingGroups.length > 0) {
    warnings.push('O vínculo com outros anúncios ainda não foi confirmado. Esta análise considera somente o anúncio selecionado.');
  }

  const currentEnd = saoPauloDateKey();
  const requestedStart = shiftDateKey(currentEnd, -150);
  const before = await loadCoverage(client, sellerId, itemIds);
  const refreshTargets = itemIds.filter((itemId) => input.forceRefresh
    || !hasCoverage(before.find((row) => row.ml_item_id === itemId), requestedStart, currentEnd));
  const refreshResults = await mapWithConcurrency(refreshTargets, VISIT_REFRESH_CONCURRENCY, (itemId) => refreshVisitWindow({
    client,
    sellerId,
    itemId,
    start: requestedStart,
    end: currentEnd,
  }));
  for (const result of refreshResults) if (result.warning) warnings.push(result.warning);

  const coverageRows = await loadCoverage(client, sellerId, itemIds);
  const endDate = effectiveEndDate(currentEnd, itemIds, coverageRows);
  const period150 = performancePeriod(150, endDate);
  const [visitPoints, salesResult, salesCoverageStart] = await Promise.all([
    loadVisitPoints({ client, sellerId, itemIds, start: period150.startDate, end: endDate }),
    loadSales({ client, itemIds, startIso: period150.periodStart, endIso: period150.periodEnd }),
    loadSalesCoverageStart(client),
  ]);
  if (!salesResult.complete) warnings.push('Algumas vendas não possuem dados suficientes para o cálculo.');
  const visitCoverages: VisitCoverage[] = coverageRows.map((row) => ({
    itemId: row.ml_item_id,
    complete: row.complete,
    start: row.coverage_start,
    end: row.coverage_end,
  }));
  const updatedAt = itemIds.map((itemId) => coverageRows.find((row) => row.ml_item_id === itemId)?.last_success_at || '')
    .filter(Boolean)
    .sort()[0] || null;
  const stale = endDate !== currentEnd;
  if (stale) warnings.push(`Exibindo a última leitura completa, encerrada em ${endDate}.`);

  return {
    scope: verifiedGroup ? 'verified_group' : 'listing',
    group: verifiedGroup ? { id: verifiedGroup.id, version: verifiedGroup.version } : null,
    itemIds,
    selectedItemId: input.mlItemId,
    asOf: endDate,
    updatedAt,
    stale,
    visitSemantics: verifiedGroup ? 'summed_listing_visits' : 'listing_visits',
    windows: buildPricingPerformanceWindows({
      endDate,
      itemIds,
      visitPoints,
      visitCoverages,
      sales: salesResult.rows,
      salesCoverageStart,
      salesDataComplete: salesResult.complete,
    }),
    warnings: [...new Set(warnings)],
  };
}
