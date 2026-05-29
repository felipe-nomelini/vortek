import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { buildCanonicalDsliteSku, normalizeSku, stripKnownSkuPrefix, getFornecedorSkuPrefix } from '@/lib/sku';
import { calculateSuggestedPrice } from '@/services/pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';

function coerceDsliteIdentity(payload: Record<string, any>): { ok: true; payload: Record<string, any> } | { ok: false; error: string } {
  const fornecedorId = payload.dslite_fornecedor_id != null ? String(payload.dslite_fornecedor_id).trim() : '';
  const produtoId = payload.dslite_produto_id != null ? String(payload.dslite_produto_id).trim() : '';
  const hasFornecedor = Boolean(fornecedorId);
  const hasProdutoId = Boolean(produtoId);
  if (!hasFornecedor && !hasProdutoId) return { ok: true, payload };

  if (hasFornecedor && !getFornecedorSkuPrefix(fornecedorId)) {
    return { ok: false, error: `Fornecedor DSLite ${fornecedorId} não possui prefixo SKU configurado.` };
  }

  const skuProvided = 'sku' in payload ? normalizeSku(payload.sku) : '';
  const baseFromSku = skuProvided ? stripKnownSkuPrefix(skuProvided) : '';
  const baseId = produtoId || baseFromSku;
  if (!baseId) {
    return { ok: false, error: 'Para produto DSLite, informe dslite_produto_id ou SKU válido.' };
  }

  const canonicalSku = buildCanonicalDsliteSku(fornecedorId, baseId, baseId);
  if (skuProvided && skuProvided !== canonicalSku) {
    return { ok: false, error: `SKU incompatível com fornecedor DSLite. Esperado: ${canonicalSku}` };
  }

  return {
    ok: true,
    payload: {
      ...payload,
      sku: canonicalSku,
      dslite_fornecedor_id: fornecedorId || payload.dslite_fornecedor_id,
      dslite_produto_id: produtoId || baseId,
    },
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const search = searchParams.get('search') || '';
  const pageSize = 100;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const fornecedorFilter = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const mlStatus = searchParams.get('ml_status') || '';
  const estoque = searchParams.get('estoque') || '';
  const priceFieldParam = searchParams.get('priceField') || 'cost';
  const priceField: 'cost' | 'suggestedPrice' | 'profit' =
    priceFieldParam === 'suggestedPrice' || priceFieldParam === 'profit'
      ? priceFieldParam
      : 'cost';
  const rawPriceMin = searchParams.get('priceMin');
  const rawPriceMax = searchParams.get('priceMax');
  const parsedPriceMin = rawPriceMin !== null ? Number(rawPriceMin) : null;
  const parsedPriceMax = rawPriceMax !== null ? Number(rawPriceMax) : null;
  const priceMin = parsedPriceMin !== null && Number.isFinite(parsedPriceMin) ? parsedPriceMin : null;
  const priceMax = parsedPriceMax !== null && Number.isFinite(parsedPriceMax) ? parsedPriceMax : null;
  const hasPriceFilter = priceMin !== null || priceMax !== null;

  function computeDerived(item: any): { displayPrice: number; profit: number | null } {
    try {
      const result = calculateSuggestedPrice({
        cost: item.custo || 0,
        shipping: item.ml_shipping || 0,
        mlFee: item.ml_fee || 0.15,
      });
      const displayPrice = Math.round((item.custom_price ?? result.suggestedPrice) * 100) / 100;

      if (item.ml_status === 'sem_anuncio') {
        return { displayPrice, profit: null };
      }

      const tax = displayPrice * 0.04;
      const mlFeeAmount = displayPrice * (item.ml_fee || 0.15);
      const netProfit = displayPrice - (item.custo || 0) - (item.ml_shipping || 0) - tax - mlFeeAmount;
      return { displayPrice, profit: Math.round(netProfit * 100) / 100 };
    } catch {
      return {
        displayPrice: Math.round(((item.custom_price ?? item.custo) || 0) * 100) / 100,
        profit: null,
      };
    }
  }

  function matchesPriceFilter(item: any): boolean {
    const { displayPrice, profit } = computeDerived(item);
    let value = 0;
    if (priceField === 'cost') {
      value = Number(item.custo || 0);
    } else if (priceField === 'suggestedPrice') {
      value = displayPrice;
    } else {
      if (profit === null) return false;
      value = profit;
    }

    if (priceMin !== null && value < priceMin) return false;
    if (priceMax !== null && value > priceMax) return false;
    return true;
  }

  // Helper to apply common DB filters to a query
  function applyFilters(query: any) {
    if (search) {
      query = query.or(`nome.ilike.%${search}%,sku.ilike.%${search}%`);
    }
    if (fornecedorFilter.length > 0) {
      query = query.in('fornecedor', fornecedorFilter);
    }
    if (mlStatus) {
      query = query.eq('ml_status', mlStatus);
    }
    if (estoque === 'com_estoque') {
      query = query.gt('estoque', 0);
    } else if (estoque === 'sem_estoque') {
      query = query.eq('estoque', 0);
    }
    return query;
  }

  let data: any[] = [];
  let total = 0;
  if (hasPriceFilter) {
    // With derived price/profit filters we need to apply filtering over the full filtered dataset.
    const chunkSize = 1000;
    const allRows: any[] = [];
    let offset = 0;

    while (true) {
      let chunkQuery = supabase.from('produtos').select('*');
      chunkQuery = applyFilters(chunkQuery);
      const { data: chunk, error } = await chunkQuery
        .order('sku', { ascending: true })
        .range(offset, offset + chunkSize - 1);

      if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
      const rows = chunk || [];
      allRows.push(...rows);
      if (rows.length < chunkSize) break;
      offset += chunkSize;
    }

    const filteredRows = allRows.filter(matchesPriceFilter);
    total = filteredRows.length;
    data = filteredRows.slice(from, to + 1);
  } else {
    // Count query (exact, via DB)
    let countQuery = supabase.from('produtos').select('id', { count: 'exact', head: false }).range(0, 0);
    countQuery = applyFilters(countQuery);
    const { count } = await countQuery;
    total = count || 0;

    // Data query with pagination
    let dataQuery = supabase.from('produtos').select('*');
    dataQuery = applyFilters(dataQuery);
    const { data: pageData, error } = await dataQuery
      .order('sku', { ascending: true })
      .range(from, to);

    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    data = pageData || [];
  }

  // Get distinct fornecedores via RPC
  const serviceClient = createServiceClient();
  const { data: fornData } = await serviceClient.rpc('get_fornecedores');
  const fornecedoresSet = new Set<string>();
  for (const item of fornData || []) {
    if (item.fornecedor) fornecedoresSet.add(item.fornecedor);
  }

  return NextResponse.json({
    data: data || [],
    total,
    page,
    pageSize,
    fornecedores: Array.from(fornecedoresSet).sort(),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await request.json();
  let payload = { ...body } as Record<string, any>;
  if ('sku' in payload) {
    payload.sku = normalizeSku(payload.sku);
  }
  const normalized = coerceDsliteIdentity(payload);
  if (!normalized.ok) {
    return NextResponse.json({ erro: normalized.error }, { status: 422 });
  }
  payload = normalized.payload;

  const { data, error } = await supabase.from('produtos').insert(payload).select().single();

  if (error) {
    const msg = error.message || '';
    const details = String((error as any).details || '');
    if (
      msg.includes('produtos_sku_upper_unique') ||
      msg.includes('produtos_sku_key') ||
      details.includes('produtos_sku_upper_unique') ||
      details.includes('produtos_sku_key')
    ) {
      return NextResponse.json({ erro: 'SKU já cadastrado' }, { status: 409 });
    }
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
  let warning: string | null = null;
  if (String((data as any)?.ml_item_id || '').trim()) {
    const outbox = await enqueueMlPublishOutbox(createServiceClient(), {
      produtoId: String((data as any).id),
      mlItemId: String((data as any).ml_item_id),
      desiredStatus: ((data as any).ml_status || null) as any,
      desiredPrice: typeof (data as any).custom_price === 'number' ? (data as any).custom_price : null,
      desiredQuantity: typeof (data as any).estoque === 'number' ? (data as any).estoque : null,
      source: 'produto_create',
      payload: { origin: 'api/produtos POST' },
    });
    if (!outbox.ok) {
      warning = outbox.error;
    }
  }

  return NextResponse.json(
    warning ? { data, warning: `Produto criado, mas falhou ao enfileirar publicação ML: ${warning}` } : data,
    { status: 201 },
  );
}
