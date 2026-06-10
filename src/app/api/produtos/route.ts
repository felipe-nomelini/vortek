import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { calculateSuggestedPrice } from '@/services/pricing';
import { enqueueMlPublishOutbox } from '@/lib/sync/ml-publish-outbox';
import { assertVortekSku } from '@/lib/product-master-sku';
import {
  buildOffersByProductId,
  fetchAllTableRows,
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  matchesProductMasterFilters,
  type ProdutoFilterOfferRow,
  type SupplierFilterOption,
} from '@/lib/produto-filtering';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const search = searchParams.get('search') || '';
  const pageSize = 100;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const fornecedorFilterIds = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const productActiveStatusParam = searchParams.get('ativo') || 'ativo';
  const productActiveStatus = productActiveStatusParam === 'inativo' || productActiveStatusParam === 'todos'
    ? productActiveStatusParam
    : 'ativo';
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
  const rawSortBy = searchParams.get('sortBy') || 'sku';
  const rawSortOrder = searchParams.get('sortOrder') || 'asc';
  const allowedSortBy = new Set([
    'sku',
    'nome',
    'fornecedor',
    'estoque',
    'custo',
    'ml_fee',
    'ml_shipping',
    'suggested_price',
    'profit',
    'ml_status',
  ]);
  const sortBy = allowedSortBy.has(rawSortBy) ? rawSortBy : 'sku';
  const sortOrder = rawSortOrder === 'desc' ? 'desc' : 'asc';

  function computeDerived(item: Record<string, any>): { displayPrice: number; profit: number | null } {
    try {
      const result = calculateSuggestedPrice({
        cost: Number(item.custo || 0),
        shipping: Number(item.ml_shipping || 0),
        mlFee: Number(item.ml_fee || 0.15),
      });
      const displayPrice = Math.round(((item.custom_price ?? result.suggestedPrice) || 0) * 100) / 100;

      if (item.ml_status === 'sem_anuncio') {
        return { displayPrice, profit: null };
      }

      const tax = displayPrice * 0.04;
      const mlFeeAmount = displayPrice * Number(item.ml_fee || 0.15);
      const netProfit = displayPrice - Number(item.custo || 0) - Number(item.ml_shipping || 0) - tax - mlFeeAmount;
      return { displayPrice, profit: Math.round(netProfit * 100) / 100 };
    } catch {
      return {
        displayPrice: Math.round(((item.custom_price ?? item.custo) || 0) * 100) / 100,
        profit: null,
      };
    }
  }

  function matchesFilters(item: Record<string, any>, offers: ProdutoFilterOfferRow[]): boolean {
    if (!matchesProductMasterFilters({
      product: item,
      offers,
      search,
      supplierFilterIds: supplierFilterDsliteIds,
      productActiveStatus,
      mlStatus,
      estoque,
    })) {
      return false;
    }

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

  function sortRows(rows: Array<Record<string, any>>) {
    const direction = sortOrder === 'asc' ? 1 : -1;
    rows.sort((left, right) => {
      const leftDerived = computeDerived(left);
      const rightDerived = computeDerived(right);
      let comparison = 0;

      switch (sortBy) {
        case 'sku':
          comparison = String(left.sku || '').localeCompare(String(right.sku || ''), 'pt-BR');
          break;
        case 'nome':
          comparison = String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR');
          break;
        case 'fornecedor':
          comparison = String(left.fornecedor || '').localeCompare(String(right.fornecedor || ''), 'pt-BR');
          break;
        case 'estoque':
          comparison = Number(left.estoque || 0) - Number(right.estoque || 0);
          break;
        case 'custo':
          comparison = Number(left.custo || 0) - Number(right.custo || 0);
          break;
        case 'ml_fee':
          comparison = Number(left.ml_fee || 0) - Number(right.ml_fee || 0);
          break;
        case 'ml_shipping':
          comparison = Number(left.ml_shipping || 0) - Number(right.ml_shipping || 0);
          break;
        case 'suggested_price':
          comparison = leftDerived.displayPrice - rightDerived.displayPrice;
          break;
        case 'profit': {
          const leftProfit = leftDerived.profit;
          const rightProfit = rightDerived.profit;
          if (leftProfit === null && rightProfit === null) comparison = 0;
          else if (leftProfit === null) comparison = 1;
          else if (rightProfit === null) comparison = -1;
          else comparison = leftProfit - rightProfit;
          break;
        }
        case 'ml_status':
          comparison = String(left.ml_status || '').localeCompare(String(right.ml_status || ''), 'pt-BR');
          break;
        default:
          comparison = String(left.sku || '').localeCompare(String(right.sku || ''), 'pt-BR');
          break;
      }

      if (comparison !== 0) return comparison * direction;
      return String(left.sku || '').localeCompare(String(right.sku || ''), 'pt-BR');
    });
  }
  let rows: Array<Record<string, any>> = [];
  let allOffers: ProdutoFilterOfferRow[] = [];
  let supplierOptions: SupplierFilterOption[] = [];
  try {
    [rows, allOffers, supplierOptions] = await Promise.all([
      fetchAllTableRows<Record<string, any>>(serviceClient, 'produtos', '*', [{ column: 'created_at', ascending: false }]),
      fetchAllTableRows<ProdutoFilterOfferRow>(
        serviceClient,
        'produto_fornecedor_ofertas',
        'id,produto_id,dslite_fornecedor_id,fornecedor_nome,sku_oferta,sku_fornecedor,nome',
        [
          { column: 'produto_id', ascending: true },
          { column: 'id', ascending: true },
        ],
      ),
      listActiveSupplierOptions(serviceClient),
    ]);
  } catch (error: any) {
    console.error('[api/produtos] Falha ao carregar produtos mestres:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao carregar produtos' }, { status: 500 });
  }

  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);

  const offersByProductId = buildOffersByProductId(allOffers);
  const filteredRows = rows.filter((item) => (
    matchesFilters(item, offersByProductId.get(String(item.id || '').trim()) || [])
  ));
  sortRows(filteredRows);
  const total = filteredRows.length;
  const pageRows = filteredRows.slice(from, to + 1);

  const pageProductIds = pageRows.map((item) => String(item.id || '').trim()).filter(Boolean);
  let pageOffersByProductId = new Map<string, any[]>();

  if (pageProductIds.length > 0) {
    const { data: offers, error: offersError } = await serviceClient
      .from('produto_fornecedor_ofertas')
      .select('id,produto_id,fornecedor_nome,sku_oferta,custo,estoque,ativo,payment_mode,dslite_fornecedor_id,dslite_produto_id')
      .in('produto_id', pageProductIds);

    if (offersError) {
      return NextResponse.json({ erro: offersError.message }, { status: 500 });
    }

    pageOffersByProductId = new Map<string, any[]>();
    for (const offer of offers || []) {
      const key = String((offer as any).produto_id || '').trim();
      if (!key) continue;
      const list = pageOffersByProductId.get(key) || [];
      list.push(offer as any);
      pageOffersByProductId.set(key, list);
    }
  }

  const data = pageRows.map((product) => {
    const offers = pageOffersByProductId.get(String(product.id || '').trim()) || [];
    const preferredOffer = offers.find((offer) => {
      const explicitPreferred = String(product.oferta_preferencial_id || '').trim();
      if (explicitPreferred) return explicitPreferred === String((offer as any).id || '').trim();
      return String(product.dslite_fornecedor_id || '').trim() === String((offer as any).dslite_fornecedor_id || '').trim()
        && String(product.dslite_produto_id || '').trim() === String((offer as any).dslite_produto_id || '').trim();
    }) || null;

    return {
      product,
      preferredOffer,
      offersCount: offers.length,
    };
  });

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    fornecedores: supplierOptions,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const body = await request.json();
  let payload = { ...body } as Record<string, any>;
  if ('sku' in payload) {
    try {
      payload.sku = assertVortekSku(payload.sku);
    } catch (error: any) {
      return NextResponse.json({ erro: error?.message || 'SKU mestre inválido' }, { status: 422 });
    }
  } else {
    delete payload.sku;
  }
  if ('dslite_fornecedor_id' in payload) payload.dslite_fornecedor_id = String(payload.dslite_fornecedor_id || '').trim();
  if ('dslite_produto_id' in payload) payload.dslite_produto_id = String(payload.dslite_produto_id || '').trim();

  const { data, error } = await serviceClient.from('produtos').insert(payload).select().single();

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
