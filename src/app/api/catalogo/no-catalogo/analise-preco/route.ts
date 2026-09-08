import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { POST as refreshNoCatalogSnapshot } from '@/app/api/catalogo/no-catalogo/refresh/route';
import { loadProductPricing, loadPricingRequestContext, type ProductPricing } from '@/services/pricing-context';
import { loadPricingTaxContext, requirePricingTaxRate } from '@/services/pricing-tax-context';
import { loadCommercialPricingConfiguration } from '@/services/commercial-pricing-configuration';
import { resolveMlFee } from '@/lib/commercial-pricing';
import { assessCompetitivePricing, type CompetitiveClassification } from '@/services/pricing-competition';

type SnapshotRow = Pick<
  Database['public']['Tables']['catalogo_ml_snapshot']['Row'],
  'ml_item_id' | 'title' | 'sku_local' | 'produto_id' | 'status' | 'catalog_listing' | 'buy_box_winning' | 'price' | 'price_to_win' | 'permalink'
>;

type ProdutoRow = Database['public']['Tables']['produtos']['Row'];

type ClasseAnalise = CompetitiveClassification;

interface AnaliseRow {
  ml_item_id: string;
  permalink: string | null;
  titulo: string;
  sku_local: string | null;
  produto_id: string | null;
  preco_atual: number;
  price_to_win: number | null;
  preco_piso_sem_prejuizo: number | null;
  preco_recomendado: number | null;
  delta_preco: number | null;
  lucro_unitario_estimado: number | null;
  classe: ClasseAnalise;
  motivo: string;
}

const PAGE_SIZE = 1000;
const SUPABASE_IN_CHUNK_SIZE = 100;
type RefreshMode = 'none' | 'incremental' | 'full';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classPriority(classe: ClasseAnalise): number {
  if (classe === 'VIAVEL_NO_ALVO' || classe === 'VIAVEL_ACIMA_DO_PISO') return 0;
  if (classe !== 'INCONCLUSIVO') return 1;
  return 2;
}

async function runRefresh(request: Request, mode: 'incremental' | 'full') {
  const refreshUrl = new URL('/api/catalogo/no-catalogo/refresh', request.url);
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const apiKey = process.env.API_SECRET_KEY;
  if (apiKey) headers.set('x-api-key', apiKey);

  const refreshReq = new Request(refreshUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode }),
  });

  const refreshRes = await refreshNoCatalogSnapshot(refreshReq);
  const refreshBody = await refreshRes.json().catch(() => null);
  const warnings = Array.isArray(refreshBody?.warnings) ? refreshBody.warnings : [];
  const status = warnings.length > 0 ? 'completo_parcial' : 'completo';

  return {
    ok: refreshRes.ok && refreshBody?.success !== false,
    status,
    body: refreshBody,
    httpStatus: refreshRes.status,
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let refreshMs = 0;
  let snapshotQueryMs = 0;
  let maxSyncedQueryMs = 0;
  let produtosQueryMs = 0;
  let calculationMs = 0;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sellerIdRaw = body?.sellerId;
  const sellerId = sellerIdRaw === undefined || sellerIdRaw === null ? null : Number(sellerIdRaw);
  const refreshMode: RefreshMode = body?.refreshMode === 'full'
    ? 'full'
    : body?.refreshMode === 'incremental'
      ? 'incremental'
      : 'none';

  const refreshStartedAt = Date.now();
  const refresh = refreshMode === 'none'
    ? {
      ok: true,
      status: 'skipped',
      body: { success: true, skipped: true, reason: 'using_local_snapshot' },
      httpStatus: 200,
    }
    : await runRefresh(request, refreshMode);
  refreshMs = Date.now() - refreshStartedAt;

  if (!refresh.ok) {
    return NextResponse.json({
      success: false,
      erro: refresh.body?.error || refresh.body?.erro || 'Falha no refresh do catálogo',
      refresh,
    }, { status: refresh.httpStatus || 500 });
  }

  const service = createServiceClient();
  const requestContext = await loadPricingRequestContext(service);
  const snapshotRows: SnapshotRow[] = [];
  let snapshotMaxSyncedAt: string | null = null;
  let from = 0;

  const snapshotQueryStartedAt = Date.now();
  while (true) {
    const to = from + PAGE_SIZE - 1;
    let query: any = service
      .from('catalogo_ml_snapshot')
      .select('ml_item_id,title,sku_local,produto_id,status,catalog_listing,buy_box_winning,price,price_to_win,permalink')
      .eq('catalog_listing', true)
      .eq('status', 'active')
      .eq('buy_box_winning', false)
      .range(from, to);

    if (sellerId !== null && Number.isFinite(sellerId)) {
      query = query.eq('seller_id', sellerId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, erro: error.message }, { status: 500 });
    }

    const chunk = (data || []) as SnapshotRow[];
    snapshotRows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  snapshotQueryMs = Date.now() - snapshotQueryStartedAt;

  const maxSyncedQueryStartedAt = Date.now();
  const maxSyncedQuery = service
    .from('catalogo_ml_snapshot')
    .select('synced_at')
    .eq('catalog_listing', true)
    .eq('status', 'active')
    .order('synced_at', { ascending: false, nullsFirst: false })
    .limit(1);

  if (sellerId !== null && Number.isFinite(sellerId)) {
    maxSyncedQuery.eq('seller_id', sellerId);
  }

  const { data: maxSyncedRows } = await maxSyncedQuery;
  maxSyncedQueryMs = Date.now() - maxSyncedQueryStartedAt;
  snapshotMaxSyncedAt = String(maxSyncedRows?.[0]?.synced_at || '').trim() || null;
  const snapshotAgeSeconds = snapshotMaxSyncedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(snapshotMaxSyncedAt).getTime()) / 1000))
    : null;

  const produtoIds = Array.from(new Set(snapshotRows.map((row) => row.produto_id).filter((id): id is string => Boolean(id))));
  const produtoMap = new Map<string, ProdutoRow>();

  const produtosQueryStartedAt = Date.now();
  for (let i = 0; i < produtoIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    const idsChunk = produtoIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE);
    const { data, error } = await service
      .from('produtos')
      .select('*')
      .in('id', idsChunk);
    if (error) {
      return NextResponse.json({ success: false, erro: error.message }, { status: 500 });
    }
    for (const row of (data || []) as ProdutoRow[]) {
      produtoMap.set(row.id, row);
    }
  }
  produtosQueryMs = Date.now() - produtosQueryStartedAt;

  const calculationStartedAt = Date.now();
  const pricingByListing = new Map<string, ProductPricing>();
  // Agrupa anúncios sem repetir produto no mesmo lote; custo/configuração nunca são calculados no browser.
  const pending = [...snapshotRows];
  while (pending.length) {
    const group: SnapshotRow[] = []; const ids = new Set<string>();
    for (let i = 0; i < pending.length && group.length < 100;) {
      const row = pending[i];
      if (!row.produto_id || !produtoMap.has(row.produto_id)) { pending.splice(i, 1); continue; }
      if (ids.has(row.produto_id)) { i++; continue; }
      ids.add(row.produto_id); group.push(row); pending.splice(i, 1);
    }
    if (!group.length) break;
    const products = group.map(row => produtoMap.get(row.produto_id!)!);
    const evidence = new Map(group.map(row => [row.produto_id!, { mlItemId: row.ml_item_id,
      currentPriceCents: row.price_to_win == null ? null : Math.round(Number(row.price_to_win) * 100),
      marketContextKey: `listing:${row.ml_item_id}:competitive:unquoted` }]));
    const pricing = await loadProductPricing(service, products, { requestContext, evidence });
    for (const row of group) pricingByListing.set(row.ml_item_id, pricing.get(row.produto_id!)!);
  }
  const report: AnaliseRow[] = snapshotRows.map(row => {
    const p = pricingByListing.get(row.ml_item_id);
    const memory = p?.current.memory;
    const priceToWin = toFiniteNumber(row.price_to_win);
    const competitiveAssessment = assessCompetitivePricing({ pricing: p ?? null, competitive: p?.current ?? null,
      evidence: { itemId: row.ml_item_id, catalogProductId: null, observedAt: snapshotMaxSyncedAt || '',
        condition: 'stale', priceCents: priceToWin === null ? null : Math.round(priceToWin * 100),
        currentPriceCents: Math.round(Number(row.price) * 100), status: null },
      evaluatedAt: requestContext.evaluatedAt });
    return {
      ml_item_id: row.ml_item_id, permalink: row.permalink || null, titulo: row.title || '',
      sku_local: row.sku_local, produto_id: row.produto_id, preco_atual: Number(row.price || 0),
      price_to_win: priceToWin, preco_piso_sem_prejuizo: p?.breakEven.ok ? p.breakEven.priceCents / 100 : null,
      preco_recomendado: null,
      delta_preco: priceToWin === null ? null : round2(priceToWin - Number(row.price || 0)),
      lucro_unitario_estimado: memory ? memory.resultCents / 100 : null,
      classe: competitiveAssessment.classification,
      motivo: competitiveAssessment.reasons[0], competitiveAssessment,
      pricing: p || null,
    };
  });
  // Ausência de evidência e margem baixa permanecem visíveis; não há piso universal.
  const filtered = report;

  const sorted = [...filtered].sort((a, b) => {
    const priorityDiff = classPriority(a.classe) - classPriority(b.classe);
    if (priorityDiff !== 0) return priorityDiff;
    const aDelta = Math.abs(a.delta_preco || 0);
    const bDelta = Math.abs(b.delta_preco || 0);
    if (bDelta !== aDelta) return bDelta - aDelta;
    return a.ml_item_id.localeCompare(b.ml_item_id);
  });

  const classes = sorted.reduce((acc, row) => {
    acc[row.classe] = (acc[row.classe] || 0) + 1;
    return acc;
  }, {} as Record<ClasseAnalise, number>);
  calculationMs = Date.now() - calculationStartedAt;

  console.log(JSON.stringify({
    event: 'catalog_no_catalogo_analise_preco_performance',
    timestamp_utc: new Date().toISOString(),
    refresh_mode: refreshMode,
    refresh_status: refresh.status,
    seller_id: sellerId,
    snapshot_rows: snapshotRows.length,
    produto_ids: produtoIds.length,
    produtos_loaded: produtoMap.size,
    report_rows_before_filter: report.length,
    returned_rows: sorted.length,
    durations_ms: {
      refresh: refreshMs,
      snapshot_query: snapshotQueryMs,
      max_synced_query: maxSyncedQueryMs,
      produtos_query: produtosQueryMs,
      calculation: calculationMs,
      total: Date.now() - startedAt,
    },
  }));

  return NextResponse.json({
    success: true,
    refresh: {
      status: refresh.status,
      mode: refreshMode,
      details: refresh.body,
    },
    snapshot_max_synced_at: snapshotMaxSyncedAt,
    snapshot_age_seconds: snapshotAgeSeconds,
    total_analisado: sorted.length,
    preliminary: true,
    notice: 'Triagem por anúncio/snapshot, não oportunidades aprovadas nem contagem de grupos. Consulte a disputa para revalidar as fontes.',
    classes,
    data: sorted,
  });
}
