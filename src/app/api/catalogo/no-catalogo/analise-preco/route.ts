import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { buildCatalogPriceAnalysis, classPriority, type CatalogPriceAnalysisResult, type ClasseAnalise } from '@/lib/catalogo/price-analysis';
import { POST as refreshNoCatalogSnapshot } from '@/app/api/catalogo/no-catalogo/refresh/route';

type SnapshotRow = Pick<
  Database['public']['Tables']['catalogo_ml_snapshot']['Row'],
  'ml_item_id' | 'title' | 'sku_local' | 'produto_id' | 'status' | 'catalog_listing' | 'buy_box_winning' | 'price' | 'price_to_win' | 'permalink'
>;

type ProdutoRow = Pick<
  Database['public']['Tables']['produtos']['Row'],
  'id' | 'sku' | 'nome' | 'custo' | 'ml_fee' | 'ml_shipping' | 'custom_price'
>;

const DEFAULT_TOP_N = 50;
const MAX_TOP_N = 500;
const PAGE_SIZE = 1000;

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const topNRaw = Number(body?.topN ?? body?.top ?? DEFAULT_TOP_N);
  const topN = Number.isFinite(topNRaw) ? Math.min(MAX_TOP_N, Math.max(1, Math.floor(topNRaw))) : DEFAULT_TOP_N;
  const sellerIdRaw = body?.sellerId;
  const sellerId = sellerIdRaw === undefined || sellerIdRaw === null ? null : Number(sellerIdRaw);
  const refreshMode = body?.refreshMode === 'full' ? 'full' : 'incremental';

  const refresh = await runRefresh(request, refreshMode);
  if (!refresh.ok) {
    return NextResponse.json({
      success: false,
      erro: refresh.body?.error || refresh.body?.erro || 'Falha no refresh do catálogo',
      refresh,
    }, { status: refresh.httpStatus || 500 });
  }

  const service = createServiceClient();
  const snapshotRows: SnapshotRow[] = [];
  let from = 0;

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

  const produtoIds = Array.from(new Set(snapshotRows.map((row) => row.produto_id).filter((id): id is string => Boolean(id))));
  const produtoMap = new Map<string, ProdutoRow>();

  for (let i = 0; i < produtoIds.length; i += PAGE_SIZE) {
    const idsChunk = produtoIds.slice(i, i + PAGE_SIZE);
    const { data, error } = await service
      .from('produtos')
      .select('id,sku,nome,custo,ml_fee,ml_shipping,custom_price')
      .in('id', idsChunk);
    if (error) {
      return NextResponse.json({ success: false, erro: error.message }, { status: 500 });
    }
    for (const row of (data || []) as ProdutoRow[]) {
      produtoMap.set(row.id, row);
    }
  }

  const report: CatalogPriceAnalysisResult[] = snapshotRows.map((row) => {
    const produto = row.produto_id ? produtoMap.get(row.produto_id) : null;
    return buildCatalogPriceAnalysis({
      ml_item_id: row.ml_item_id,
      permalink: row.permalink || null,
      titulo: row.title || produto?.nome || '',
      sku_local: row.sku_local || produto?.sku || null,
      produto_id: row.produto_id || null,
      preco_atual: Number(row.price || 0),
      price_to_win: row.price_to_win ?? null,
      produto_nome: produto?.nome || null,
      custo: produto?.custo ?? null,
      ml_fee: produto?.ml_fee ?? null,
      ml_shipping: produto?.ml_shipping ?? null,
    });
  });

  const sorted = [...report].sort((a, b) => {
    const priorityDiff = classPriority(a.classe) - classPriority(b.classe);
    if (priorityDiff !== 0) return priorityDiff;
    const aDelta = Math.abs(a.delta_preco || 0);
    const bDelta = Math.abs(b.delta_preco || 0);
    if (bDelta !== aDelta) return bDelta - aDelta;
    return a.ml_item_id.localeCompare(b.ml_item_id);
  });

  const top = sorted.slice(0, topN);
  const classes = top.reduce((acc, row) => {
    acc[row.classe] = (acc[row.classe] || 0) + 1;
    return acc;
  }, {} as Record<ClasseAnalise, number>);

  return NextResponse.json({
    success: true,
    refresh: {
      status: refresh.status,
      mode: refreshMode,
      details: refresh.body,
    },
    total_analisado: report.length,
    top_n: topN,
    classes,
    data: top,
  });
}
