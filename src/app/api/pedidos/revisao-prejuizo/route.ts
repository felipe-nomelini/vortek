import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { resolveMlListingFinancialSnapshot } from '@/lib/ml/reconcile-produto-financials';

const DEFAULT_ORDER_NUMBERS = [
  '2000016769425694',
  '2000016766936618',
  '2000016766207766',
  '2000016765418550',
];

const TAX_RATE = 0.04;
const DEFAULT_ML_FEE = 0.15;

type PedidoRow = Pick<
  Database['public']['Tables']['pedidos']['Row'],
  'id' | 'numero' | 'ml_order_id' | 'total' | 'lucro' | 'situacao' | 'data'
>;

type PedidoItemRow = Pick<
  Database['public']['Tables']['pedido_itens']['Row'],
  'pedido_id' | 'ml_item_id' | 'seller_sku' | 'titulo' | 'quantidade' | 'valor_unitario' | 'valor_total_liquido'
>;

type ProdutoRow = Pick<
  Database['public']['Tables']['produtos']['Row'],
  'id' | 'sku' | 'nome' | 'custo' | 'ml_fee' | 'ml_shipping' | 'custom_price' | 'ml_item_id' | 'ml_status'
>;

type AnuncioRow = Pick<
  Database['public']['Tables']['anuncios_ml']['Row'],
  'ml_item_id' | 'produto_id' | 'sku' | 'preco_ml' | 'status'
>;

type ResolvedOrderItem = PedidoItemRow & {
  produto: ProdutoRow | null;
  anuncio: AnuncioRow | null;
  resolutionSource: 'seller_sku' | 'produto_ml_item_id' | 'anuncio_ml_item_id' | 'anuncio_sku' | 'unresolved';
};

function isAuthorizedRequest(request: Request): boolean {
  const apiKey = request.headers.get('x-api-key') || '';
  return Boolean(apiKey && apiKey === process.env.API_SECRET_KEY);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeCurrentScenario(
  produto: ProdutoRow,
  anuncio: AnuncioRow | null,
  overrides?: { mlFee?: number | null; mlShipping?: number | null },
) {
  const custo = Number(produto.custo || 0);
  const feeRate = Number.isFinite(Number(overrides?.mlFee)) ? Number(overrides?.mlFee) : (
    Number.isFinite(Number(produto.ml_fee)) ? Number(produto.ml_fee) : DEFAULT_ML_FEE
  );
  const shipping = Number.isFinite(Number(overrides?.mlShipping)) ? Number(overrides?.mlShipping) : Number(produto.ml_shipping || 0);
  const basePrice = toFiniteNumber(produto.custom_price) ?? toFiniteNumber(anuncio?.preco_ml) ?? null;
  const denominator = 1 - (TAX_RATE + feeRate);
  const precoEquilibrio = denominator > 0 ? round2((custo + shipping) / denominator) : null;

  if (basePrice === null) {
    return {
      precoBaseAtual: null,
      lucroUnitarioAtualEstimado: null,
      precoEquilibrio,
      deltaParaEquilibrio: precoEquilibrio,
    };
  }

  const imposto = basePrice * TAX_RATE;
  const taxaMl = basePrice * feeRate;
  const lucroUnitarioAtualEstimado = round2(basePrice - custo - shipping - imposto - taxaMl);
  const deltaParaEquilibrio = precoEquilibrio === null ? null : round2(precoEquilibrio - basePrice);

  return {
    precoBaseAtual: round2(basePrice),
    lucroUnitarioAtualEstimado,
    precoEquilibrio,
    deltaParaEquilibrio,
  };
}

function buildBloqueios(
  produto: ProdutoRow | null,
  anuncio: AnuncioRow | null,
  isManualAnalysis: boolean,
): string[] {
  const bloqueios: string[] = [];

  if (isManualAnalysis) {
    bloqueios.push('pedido_multi_item_ambiguo');
  }
  if (!produto) {
    bloqueios.push('sem_produto_vinculado');
    return bloqueios;
  }
  if (!String(produto.ml_item_id || anuncio?.ml_item_id || '').trim()) {
    bloqueios.push('sem_anuncio_ml');
  }
  if (produto.ml_status !== 'ativo') {
    bloqueios.push('anuncio_nao_ativo');
  }

  return bloqueios;
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedOrderNumbers = Array.isArray(body?.orderNumbers)
    ? body.orderNumbers.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const orderNumbers = requestedOrderNumbers.length > 0 ? requestedOrderNumbers : DEFAULT_ORDER_NUMBERS;

  const client = createServiceClient();
  const numericOrderNumbers = orderNumbers
    .map((value: string) => Number(value))
    .filter((value: number) => Number.isFinite(value));

  const { data: pedidos, error: pedidosError } = await client
    .from('pedidos')
    .select('id,numero,ml_order_id,total,lucro,situacao,data')
    .in('numero', numericOrderNumbers);

  if (pedidosError) {
    return NextResponse.json({ error: `Falha ao carregar pedidos: ${pedidosError.message}` }, { status: 500 });
  }

  const pedidosRows = (pedidos || []) as PedidoRow[];
  const pedidoIds = pedidosRows.map((pedido) => pedido.id);

  const { data: pedidoItens, error: pedidoItensError } = pedidoIds.length > 0
    ? await client
        .from('pedido_itens')
        .select('pedido_id,ml_item_id,seller_sku,titulo,quantidade,valor_unitario,valor_total_liquido')
        .in('pedido_id', pedidoIds)
    : { data: [], error: null };

  if (pedidoItensError) {
    return NextResponse.json({ error: `Falha ao carregar itens dos pedidos: ${pedidoItensError.message}` }, { status: 500 });
  }

  const itensRows = (pedidoItens || []) as PedidoItemRow[];
  const skuSet = new Set<string>();
  const mlItemIdSet = new Set<string>();

  for (const item of itensRows) {
    if (item.seller_sku) skuSet.add(item.seller_sku);
    if (item.ml_item_id) mlItemIdSet.add(item.ml_item_id);
  }

  const { data: produtosPorSku, error: produtosPorSkuError } = skuSet.size > 0
    ? await client
        .from('produtos')
        .select('id,sku,nome,custo,ml_fee,ml_shipping,custom_price,ml_item_id,ml_status')
        .in('sku', Array.from(skuSet))
    : { data: [], error: null };

  if (produtosPorSkuError) {
    return NextResponse.json({ error: `Falha ao carregar produtos por SKU: ${produtosPorSkuError.message}` }, { status: 500 });
  }

  const { data: produtosPorMlItem, error: produtosPorMlItemError } = mlItemIdSet.size > 0
    ? await client
        .from('produtos')
        .select('id,sku,nome,custo,ml_fee,ml_shipping,custom_price,ml_item_id,ml_status')
        .in('ml_item_id', Array.from(mlItemIdSet))
    : { data: [], error: null };

  if (produtosPorMlItemError) {
    return NextResponse.json({ error: `Falha ao carregar produtos por ML item: ${produtosPorMlItemError.message}` }, { status: 500 });
  }

  const { data: anunciosPorSku, error: anunciosPorSkuError } = skuSet.size > 0
    ? await client
        .from('anuncios_ml')
        .select('ml_item_id,produto_id,sku,preco_ml,status')
        .in('sku', Array.from(skuSet))
    : { data: [], error: null };

  if (anunciosPorSkuError) {
    return NextResponse.json({ error: `Falha ao carregar anúncios por SKU: ${anunciosPorSkuError.message}` }, { status: 500 });
  }

  const { data: anunciosPorMlItem, error: anunciosPorMlItemError } = mlItemIdSet.size > 0
    ? await client
        .from('anuncios_ml')
        .select('ml_item_id,produto_id,sku,preco_ml,status')
        .in('ml_item_id', Array.from(mlItemIdSet))
    : { data: [], error: null };

  if (anunciosPorMlItemError) {
    return NextResponse.json({ error: `Falha ao carregar anúncios por ML item: ${anunciosPorMlItemError.message}` }, { status: 500 });
  }

  const produtoBySku = new Map<string, ProdutoRow>();
  const produtoByMlItem = new Map<string, ProdutoRow>();
  const produtoById = new Map<string, ProdutoRow>();
  const anuncioBySku = new Map<string, AnuncioRow>();
  const anuncioByMlItem = new Map<string, AnuncioRow>();

  for (const produto of [...((produtosPorSku || []) as ProdutoRow[]), ...((produtosPorMlItem || []) as ProdutoRow[])]) {
    if (produto.sku) produtoBySku.set(produto.sku, produto);
    if (produto.ml_item_id) produtoByMlItem.set(produto.ml_item_id, produto);
    produtoById.set(produto.id, produto);
  }

  for (const anuncio of [...((anunciosPorSku || []) as AnuncioRow[]), ...((anunciosPorMlItem || []) as AnuncioRow[])]) {
    if (anuncio.sku) anuncioBySku.set(anuncio.sku, anuncio);
    if (anuncio.ml_item_id) anuncioByMlItem.set(anuncio.ml_item_id, anuncio);
  }

  const itensByPedidoId = new Map<string, ResolvedOrderItem[]>();

  for (const item of itensRows) {
    const produtoPorSku = item.seller_sku ? produtoBySku.get(item.seller_sku) || null : null;
    const produtoPorMlItem = item.ml_item_id ? produtoByMlItem.get(item.ml_item_id) || null : null;
    const anuncioPorMlItem = item.ml_item_id ? anuncioByMlItem.get(item.ml_item_id) || null : null;
    const anuncioPorSku = item.seller_sku ? anuncioBySku.get(item.seller_sku) || null : null;
    const produtoViaAnuncio = (anuncioPorMlItem?.produto_id && produtoById.get(anuncioPorMlItem.produto_id))
      || (anuncioPorSku?.produto_id && produtoById.get(anuncioPorSku.produto_id))
      || null;

    let produto: ProdutoRow | null = null;
    let anuncio: AnuncioRow | null = null;
    let resolutionSource: ResolvedOrderItem['resolutionSource'] = 'unresolved';

    if (produtoPorSku) {
      produto = produtoPorSku;
      anuncio = (produto.ml_item_id && anuncioByMlItem.get(produto.ml_item_id)) || anuncioPorSku || anuncioPorMlItem || null;
      resolutionSource = 'seller_sku';
    } else if (produtoPorMlItem) {
      produto = produtoPorMlItem;
      anuncio = anuncioPorMlItem || (produto.ml_item_id ? anuncioByMlItem.get(produto.ml_item_id) || null : null);
      resolutionSource = 'produto_ml_item_id';
    } else if (produtoViaAnuncio) {
      produto = produtoViaAnuncio;
      anuncio = anuncioPorMlItem || anuncioPorSku || null;
      resolutionSource = anuncioPorMlItem ? 'anuncio_ml_item_id' : 'anuncio_sku';
    }

    const resolvedItem: ResolvedOrderItem = {
      ...item,
      produto,
      anuncio,
      resolutionSource,
    };

    const current = itensByPedidoId.get(item.pedido_id) || [];
    current.push(resolvedItem);
    itensByPedidoId.set(item.pedido_id, current);
  }

  const pedidoResults = [];
  const productAggregate = new Map<string, Record<string, any>>();
  const skippedOrders = [];
  const liveFinancialsByProductId = new Map<string, { mlFee: number | null; mlShipping: number | null } | null>();

  for (const pedido of pedidosRows) {
    const lucroObservado = toFiniteNumber(pedido.lucro);
    if (lucroObservado !== null && lucroObservado >= 0) {
      skippedOrders.push({
        numero: pedido.numero,
        reason: 'non_negative_profit',
        lucro_observado: lucroObservado,
      });
      continue;
    }

    const itens = itensByPedidoId.get(pedido.id) || [];
    const resolvedProductIds = Array.from(new Set(itens.map((item) => item.produto?.id).filter((value): value is string => Boolean(value))));
    const allItemsResolved = itens.length > 0 && itens.every((item) => Boolean(item.produto?.id));
    const singleProductActionable = allItemsResolved && resolvedProductIds.length === 1;
    const resolvedProduto = singleProductActionable ? itens[0]?.produto || null : null;
    const resolvedAnuncio = singleProductActionable ? itens.find((item) => item.anuncio)?.anuncio || null : null;
    const isManualAnalysis = !singleProductActionable;
    const bloqueios = buildBloqueios(resolvedProduto, resolvedAnuncio, isManualAnalysis);

    let currentScenario: {
      precoBaseAtual: number | null;
      lucroUnitarioAtualEstimado: number | null;
      precoEquilibrio: number | null;
      deltaParaEquilibrio: number | null;
    } = {
      precoBaseAtual: null,
      lucroUnitarioAtualEstimado: null,
      precoEquilibrio: null,
      deltaParaEquilibrio: null,
    };
    let liveFinancials: { mlFee: number | null; mlShipping: number | null } | null = null;

    if (resolvedProduto) {
      if (liveFinancialsByProductId.has(resolvedProduto.id)) {
        liveFinancials = liveFinancialsByProductId.get(resolvedProduto.id) ?? null;
      } else {
        const financials = await resolveMlListingFinancialSnapshot({
          id: resolvedProduto.ml_item_id || resolvedAnuncio?.ml_item_id || null,
        });
        liveFinancials = financials
          ? { mlFee: financials.mlFee, mlShipping: financials.mlShipping }
          : null;
        liveFinancialsByProductId.set(resolvedProduto.id, liveFinancials);
      }

      currentScenario = computeCurrentScenario(resolvedProduto, resolvedAnuncio, liveFinancials || undefined);
    }

    const ajustavelAgora = bloqueios.length === 0 && resolvedProduto !== null;
    const recomendacao = isManualAnalysis
      ? 'analise_manual'
      : ajustavelAgora
        ? 'ajustar_preco'
        : 'sem_acao_possivel';

    const quantidadeTotal = itens.reduce((sum, item) => sum + Number(item.quantidade || 0), 0);

    const pedidoResult = {
      numero: pedido.numero,
      pedido_id: pedido.id,
      ml_order_id: pedido.ml_order_id,
      data: pedido.data,
      situacao: pedido.situacao,
      total: Number(pedido.total || 0),
      lucro_observado: lucroObservado,
      quantidade_total: quantidadeTotal,
      itens: itens.map((item) => ({
        titulo: item.titulo,
        quantidade: item.quantidade,
        seller_sku: item.seller_sku,
        ml_item_id: item.ml_item_id,
        valor_unitario: item.valor_unitario,
        valor_total_liquido: item.valor_total_liquido,
        produto_id: item.produto?.id || null,
        produto_sku: item.produto?.sku || null,
        produto_nome: item.produto?.nome || null,
        anuncio_ml_item_id: item.anuncio?.ml_item_id || null,
        resolution_source: item.resolutionSource,
      })),
      produto: resolvedProduto ? {
        produto_id: resolvedProduto.id,
        sku: resolvedProduto.sku,
        nome: resolvedProduto.nome,
        ml_item_id: String(resolvedProduto.ml_item_id || resolvedAnuncio?.ml_item_id || '').trim() || null,
      } : null,
      cenario_atual: {
        preco_ml_atual: toFiniteNumber(resolvedAnuncio?.preco_ml),
        custom_price_atual: toFiniteNumber(resolvedProduto?.custom_price),
        ml_fee_atual: liveFinancials?.mlFee ?? toFiniteNumber(resolvedProduto?.ml_fee),
        ml_shipping_atual: liveFinancials?.mlShipping ?? toFiniteNumber(resolvedProduto?.ml_shipping),
        preco_base_atual: currentScenario.precoBaseAtual,
        lucro_unitario_atual_estimado: currentScenario.lucroUnitarioAtualEstimado,
        preco_equilibrio: currentScenario.precoEquilibrio,
        delta_para_equilibrio: currentScenario.deltaParaEquilibrio,
      },
      ml_status: resolvedProduto?.ml_status || null,
      ajustavel_agora: ajustavelAgora,
      bloqueios,
      recomendacao,
    };

    pedidoResults.push(pedidoResult);

    if (resolvedProduto) {
      const aggregateKey = resolvedProduto.id;
      const existing = productAggregate.get(aggregateKey) || {
        produto_id: resolvedProduto.id,
        sku: resolvedProduto.sku,
        nome: resolvedProduto.nome,
        ml_item_id: String(resolvedProduto.ml_item_id || resolvedAnuncio?.ml_item_id || '').trim() || null,
        pedidos_afetados: [] as string[],
        lucro_observado_total: 0,
        preco_ml_atual: toFiniteNumber(resolvedAnuncio?.preco_ml),
        custom_price_atual: toFiniteNumber(resolvedProduto.custom_price),
        ml_fee_atual: liveFinancials?.mlFee ?? toFiniteNumber(resolvedProduto.ml_fee),
        ml_shipping_atual: liveFinancials?.mlShipping ?? toFiniteNumber(resolvedProduto.ml_shipping),
        lucro_unitario_atual_estimado: currentScenario.lucroUnitarioAtualEstimado,
        preco_equilibrio: currentScenario.precoEquilibrio,
        delta_para_equilibrio: currentScenario.deltaParaEquilibrio,
        ml_status: resolvedProduto.ml_status,
        ajustavel_agora: ajustavelAgora,
        bloqueio: bloqueios[0] || null,
        recomendacao,
      };

      existing.pedidos_afetados = Array.from(new Set([...existing.pedidos_afetados, String(pedido.numero)]));
      existing.lucro_observado_total = round2(Number(existing.lucro_observado_total || 0) + Number(lucroObservado || 0));
      existing.ajustavel_agora = Boolean(existing.ajustavel_agora && ajustavelAgora);

      if (existing.recomendacao !== 'analise_manual' && recomendacao === 'analise_manual') {
        existing.recomendacao = recomendacao;
      } else if (existing.recomendacao === 'ajustar_preco' && recomendacao === 'sem_acao_possivel') {
        existing.recomendacao = recomendacao;
      }

      if (!existing.bloqueio && bloqueios.length > 0) {
        existing.bloqueio = bloqueios[0];
      }

      productAggregate.set(aggregateKey, existing);
    }
  }

  return NextResponse.json({
    success: true,
    default_orders_applied: requestedOrderNumbers.length === 0,
    total_pedidos_solicitados: orderNumbers.length,
    total_pedidos_encontrados: pedidosRows.length,
    total_pedidos_analisados: pedidoResults.length,
    total_pedidos_ignorados: skippedOrders.length,
    skipped_orders: skippedOrders,
    pedidos: pedidoResults,
    produtos: Array.from(productAggregate.values()),
  });
}
