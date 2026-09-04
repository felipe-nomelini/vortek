import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  claimResponsibleLabel,
  claimStageLabel,
  claimStatusLabel,
  claimTypeLabel,
  classifyClaimPriority,
  compareClaimPriority,
  normalizeClaimAvailableActions,
  type ClaimListItem,
  type ClaimResponsible,
  type ClaimsListResponse,
} from '@/lib/ml/claims';
import { loadClaimsVisualReview, visualReviewMeta } from '@/lib/ml/claims-visual-review';
import { createServiceClient } from '@/lib/supabase';
import { saoPauloDayBounds } from '@/lib/timezone';
import { fetchMLResult, getMLConnectionStatus } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET_PLUS_LIMIT = 9999;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

type RawClaimAction = { action?: unknown; mandatory?: unknown; due_date?: unknown };
type RawClaimPlayer = {
  role?: unknown;
  type?: unknown;
  user_id?: unknown;
  available_actions?: RawClaimAction[];
};
type RawClaim = {
  id?: unknown;
  resource_id?: unknown;
  resource?: unknown;
  status?: unknown;
  type?: unknown;
  stage?: unknown;
  reason_id?: unknown;
  claimed_quantity?: unknown;
  players?: RawClaimPlayer[];
  resolution?: unknown;
  date_created?: unknown;
  last_updated?: unknown;
  related_entities?: unknown;
};
type RawClaimDetail = {
  due_date?: unknown;
  action_responsible?: unknown;
  title?: unknown;
  description?: unknown;
  problem?: unknown;
};
type ClaimSearchResponse = {
  paging?: { total?: unknown; offset?: unknown; limit?: unknown };
  data?: RawClaim[];
};
type ListFilters = {
  page: number;
  pageSize: number;
  status: string;
  type: string;
  stage: string;
  search: string;
};

function json(payload: ClaimsListResponse, status = 200) {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function allowedValue(value: string | null, allowed: Set<string>, fallback = ''): string {
  return value && allowed.has(value) ? value : fallback;
}

function parseFilters(request: Request): ListFilters {
  const params = new URL(request.url).searchParams;
  const pageSize = Math.min(MAX_PAGE_SIZE, positiveInteger(params.get('pageSize'), DEFAULT_PAGE_SIZE));
  const requestedPage = positiveInteger(params.get('page'), 1);
  const maxPage = Math.max(1, Math.floor((MAX_OFFSET_PLUS_LIMIT - pageSize) / pageSize) + 1);
  const search = (params.get('search') || '').trim();
  return {
    page: Math.min(requestedPage, maxPage),
    pageSize,
    status: allowedValue(params.get('status'), new Set(['opened', 'closed', 'all']), 'opened'),
    type: allowedValue(params.get('type'), new Set([
      'mediations', 'return', 'fulfillment', 'ml_case', 'cancel_sale', 'cancel_purchase', 'change', 'service',
    ])),
    stage: allowedValue(params.get('stage'), new Set(['claim', 'dispute', 'recontact', 'stale', 'none'])),
    search: /^\d{1,20}$/.test(search) ? search : '',
  };
}

function buildClaimsSearchPath(
  sellerId: string,
  filters: Partial<ListFilters> & { offset?: number; limit?: number; id?: string; orderId?: string; range?: string },
) {
  const params = new URLSearchParams({
    'players.user_id': sellerId,
    'players.role': 'respondent',
    resource: 'order',
    offset: String(filters.offset || 0),
    limit: String(filters.limit || 1),
    sort: 'last_updated:desc',
  });
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.id) params.set('id', filters.id);
  if (filters.orderId) params.set('order_id', filters.orderId);
  if (filters.range) params.set('range', filters.range);
  return `/post-purchase/v1/claims/search?${params.toString()}`;
}

async function searchClaims(path: string) {
  return fetchMLResult<ClaimSearchResponse>(path);
}

function pagingTotal(response: ClaimSearchResponse | null): number {
  return finiteNumber(response?.paging?.total) || 0;
}

function normalizeResponsible(value: unknown): ClaimResponsible {
  return value === 'seller' || value === 'buyer' || value === 'mediator' ? value : null;
}

function findSellerPlayer(claim: RawClaim, sellerId: string): RawClaimPlayer | undefined {
  return claim.players?.find((player) => (
    String(player.user_id || '') === sellerId
    && (player.role === 'respondent' || player.type === 'seller')
  ));
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function loadOrderContext(orderIds: string[]) {
  if (orderIds.length === 0) {
    return { orders: new Map<string, Record<string, unknown>>(), items: new Map<string, Record<string, unknown>[]>(), failed: false };
  }
  const client = createServiceClient();
  const [ordersResult, itemsResult] = await Promise.all([
    client.from('pedidos').select('ml_order_id,contato_nome,buyer_ml_id').in('ml_order_id', orderIds),
    client.from('pedido_itens').select('ml_order_id,ml_item_id,titulo,quantidade').in('ml_order_id', orderIds),
  ]);
  const orders = new Map<string, Record<string, unknown>>();
  const items = new Map<string, Record<string, unknown>[]>();
  if (!ordersResult.error) {
    for (const row of ordersResult.data || []) orders.set(String(row.ml_order_id), row as Record<string, unknown>);
  }
  if (!itemsResult.error) {
    for (const row of itemsResult.data || []) {
      const orderId = String(row.ml_order_id || '');
      if (!items.has(orderId)) items.set(orderId, []);
      items.get(orderId)!.push(row as Record<string, unknown>);
    }
  }
  if (ordersResult.error || itemsResult.error) {
    console.warn('[ml-claims] Contexto local parcialmente indisponível', {
      orders: ordersResult.error?.code || null,
      items: itemsResult.error?.code || null,
    });
  }
  return { orders, items, failed: Boolean(ordersResult.error || itemsResult.error) };
}

function filterFixture(items: ClaimListItem[], filters: ListFilters) {
  return items.filter((item) => {
    if (filters.status !== 'all' && item.status !== filters.status) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.stage && item.stage !== filters.stage) return false;
    return !filters.search || item.id === filters.search || item.order_id === filters.search;
  });
}

async function listVisualReview(filters: ListFilters): Promise<ClaimsListResponse | null> {
  const review = await loadClaimsVisualReview();
  if (!review) return null;
  const filtered = filterFixture(review.items, filters).sort(compareClaimPriority);
  const from = (filters.page - 1) * filters.pageSize;
  const items = filtered.slice(from, from + filters.pageSize);
  const { start, end } = saoPauloDayBounds();
  return {
    conectado: true,
    precisaReconectar: false,
    items,
    paging: { total: filtered.length, page: filters.page, page_size: filters.pageSize },
    summary: {
      opened: review.items.filter((item) => item.status === 'opened').length,
      due_on_page: items.filter((item) => item.status === 'opened' && Boolean(item.due_date)).length,
      dispute: review.items.filter((item) => item.status === 'opened' && item.stage === 'dispute').length,
      updated_today: review.items.filter((item) => {
        const updatedAt = Date.parse(item.last_updated || '');
        return Number.isFinite(updatedAt) && updatedAt >= start.getTime() && updatedAt < end.getTime();
      }).length,
    },
    updated_at: review.capturedAt,
    visual_review: visualReviewMeta(review),
  };
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;
  const filters = parseFilters(request);
  const rawSearch = (new URL(request.url).searchParams.get('search') || '').trim();
  if (rawSearch && !filters.search) {
    return NextResponse.json(
      { erro: 'Busque usando somente o número da reclamação ou da venda.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const visualReview = await listVisualReview(filters);
    if (visualReview) return json(visualReview);
    const connection = await getMLConnectionStatus();
    if (!connection.conectado) {
      return json({
        conectado: false,
        precisaReconectar: true,
        items: [],
        paging: { total: 0, page: filters.page, page_size: filters.pageSize },
        summary: { opened: 0, due_on_page: 0, dispute: 0, updated_today: 0 },
        updated_at: new Date().toISOString(),
        erro: connection.erro || 'Mercado Livre desconectado.',
      });
    }

    const meResult = await fetchMLResult<Record<string, unknown>>('/users/me');
    const sellerId = meResult.ok ? stringValue(meResult.data?.id) : null;
    if (!sellerId) {
      return json({
        conectado: true,
        precisaReconectar: meResult.error?.category === 'auth_fatal',
        items: [],
        paging: { total: 0, page: filters.page, page_size: filters.pageSize },
        summary: { opened: 0, due_on_page: 0, dispute: 0, updated_today: 0 },
        updated_at: new Date().toISOString(),
        erro: 'Não foi possível identificar o vendedor conectado.',
      }, 502);
    }

    const offset = (filters.page - 1) * filters.pageSize;
    const { start, end } = saoPauloDayBounds();
    const listPromise = filters.search
      ? Promise.all([
          searchClaims(buildClaimsSearchPath(sellerId, { ...filters, id: filters.search, offset: 0, limit: MAX_PAGE_SIZE })),
          searchClaims(buildClaimsSearchPath(sellerId, { ...filters, orderId: filters.search, offset: 0, limit: MAX_PAGE_SIZE })),
        ])
      : Promise.all([
          searchClaims(buildClaimsSearchPath(sellerId, { ...filters, offset, limit: filters.pageSize })),
        ]);
    const [listResults, openedResult, disputeResult, todayResult] = await Promise.all([
      listPromise,
      searchClaims(buildClaimsSearchPath(sellerId, { status: 'opened', limit: 1 })),
      searchClaims(buildClaimsSearchPath(sellerId, { status: 'opened', stage: 'dispute', limit: 1 })),
      searchClaims(buildClaimsSearchPath(sellerId, {
        limit: 1,
        range: `last_updated:after:${start.toISOString()},before:${end.toISOString()}`,
      })),
    ]);
    const failedList = listResults.find((result) => !result.ok);
    if (failedList && listResults.every((result) => !result.ok)) {
      return json({
        conectado: true,
        precisaReconectar: failedList.error?.category === 'auth_fatal',
        items: [],
        paging: { total: 0, page: filters.page, page_size: filters.pageSize },
        summary: { opened: 0, due_on_page: 0, dispute: 0, updated_today: 0 },
        updated_at: new Date().toISOString(),
        erro: 'Não foi possível consultar as reclamações no Mercado Livre.',
      }, 502);
    }

    const uniqueClaims = new Map<string, RawClaim>();
    for (const result of listResults) {
      if (!result.ok) continue;
      for (const claim of result.data?.data || []) {
        const id = stringValue(claim.id);
        if (id) uniqueClaims.set(id, claim);
      }
    }
    const allClaims = Array.from(uniqueClaims.values());
    const total = filters.search ? allClaims.length : pagingTotal(listResults[0].ok ? listResults[0].data : null);
    const pageClaims = filters.search ? allClaims.slice(offset, offset + filters.pageSize) : allClaims;

    let detailFailure = false;
    const details = await runPool(pageClaims, 5, async (claim) => {
      const id = stringValue(claim.id);
      if (!id) return null;
      const result = await fetchMLResult<RawClaimDetail>(`/post-purchase/v1/claims/${encodeURIComponent(id)}/detail`);
      if (!result.ok) detailFailure = true;
      return result.ok ? result.data : null;
    });
    const orderIds = pageClaims.map((claim) => stringValue(claim.resource_id)).filter((value): value is string => Boolean(value));
    const context = await loadOrderContext(orderIds);
    const now = new Date();
    const items = pageClaims.flatMap((claim, index): ClaimListItem[] => {
      const id = stringValue(claim.id);
      const orderId = stringValue(claim.resource_id);
      if (!id || !orderId || claim.resource !== 'order') return [];
      const detail = details[index];
      const availableActions = normalizeClaimAvailableActions(findSellerPlayer(claim, sellerId)?.available_actions);
      const responsible = normalizeResponsible(detail?.action_responsible);
      const dueDate = stringValue(detail?.due_date)
        || availableActions.find((action) => action.mandatory && action.due_date)?.due_date
        || null;
      const order = context.orders.get(orderId);
      const orderItems = context.items.get(orderId) || [];
      const firstItem = orderItems[0];
      const status = stringValue(claim.status);
      return [{
        id,
        order_id: orderId,
        customer_name: stringValue(order?.contato_nome),
        buyer_id: stringValue(order?.buyer_ml_id),
        item_id: stringValue(firstItem?.ml_item_id),
        item_title: stringValue(firstItem?.titulo),
        item_count: orderItems.length,
        type: stringValue(claim.type),
        type_label: claimTypeLabel(stringValue(claim.type)),
        stage: stringValue(claim.stage),
        stage_label: claimStageLabel(stringValue(claim.stage)),
        status,
        status_label: claimStatusLabel(status),
        reason_id: stringValue(claim.reason_id),
        problem: stringValue(detail?.problem),
        detail_title: stringValue(detail?.title),
        detail_description: stringValue(detail?.description),
        action_responsible: responsible,
        responsible_label: claimResponsibleLabel(responsible),
        due_date: dueDate,
        priority: classifyClaimPriority({ status, responsible, dueDate, now }),
        available_actions: availableActions,
        related_entities: Array.isArray(claim.related_entities) ? claim.related_entities.map(String) : [],
        resolution: claim.resolution && typeof claim.resolution === 'object' ? claim.resolution as Record<string, unknown> : null,
        claimed_quantity: finiteNumber(claim.claimed_quantity),
        date_created: stringValue(claim.date_created),
        last_updated: stringValue(claim.last_updated),
        context_available: Boolean(order || firstItem),
        is_homologation_fixture: false,
      }];
    }).sort(compareClaimPriority);

    const summaryFailed = !openedResult.ok || !disputeResult.ok || !todayResult.ok;
    return json({
      conectado: true,
      precisaReconectar: false,
      items,
      paging: { total, page: filters.page, page_size: filters.pageSize },
      summary: {
        opened: openedResult.ok ? pagingTotal(openedResult.data) : items.filter((item) => item.status === 'opened').length,
        due_on_page: items.filter((item) => item.status === 'opened' && Boolean(item.due_date)).length,
        dispute: disputeResult.ok ? pagingTotal(disputeResult.data) : items.filter((item) => item.status === 'opened' && item.stage === 'dispute').length,
        updated_today: todayResult.ok ? pagingTotal(todayResult.data) : 0,
      },
      updated_at: new Date().toISOString(),
      partial: context.failed || detailFailure || summaryFailed ? {
        order_context: context.failed || undefined,
        claim_details: detailFailure || undefined,
        summary: summaryFailed || undefined,
      } : undefined,
    });
  } catch (error) {
    console.error('[ml-claims] Falha ao carregar reclamações:', error);
    return json({
      conectado: true,
      precisaReconectar: false,
      items: [],
      paging: { total: 0, page: filters.page, page_size: filters.pageSize },
      summary: { opened: 0, due_on_page: 0, dispute: 0, updated_today: 0 },
      updated_at: new Date().toISOString(),
      erro: 'Falha ao carregar reclamações do Mercado Livre.',
    }, 500);
  }
}
