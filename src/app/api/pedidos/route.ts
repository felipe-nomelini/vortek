import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase';
import { saoPauloDateParamToUtcIso } from '@/lib/timezone';
import { reconcileLocalNfeSnapshotFromXml } from '@/lib/fiscal/nfe-local-reconciliation';
import { isBkr1Supplier } from '@/lib/supplier-balance';
import { inferSupplierPaymentMode, resolvePreferredOfferForProduct } from '@/lib/produto-fornecedor';
import { getSkuLookupVariants } from '@/lib/sku';
import {
  PREPARATION_ORDER_STATUSES,
  SHIPPING_ORDER_STATUSES,
  matchesOrdersOperationalView,
  parseOrdersOperationalView,
  type OrdersOperationalView,
} from '@/lib/orders/operational-view';
import { enrichOrdersWithWhatsappStatus } from '@/services/order-operational-status';
import {
  calcularSaldoEstoqueInterno,
  expandirItensReservaEstoqueInterno,
  type ComposicaoKitEstoqueInterno,
} from '@/lib/estoque-interno-saldo';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  includesInternalSupplierFilter,
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  matchesOrderSupplierFilter,
} from '@/lib/produto-filtering';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function logDbError(
  event: string,
  endpoint: string,
  search: string,
  error: { code?: string; message?: string; details?: string } | null,
  context?: Record<string, unknown>,
) {
  console.error('[pedidos_api_error]', {
    event,
    endpoint,
    search,
    db_code: error?.code ?? null,
    db_message: error?.message ?? null,
    db_details: error?.details ?? null,
    ...(context || {}),
  });
}

function isMissingSaleDateColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42703' && String(error?.message || '').includes('data_venda');
}

function reconcileNotaFiscalEmitidaRow(row: any) {
  const reconciliation = reconcileLocalNfeSnapshotFromXml({
    nfe_status: row?.nfe_status,
    nfe_xml: row?.nfe_xml,
    nfe_chave: row?.nfe_chave,
    nota_fiscal_numero: row?.nota_fiscal_numero,
    nfe_protocolo: row?.nfe_protocolo,
    nfe_cfop: row?.nfe_cfop,
  });
  const shouldKeepEmitida = Boolean(row?.nota_fiscal_emitida && String(row?.nfe_danfe_url || '').trim());
  const nextRow = {
    ...row,
    ...reconciliation.updates,
    nota_fiscal_emitida: shouldKeepEmitida,
  };
  const needsPersistence = Boolean(
    Object.keys(reconciliation.updates || {}).length > 0
    || Boolean(row?.nota_fiscal_emitida) !== shouldKeepEmitida,
  );
  return {
    row: nextRow,
    needsPersistence,
  };
}

async function persistReconciledPedidos(rows: any[]) {
  const pending = rows
    .map(reconcileNotaFiscalEmitidaRow)
    .filter((entry) => entry.needsPersistence && entry.row?.id);

  if (!pending.length) return rows.map((row) => reconcileNotaFiscalEmitidaRow(row).row);

  const serviceClient = createServiceClient();
  await Promise.allSettled(
    pending.map(({ row }) => serviceClient
      .from('pedidos')
      .update({
        nota_fiscal_emitida: row.nota_fiscal_emitida,
        nfe_status: row.nfe_status || undefined,
        nfe_chave: row.nfe_chave || undefined,
        nota_fiscal_numero: row.nota_fiscal_numero || undefined,
        nfe_protocolo: row.nfe_protocolo || undefined,
        nfe_cfop: row.nfe_cfop || undefined,
        nfe_danfe_url: row.nfe_danfe_url || null,
      } as any)
      .eq('id', row.id)),
  );

  return rows.map((row) => reconcileNotaFiscalEmitidaRow(row).row);
}

async function resolveFornecedorPreviewByPedido(
  itensPorPedido: Map<string, any[]>,
  serviceClient: ReturnType<typeof createServiceClient>,
) {
  const skuVariants = Array.from(new Set(
    Array.from(itensPorPedido.values())
      .flatMap((itens) => itens.flatMap((item) => getSkuLookupVariants(item?.seller_sku)))
      .filter(Boolean),
  ));
  const mlItemIds = Array.from(new Set(
    Array.from(itensPorPedido.values())
      .flatMap((itens) => itens.map((item) => String(item?.ml_item_id || '').trim()))
      .filter(Boolean),
  ));
  const previews = new Map<string, any>();
  if (!skuVariants.length && !mlItemIds.length) return previews;

  const productSelect = 'id,ml_item_id,sku,nome,fornecedor,dslite_fornecedor_id,oferta_preferencial_id,fornecedor_preferencial_manual';
  async function loadProductsBy(field: 'sku' | 'ml_item_id', values: string[]) {
    const data: any[] = [];
    for (let index = 0; index < values.length; index += 200) {
      const { data: chunk, error } = await serviceClient
        .from('produtos')
        .select(productSelect)
        .in(field, values.slice(index, index + 200));
      if (error) return { data, error };
      data.push(...(chunk || []));
    }
    return { data, error: null as any };
  }
  const [productsBySkuResult, productsByMlItemResult] = await Promise.all([
    loadProductsBy('sku', skuVariants),
    loadProductsBy('ml_item_id', mlItemIds),
  ]);
  const productError = productsBySkuResult.error || productsByMlItemResult.error;
  if (productError) {
    logDbError('pedidos_supplier_preview_products_failed', '/api/pedidos', '', productError);
    return previews;
  }
  const products = Array.from(new Map(
    [...(productsBySkuResult.data || []), ...(productsByMlItemResult.data || [])]
      .map((product: any) => [String(product.id), product]),
  ).values());

  const productsBySku = new Map<string, any>();
  const productsByMlItem = new Map<string, any>();
  const productsById = new Map<string, any>();
  for (const product of products || []) {
    productsBySku.set(String((product as any).sku || '').trim().toUpperCase(), product);
    const mlItemId = String((product as any).ml_item_id || '').trim();
    if (mlItemId) productsByMlItem.set(mlItemId, product);
    productsById.set(String((product as any).id || ''), product);
  }
  const productIds = Array.from(productsById.keys()).filter(Boolean);
  const { data: kits, error: kitsError } = productIds.length > 0
    ? await (serviceClient as any)
        .from('produto_kits')
        .select('produto_id,ativo')
        .in('produto_id', productIds)
    : { data: [], error: null as any };
  if (kitsError) {
    logDbError('pedidos_internal_stock_kits_failed', '/api/pedidos', '', kitsError);
    return previews;
  }
  const kitByProductId = new Map<string, any>((kits || []).map((kit: any) => [String(kit.produto_id), kit]));
  const kitIds = Array.from(kitByProductId.keys());
  const { data: kitComponents, error: kitComponentsError } = kitIds.length > 0
    ? await (serviceClient as any)
        .from('produto_kit_componentes')
        .select('kit_produto_id,componente_produto_id,quantidade')
        .in('kit_produto_id', kitIds)
    : { data: [], error: null as any };
  if (kitComponentsError) {
    logDbError('pedidos_internal_stock_kit_components_failed', '/api/pedidos', '', kitComponentsError);
    return previews;
  }
  const componentsByKit = new Map<string, any[]>();
  for (const component of kitComponents || []) {
    const kitId = String((component as any).kit_produto_id || '');
    const current = componentsByKit.get(kitId) || [];
    current.push(component);
    componentsByKit.set(kitId, current);
  }
  const componentProductIds = Array.from(new Set<string>(
    (kitComponents || [])
      .map((component: any) => String(component.componente_produto_id || ''))
      .filter(Boolean),
  ));
  const { data: componentProducts, error: componentProductsError } = componentProductIds.length > 0
    ? await serviceClient
        .from('produtos')
        .select('id,sku,ativo')
        .in('id', componentProductIds)
    : { data: [], error: null as any };
  if (componentProductsError) {
    logDbError('pedidos_internal_stock_component_products_failed', '/api/pedidos', '', componentProductsError);
    return previews;
  }
  const componentProductById = new Map<string, any>(
    (componentProducts || []).map((product: any) => [String(product.id), product]),
  );
  const internalKitCompositions = new Map<string, ComposicaoKitEstoqueInterno>();
  for (const [kitId, kit] of kitByProductId) {
    internalKitCompositions.set(kitId, {
      ativo: kit.ativo !== false,
      componentes: (componentsByKit.get(kitId) || []).map((component: any) => {
        const product = componentProductById.get(String(component.componente_produto_id || ''));
        return {
          produtoId: String(component.componente_produto_id || ''),
          sku: String(product?.sku || ''),
          ativo: product?.ativo !== false && Boolean(product?.sku),
          quantidade: Number(component.quantidade || 0),
        };
      }),
    });
  }
  const offers: any[] = [];
  let offerError: any = null;
  for (let index = 0; index < productIds.length; index += 200) {
    const result = await serviceClient
      .from('produto_fornecedor_ofertas')
      .select('id,produto_id,dslite_fornecedor_id,fornecedor_nome,custo,estoque,ativo,prioridade')
      .in('produto_id', productIds.slice(index, index + 200));
    if (result.error) {
      offerError = result.error;
      break;
    }
    offers.push(...(result.data || []));
  }
  if (offerError) {
    logDbError('pedidos_supplier_preview_offers_failed', '/api/pedidos', '', offerError);
    return previews;
  }
  const movimentosInternos: any[] = [];
  let movimentosInternosError: any = null;
  const internalStockProductIds = Array.from(new Set([...productIds, ...componentProductIds]));
  for (let index = 0; index < internalStockProductIds.length; index += 200) {
    const result = await (serviceClient as any)
      .from('estoque_interno_movimentacoes')
      .select('pedido_id,produto_id,tipo,quantidade,situacao_estoque,estornada_em')
      .in('produto_id', internalStockProductIds.slice(index, index + 200));
    if (result.error) {
      movimentosInternosError = result.error;
      break;
    }
    movimentosInternos.push(...(result.data || []));
  }
  if (movimentosInternosError) {
    logDbError('pedidos_internal_stock_preview_failed', '/api/pedidos', '', movimentosInternosError);
  }
  const movimentosInternosPorProduto = new Map<string, any[]>();
  for (const movimento of movimentosInternos || []) {
    const produtoId = String((movimento as any).produto_id || '');
    if (!produtoId) continue;
    const atuais = movimentosInternosPorProduto.get(produtoId) || [];
    atuais.push(movimento);
    movimentosInternosPorProduto.set(produtoId, atuais);
  }
  const saldoInternoPorProduto = new Map(
    Array.from(movimentosInternosPorProduto.entries()).map(([produtoId, movimentos]) => [
      produtoId,
      calcularSaldoEstoqueInterno(movimentos),
    ]),
  );
  const compromissoInternoPorPedidoProduto = new Map<string, number>();
  for (const movimento of movimentosInternos || []) {
    if (
      movimento.tipo !== 'saida_envio_interno'
      || movimento.estornada_em
      || !movimento.pedido_id
    ) continue;
    const key = `${String(movimento.pedido_id)}:${String(movimento.produto_id)}`;
    compromissoInternoPorPedidoProduto.set(
      key,
      (compromissoInternoPorPedidoProduto.get(key) || 0) + Number(movimento.quantidade || 0),
    );
  }

  const offersByProductId = new Map<string, any[]>();
  for (const offer of offers || []) {
    const productId = String((offer as any).produto_id || '');
    const list = offersByProductId.get(productId) || [];
    list.push(offer);
    offersByProductId.set(productId, list);
  }

  const fornecedorIds = Array.from(new Set([
    ...(products || []).map((product: any) => String(product.dslite_fornecedor_id || '').trim()),
    ...(offers || []).map((offer: any) => String(offer.dslite_fornecedor_id || '').trim()),
  ].filter(Boolean)));
  const { data: fornecedores, error: fornecedorError } = fornecedorIds.length
    ? await serviceClient
      .from('fornecedores')
      .select('dslite_id,telefone,supplier_pix_key')
      .in('dslite_id', fornecedorIds)
    : { data: [], error: null as any };
  if (fornecedorError) {
    logDbError('pedidos_supplier_preview_fornecedores_failed', '/api/pedidos', '', fornecedorError);
  }
  const fornecedorByDsliteId = new Map((fornecedores || []).map((fornecedor: any) => [
    String(fornecedor.dslite_id || '').trim(), fornecedor,
  ]));

  for (const [pedidoId, itens] of itensPorPedido) {
    const selected = (itens || []).map((item: any) => {
      const product = productsByMlItem.get(String(item?.ml_item_id || '').trim())
        || getSkuLookupVariants(item?.seller_sku)
          .map((sku) => productsBySku.get(sku))
          .find(Boolean);
      if (!product) return null;
      const preferredOffer = resolvePreferredOfferForProduct(
        offersByProductId.get(String(product.id)) || [],
        product.oferta_preferencial_id,
        product.fornecedor_preferencial_manual === true,
      );
      const fornecedorId = String(preferredOffer?.dslite_fornecedor_id || product.dslite_fornecedor_id || '').trim();
      const fornecedorNome = String(preferredOffer?.fornecedor_nome || product.fornecedor || '').trim();
      return {
        produtoId: String(product.id),
        fornecedorId: fornecedorId || null,
        fornecedorNome: fornecedorNome || null,
        custo: Number(preferredOffer?.custo || 0),
        quantidade: Number(item?.quantidade || 1),
        produtoDescricao: product.nome || item?.titulo || null,
        produtoSku: product.sku || item?.seller_sku || null,
      };
    }).filter(Boolean) as Array<{
      produtoId: string;
      fornecedorId: string | null;
      fornecedorNome: string | null;
      custo: number;
      quantidade: number;
      produtoDescricao: string | null;
      produtoSku: string | null;
    }>;
    if (!selected.length) continue;

    const quantidadeInternaPorProduto = new Map<string, number>();
    let composicaoInternaValida = true;
    try {
      const stockItems = expandirItensReservaEstoqueInterno(
        selected.map((item) => ({
          produtoId: item.produtoId,
          sku: String(item.produtoSku || item.produtoId),
          quantidade: item.quantidade,
        })),
        internalKitCompositions,
      );
      for (const stockItem of stockItems) {
        quantidadeInternaPorProduto.set(
          stockItem.produtoId,
          (quantidadeInternaPorProduto.get(stockItem.produtoId) || 0) + stockItem.quantidade,
        );
      }
    } catch {
      composicaoInternaValida = false;
    }
    const estoqueInternoCompleto = composicaoInternaValida
      && selected.length === itens.length
      && Array.from(quantidadeInternaPorProduto.entries()).every(([produtoId, quantidade]) => (
        (saldoInternoPorProduto.get(produtoId) || 0)
          + (compromissoInternoPorPedidoProduto.get(`${pedidoId}:${produtoId}`) || 0)
          >= quantidade
      ));
    if (estoqueInternoCompleto) {
      const first = selected[0];
      previews.set(pedidoId, {
        fornecedor_id: null,
        fornecedor_nome: 'Estoque Interno',
        fornecedor_telefone: null,
        supplier_pix_key: null,
        supplier_payment_mode: null,
        supplier_payment_status: null,
        supplier_payment_amount: null,
        internal_stock_available: true,
        operational_supplier_ids: [],
        compra_produto_descricao: first.produtoDescricao,
        compra_produto_sku: first.produtoSku,
        compra_quantidade: selected.reduce((total, item) => total + item.quantidade, 0),
      });
      continue;
    }

    const supplierKeys = Array.from(new Set(selected.map((item) => `${item.fornecedorId || ''}:${item.fornecedorNome || ''}`)));
    const first = selected[0];
    const singleSupplier = supplierKeys.length === 1;
    const fornecedor = singleSupplier ? fornecedorByDsliteId.get(String(first.fornecedorId || '')) : null;
    const paymentMode = first.fornecedorId ? inferSupplierPaymentMode(first.fornecedorId) : null;
    previews.set(pedidoId, {
      fornecedor_id: singleSupplier ? first.fornecedorId : null,
      fornecedor_nome: singleSupplier ? first.fornecedorNome : 'Múltiplos fornecedores previstos',
      fornecedor_telefone: fornecedor?.telefone || null,
      supplier_pix_key: fornecedor?.supplier_pix_key || null,
      supplier_payment_mode: singleSupplier ? paymentMode : null,
      supplier_payment_status: paymentMode === 'prepaid_pix' ? 'pending' : null,
      supplier_payment_amount: selected.reduce((total, item) => total + item.custo * item.quantidade, 0) || null,
      operational_supplier_ids: Array.from(new Set(selected.map((item) => item.fornecedorId).filter(Boolean))),
      compra_produto_descricao: first.produtoDescricao,
      compra_produto_sku: first.produtoSku,
      compra_quantidade: selected.reduce((total, item) => total + item.quantidade, 0),
    });
  }

  return previews;
}

async function enrichPedidosWithCompras(rows: any[], serviceClient: ReturnType<typeof createServiceClient>) {
  rows = rows.map((row) => ({
    ...row,
    total: Number(row?.operational_total ?? row?.total ?? 0),
    lucro: row?.operational_lucro ?? row?.lucro ?? null,
    operational_profit_pending: Boolean(row?.operational_profit_pending),
    is_virtual_kit: row?.ml_bundle_type === 'virtual_kit',
    is_cart: row?.ml_bundle_type === 'cart',
    kit_order_ids: Array.isArray(row?.operational_order_ids) ? row.operational_order_ids : [],
    operational_dslite_ids: Array.isArray(row?.operational_dslite_ids)
      ? row.operational_dslite_ids.map(String).filter(Boolean)
      : String(row?.dslite_id || '').trim()
        ? [String(row.dslite_id)]
        : [],
    operational_invoice_numbers: Array.isArray(row?.operational_invoice_numbers)
      ? row.operational_invoice_numbers.map(String).filter(Boolean)
      : String(row?.nota_fiscal_numero || '').trim()
        ? [String(row.nota_fiscal_numero)]
        : [],
    has_split_fulfillment:
      new Set(
        (Array.isArray(row?.operational_dslite_ids)
          ? row.operational_dslite_ids
          : [row?.dslite_id])
          .map((value: unknown) => String(value || '').trim())
          .filter(Boolean),
      ).size > 1
      || new Set(
        (Array.isArray(row?.operational_invoice_numbers)
          ? row.operational_invoice_numbers
          : [row?.nota_fiscal_numero])
          .map((value: unknown) => String(value || '').trim())
          .filter(Boolean),
      ).size > 1,
  }));
  const pedidoIds = Array.from(new Set(
    rows
      .flatMap((row) => (
        Array.isArray(row?.operational_pedido_ids) && row.operational_pedido_ids.length > 0
          ? row.operational_pedido_ids
          : [row?.id]
      ))
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  ));
  const itensPorPedidoRaw = new Map<string, any[]>();
  const internalShipmentPedidoIds = new Set<string>();
  const fulfillmentByPedido = new Map<string, { source: string | null; selectedAt: string | null }>();
  for (let index = 0; index < pedidoIds.length; index += 200) {
    const chunkIds = pedidoIds.slice(index, index + 200);
    const [itemsResult, internalRowsResult] = await Promise.all([
      serviceClient
        .from('pedido_itens')
        .select('pedido_id,titulo,quantidade,seller_sku,ml_item_id,valor_unitario,valor_total_liquido')
        .in('pedido_id', chunkIds),
      serviceClient
        .from('pedidos')
        .select('id,envio_interno_at,fulfillment_source,fulfillment_selected_at')
        .in('id', chunkIds),
    ]);

    if (itemsResult.error) {
      logDbError('pedidos_items_enrich_failed', '/api/pedidos', '', itemsResult.error, {
        pedidos_count: chunkIds.length,
      });
    } else {
      for (const item of itemsResult.data || []) {
        const pedidoId = String(item.pedido_id || '');
        if (!itensPorPedidoRaw.has(pedidoId)) itensPorPedidoRaw.set(pedidoId, []);
        itensPorPedidoRaw.get(pedidoId)!.push(item);
      }
    }
    if (internalRowsResult.error) {
      logDbError('pedidos_internal_shipments_enrich_failed', '/api/pedidos', '', internalRowsResult.error, {
        pedidos_count: chunkIds.length,
      });
    } else {
      for (const internalRow of internalRowsResult.data || []) {
        const pedidoId = String(internalRow.id || '');
        if (internalRow.envio_interno_at) internalShipmentPedidoIds.add(pedidoId);
        fulfillmentByPedido.set(pedidoId, {
          source: internalRow.fulfillment_source || null,
          selectedAt: internalRow.fulfillment_selected_at || null,
        });
      }
    }
  }
  rows = rows.map((row) => {
    const operationalIds = Array.isArray(row?.operational_pedido_ids) && row.operational_pedido_ids.length > 0
      ? row.operational_pedido_ids.map((id: unknown) => String(id || '')).filter(Boolean)
      : [String(row?.id || '')].filter(Boolean);
    const sources = Array.from(new Set(
      operationalIds
        .map((id: string) => fulfillmentByPedido.get(id)?.source || null)
        .filter(Boolean),
    ));
    const selectedDates = operationalIds
      .map((id: string) => fulfillmentByPedido.get(id)?.selectedAt || null)
      .filter((value: string | null): value is string => Boolean(value))
      .sort();
    return {
      ...row,
      fulfillment_source: sources.length === 1 ? sources[0] : null,
      fulfillment_selected_at: selectedDates.at(-1) || null,
    };
  });
  const itensPorPedido = new Map<string, any[]>();
  for (const row of rows) {
    const rowId = String(row?.id || '');
    const operationalIds = Array.isArray(row?.operational_pedido_ids) && row.operational_pedido_ids.length > 0
      ? row.operational_pedido_ids
      : [row?.id];
    itensPorPedido.set(
      rowId,
      operationalIds.flatMap((id: unknown) => itensPorPedidoRaw.get(String(id || '')) || []),
    );
  }
  const fornecedorPreviewByPedido = await resolveFornecedorPreviewByPedido(itensPorPedido, serviceClient);
  const hasFullInternalShipment = (row: any) => {
    const operationalIds = Array.isArray(row?.operational_pedido_ids) && row.operational_pedido_ids.length > 0
      ? row.operational_pedido_ids.map((id: unknown) => String(id || '')).filter(Boolean)
      : [String(row?.id || '')].filter(Boolean);
    return operationalIds.length > 0 && operationalIds.every((id: string) => internalShipmentPedidoIds.has(id));
  };

  const clienteIdPorMlId = new Map<string, string>();
  const buyerMlIds = Array.from(new Set(
    rows
      .map((row) => String(row?.buyer_ml_id || '').trim())
      .filter(Boolean),
  ));
  for (let index = 0; index < buyerMlIds.length; index += 200) {
    const chunkIds = buyerMlIds.slice(index, index + 200);
    const { data, error } = await serviceClient
      .from('clientes')
      .select('id,ml_id')
      .in('ml_id', chunkIds);
    if (error) {
      logDbError('pedidos_clients_enrich_failed', '/api/pedidos', '', error, {
        buyers_count: chunkIds.length,
      });
    } else {
      for (const cliente of data || []) {
        if (cliente.ml_id) clienteIdPorMlId.set(String(cliente.ml_id), cliente.id);
      }
    }
  }

  const dsids = Array.from(new Set(
    rows
      .flatMap((row) => (
        Array.isArray(row?.operational_dslite_ids)
          ? row.operational_dslite_ids
          : [row?.dslite_id]
      ))
      .map((dsliteId) => String(dsliteId || '').trim())
      .filter(Boolean),
  ));
  if (!dsids.length) {
    return rows.map((row) => ({
      ...row,
      pedido_itens: itensPorPedido.get(String(row?.id || '')) || [],
      cliente_id: clienteIdPorMlId.get(String(row?.buyer_ml_id || '')) || null,
      operational_internal_stock: hasFullInternalShipment(row),
      ...(row?.envio_interno_at
        ? { fornecedor_id: null, fornecedor_nome: 'Estoque Interno', supplier_payment_mode: null, supplier_payment_status: null, supplier_payment_amount: null }
        : (fornecedorPreviewByPedido.get(String(row?.id || '')) || {})),
      dslite_next_action: row?.envio_interno_at ? 'internal_shipping' : row?.dslite_id ? 'complete_dslite_label' : 'create_dslite_order',
      dslite_next_action_label: row?.envio_interno_at ? 'Envio interno' : row?.dslite_id ? 'Completar etiqueta DSLite' : 'Criar pedido DSLite',
    }));
  }

  const compras: any[] = [];
  for (let index = 0; index < dsids.length; index += 500) {
    const chunk = dsids.slice(index, index + 500);
    const { data, error } = await serviceClient
      .from('compras')
      .select('id,dsid,fornecedor_id,fornecedor_nome,produto_descricao,produto_sku,quantidade,supplier_payment_mode,supplier_payment_status,supplier_payment_amount,supplier_payment_receipt_path,supplier_payment_reference,supplier_payment_notes')
      .in('dsid', chunk);

    if (error) {
      logDbError('pedidos_compras_enrich_failed', '/api/pedidos', '', error, {
        dsids_count: dsids.length,
      });
      return rows.map((row) => ({
        ...row,
        pedido_itens: itensPorPedido.get(String(row?.id || '')) || [],
        cliente_id: clienteIdPorMlId.get(String(row?.buyer_ml_id || '')) || null,
      }));
    }
    compras.push(...(data || []));
  }

  const comprasByDsid = new Map(compras.map((compra) => [String(compra.dsid), compra]));
  const fornecedorIds = Array.from(new Set(
    compras
      .map((compra) => String(compra?.fornecedor_id || '').trim())
      .filter(Boolean),
  ));
  const fornecedores: any[] = [];
  for (let index = 0; index < fornecedorIds.length; index += 500) {
    const chunk = fornecedorIds.slice(index, index + 500);
    const { data } = await serviceClient
      .from('fornecedores')
      .select('dslite_id,telefone,supplier_pix_key')
      .in('dslite_id', chunk);
    fornecedores.push(...(data || []));
  }
  const fornecedorByDsliteId = new Map(fornecedores.map((fornecedor) => [String(fornecedor.dslite_id), fornecedor]));

  return rows.map((row) => {
    const operationalCompras = (Array.isArray(row?.operational_dslite_ids) ? row.operational_dslite_ids : [row?.dslite_id])
      .map((dsliteId: unknown) => comprasByDsid.get(String(dsliteId || '')))
      .filter(Boolean);
    const operationalSupplierIds = Array.from(new Set(
      operationalCompras.map((compra: any) => String(compra?.fornecedor_id || '').trim()).filter(Boolean),
    ));
    const operationalInternalStock = hasFullInternalShipment(row);
    if (row?.envio_interno_at) {
      return {
        ...row,
        pedido_itens: itensPorPedido.get(String(row?.id || '')) || [],
        cliente_id: clienteIdPorMlId.get(String(row?.buyer_ml_id || '')) || null,
        operational_supplier_ids: operationalSupplierIds,
        operational_internal_stock: operationalInternalStock,
        compra_id: null,
        fornecedor_id: null,
        fornecedor_nome: 'Estoque Interno',
        fornecedor_telefone: null,
        supplier_payment_mode: null,
        supplier_payment_status: null,
        supplier_payment_amount: null,
        supplier_payment_receipt_path: null,
        supplier_payment_reference: null,
        supplier_payment_notes: null,
        supplier_pix_key: null,
        dslite_next_action: 'internal_shipping',
        dslite_next_action_label: 'Envio interno',
      };
    }

    const compra = comprasByDsid.get(String(row?.dslite_id || ''));
    if (!compra) {
      return {
        ...row,
        pedido_itens: itensPorPedido.get(String(row?.id || '')) || [],
        cliente_id: clienteIdPorMlId.get(String(row?.buyer_ml_id || '')) || null,
        operational_supplier_ids: operationalSupplierIds,
        operational_internal_stock: operationalInternalStock,
        ...(row?.envio_interno_at
          ? { fornecedor_id: null, fornecedor_nome: 'Estoque Interno', supplier_payment_mode: null, supplier_payment_status: null, supplier_payment_amount: null }
          : (fornecedorPreviewByPedido.get(String(row?.id || '')) || {})),
        dslite_next_action: row?.envio_interno_at ? 'internal_shipping' : row?.dslite_id ? 'complete_dslite_label' : 'create_dslite_order',
        dslite_next_action_label: row?.envio_interno_at ? 'Envio interno' : row?.dslite_id ? 'Completar etiqueta DSLite' : 'Criar pedido DSLite',
      };
    }
    const releaseAt = row?.ml_fiscal_release_at ? new Date(row.ml_fiscal_release_at) : null;
    const labelKnownPrintable = String(row?.situacao || '') === 'etiqueta_impressa';
    const labelPendingByMl = Boolean(
      !labelKnownPrintable
      && releaseAt
      && !Number.isNaN(releaseAt.getTime())
      && releaseAt.getTime() > Date.now(),
    );
    const paymentMode = String(compra.supplier_payment_mode || '');
    const paymentStatus = String(compra.supplier_payment_status || '');
    const hasReceipt = Boolean(compra.supplier_payment_receipt_path);
    const labelSent = Boolean(
      row?.dslite_etiqueta_enviada
      || String(row?.dslite_label_source || '') === 'dslite_paid_shipping',
    );
    const fornecedor = fornecedorByDsliteId.get(String(compra.fornecedor_id || ''));
    const deferBkr1PaymentUntilRealLabel = Boolean(
      isBkr1Supplier(compra.fornecedor_id, compra.fornecedor_nome)
      && paymentMode === 'prepaid_pix'
      && paymentStatus !== 'paid'
      && String(row?.dslite_label_source || '') === 'placeholder_release_window_bkr1'
      && labelPendingByMl,
    );
    let nextAction = 'done';
    let nextActionLabel = 'OK';

    if (paymentMode === 'prepaid_pix' && paymentStatus !== 'paid' && !deferBkr1PaymentUntilRealLabel) {
      nextAction = 'confirm_supplier_payment';
      nextActionLabel = 'Confirmar PIX';
    } else if (paymentMode === 'prepaid_pix' && paymentStatus === 'paid' && !hasReceipt) {
      nextAction = 'send_supplier_receipt';
      nextActionLabel = 'Anexar comprovante';
    } else if (paymentMode === 'prepaid_pix' && paymentStatus === 'paid' && hasReceipt && !labelSent) {
      nextAction = 'resume_dslite_flow';
      nextActionLabel = 'Retomar fluxo';
    } else if (!labelSent && labelPendingByMl) {
      nextAction = 'wait_ml_label';
      nextActionLabel = 'Aguardando ML';
    } else if (!labelSent) {
      nextAction = 'complete_dslite_label';
      nextActionLabel = 'Completar etiqueta';
    }

    return {
      ...row,
      pedido_itens: itensPorPedido.get(String(row?.id || '')) || [],
      cliente_id: clienteIdPorMlId.get(String(row?.buyer_ml_id || '')) || null,
      operational_supplier_ids: operationalSupplierIds,
      operational_internal_stock: operationalInternalStock,
      compra_id: compra.id || null,
      compra_produto_descricao: compra.produto_descricao || null,
      compra_produto_sku: compra.produto_sku || null,
      compra_quantidade: compra.quantidade ?? null,
      fornecedor_id: compra.fornecedor_id || null,
      fornecedor_nome: compra.fornecedor_nome || null,
      fornecedor_telefone: fornecedor?.telefone || null,
      supplier_payment_mode: compra.supplier_payment_mode || null,
      supplier_payment_status: compra.supplier_payment_status || null,
      supplier_payment_amount: compra.supplier_payment_amount ?? null,
      supplier_payment_receipt_path: compra.supplier_payment_receipt_path || null,
      supplier_payment_reference: compra.supplier_payment_reference || null,
      supplier_payment_notes: compra.supplier_payment_notes || null,
      supplier_pix_key: fornecedor?.supplier_pix_key || null,
      dslite_next_action: nextAction,
      dslite_next_action_label: nextActionLabel,
    };
  });
}

async function enrichPedidosForOperationalView(
  rows: any[],
  serviceClient: ReturnType<typeof createServiceClient>,
  persistReconciliation = true,
) {
  const reconciledRows = persistReconciliation
    ? await persistReconciledPedidos(rows)
    : rows.map((row) => reconcileNotaFiscalEmitidaRow(row).row);
  const withPurchases = await enrichPedidosWithCompras(reconciledRows, serviceClient);
  return enrichOrdersWithWhatsappStatus(withPurchases, serviceClient);
}

function applyPedidoFilters(query: any, filters: {
  status: string;
  dateFrom: string | null;
  endDateIso: string | null;
  priceMin: number | null;
  priceMax: number | null;
  useSaleDate?: boolean;
}) {
  const {
    status,
    dateFrom,
    endDateIso,
    priceMin,
    priceMax,
    useSaleDate = true,
  } = filters;
  const dateColumn = useSaleDate ? 'data_venda' : 'data';

  if (status) {
    query = query.eq('situacao', status);
  }
  if (dateFrom) {
    query = query.gte(dateColumn, dateFrom);
  }
  if (endDateIso) {
    query = query.lte(dateColumn, endDateIso);
  }
  if (priceMin !== null) {
    query = query.gte('operational_total', priceMin);
  }
  if (priceMax !== null) {
    query = query.lte('operational_total', priceMax);
  }
  return query;
}

function applyOperationalViewFilter(query: any, view: OrdersOperationalView) {
  if (view === 'urgent') {
    return query.in('situacao', [...PREPARATION_ORDER_STATUSES]);
  }
  if (view === 'preparation') {
    return query.in('situacao', [...PREPARATION_ORDER_STATUSES]);
  }
  if (view === 'shipping') {
    return query.in('situacao', [...SHIPPING_ORDER_STATUSES]);
  }
  if (view === 'delivered') {
    return query.eq('situacao', 'entregue');
  }
  return query;
}

function applyPedidoSort(query: any, sortBy: string, sortOrder: 'asc' | 'desc') {
  return applyPedidoSortWithMode(query, sortBy, sortOrder, true);
}

function applyPedidoSortWithMode(query: any, sortBy: string, sortOrder: 'asc' | 'desc', useSaleDate: boolean) {
  const ascending = sortOrder === 'asc';

  switch (sortBy) {
    case 'numero':
      return query.order('numero', { ascending });
    case 'cliente':
      return query
        .order('billing_nome', { ascending, nullsFirst: false })
        .order('contato_nome', { ascending, nullsFirst: false });
    case 'total':
      return query.order('operational_total', { ascending });
    case 'rastreio':
      return query.order('rastreio', { ascending, nullsFirst: false });
    case 'situacao':
      return query.order('situacao', { ascending });
    case 'nota_fiscal_numero':
      return query.order('nota_fiscal_numero', { ascending, nullsFirst: false });
    case 'pedido_compra':
      return query.order('dslite_id', { ascending, nullsFirst: false });
    case 'lucro':
      return query.order('operational_lucro', { ascending });
    case 'data':
    default:
      return useSaleDate
        ? query
            .order('data_venda', { ascending, nullsFirst: false })
            .order('data', { ascending })
        : query.order('data', { ascending });
  }
}

export async function GET(request: Request) {
  noStore();
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;
  const serviceClient = createServiceClient();
  const persistReconciliation = request.headers.get('x-vortek-read-only') !== '1';

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const maxPageSize = request.headers.get('x-vortek-read-only') === '1' ? 1000 : 100;
  const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(searchParams.get('pageSize') || '100')));
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const priceMin = searchParams.get('priceMin') ? parseFloat(searchParams.get('priceMin')!) : null;
  const priceMax = searchParams.get('priceMax') ? parseFloat(searchParams.get('priceMax')!) : null;
  const fornecedorFilterIds = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const normalizedSearch = search.trim();
  const rawSortBy = searchParams.get('sortBy') || 'data';
  const rawSortOrder = searchParams.get('sortOrder') || 'desc';
  const operationalView = parseOrdersOperationalView(searchParams.get('operationalView'));
  const allowedSortBy = new Set([
    'numero',
    'data',
    'cliente',
    'total',
    'rastreio',
    'situacao',
    'nota_fiscal_numero',
    'pedido_compra',
    'lucro',
  ]);
  const sortBy = allowedSortBy.has(rawSortBy) ? rawSortBy : 'data';
  const sortOrder = rawSortOrder === 'asc' ? 'asc' : 'desc';
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const startDateIso = dateFrom ? saoPauloDateParamToUtcIso(dateFrom, 'start') : null;
  const endDateIso = dateTo ? saoPauloDateParamToUtcIso(dateTo, 'end') : null;
  let supplierOptions;
  try {
    supplierOptions = await listActiveSupplierOptions(serviceClient);
  } catch (error: any) {
    logDbError('pedidos_suppliers_query_failed', '/api/pedidos', normalizedSearch, error);
    return NextResponse.json({ erro: 'Falha ao carregar fornecedores.' }, { status: 500 });
  }
  const supplierFilterDsliteIds = mapSupplierFilterIdsToDsliteIds(fornecedorFilterIds, supplierOptions);
  const includeInternalSupplier = includesInternalSupplierFilter(fornecedorFilterIds);
  const listResponse = (data: any[], total: number) => NextResponse.json({
    data,
    total,
    page,
    pageSize,
    fornecedores: supplierOptions,
  });

  if (fornecedorFilterIds.length > 0) {
    async function loadSupplierCandidates(useSaleDate: boolean) {
      const candidates: any[] = [];

      if (normalizedSearch) {
        let searchPage = 1;
        let searchTotal = 0;
        while (true) {
          const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_paginated', {
            p_search: normalizedSearch,
            p_status: status || null,
            p_date_from: startDateIso,
            p_date_to: endDateIso,
            p_price_min: priceMin,
            p_price_max: priceMax,
            p_page: searchPage,
            p_page_size: 100,
            p_sort_by: sortBy,
            p_sort_order: sortOrder,
          });
          if (rpcError) return { data: candidates, error: rpcError };
          const chunk = Array.isArray(rpcData?.data) ? rpcData.data : [];
          searchTotal = Number(rpcData?.total ?? searchTotal ?? 0);
          candidates.push(...chunk);
          if (chunk.length < 100 || candidates.length >= searchTotal) break;
          searchPage += 1;
        }
        return { data: candidates, error: null };
      }

      const chunkSize = 500;
      while (true) {
        let query = (serviceClient as any).from('pedidos_operacionais').select('*');
        query = applyPedidoFilters(query, {
          status,
          dateFrom: startDateIso,
          endDateIso,
          priceMin,
          priceMax,
          useSaleDate,
        });
        query = applyOperationalViewFilter(query, operationalView);
        query = applyPedidoSortWithMode(query, sortBy, sortOrder, useSaleDate);
        const offset = candidates.length;
        const { data: chunk, error: chunkError } = await query.range(offset, offset + chunkSize - 1);
        if (chunkError) return { data: candidates, error: chunkError };
        candidates.push(...(chunk || []));
        if ((chunk || []).length < chunkSize) return { data: candidates, error: null };
      }
    }

    let candidatesResult = await loadSupplierCandidates(true);
    if (!normalizedSearch && isMissingSaleDateColumnError(candidatesResult.error)) {
      candidatesResult = await loadSupplierCandidates(false);
    }
    if (candidatesResult.error) {
      logDbError('pedidos_supplier_filter_query_failed', '/api/pedidos', normalizedSearch, candidatesResult.error, {
        operationalView,
      });
      return NextResponse.json({ erro: 'Falha ao filtrar pedidos por fornecedor.' }, { status: 500 });
    }

    const enrichedRows = await enrichPedidosForOperationalView(candidatesResult.data, serviceClient, persistReconciliation);
    const filteredRows = enrichedRows
      .filter((row) => matchesOrdersOperationalView(row, operationalView))
      .filter((row) => matchesOrderSupplierFilter({
        row,
        supplierDsliteIds: supplierFilterDsliteIds,
        includeInternal: includeInternalSupplier,
      }));
    return listResponse(filteredRows.slice(from, to + 1), filteredRows.length);
  }

  if (normalizedSearch && operationalView !== 'all') {
    const allRows: any[] = [];
    let searchTotal = 0;
    let searchPage = 1;

    while (true) {
      const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_paginated', {
        p_search: normalizedSearch,
        p_status: status || null,
        p_date_from: startDateIso,
        p_date_to: endDateIso,
        p_price_min: priceMin,
        p_price_max: priceMax,
        p_page: searchPage,
        p_page_size: 100,
        p_sort_by: sortBy,
        p_sort_order: sortOrder,
      });

      if (rpcError) {
        logDbError('pedidos_operational_search_rpc_failed', '/api/pedidos', normalizedSearch, rpcError, {
          operationalView,
          searchPage,
        });
        return NextResponse.json({ erro: 'Falha ao buscar pedidos na visão operacional.' }, { status: 500 });
      }

      const rows = Array.isArray(rpcData?.data) ? rpcData.data : [];
      searchTotal = Number(rpcData?.total ?? searchTotal ?? 0);
      allRows.push(...rows);
      if (rows.length < 100 || allRows.length >= searchTotal) break;
      searchPage += 1;
    }

    const enrichedRows = await enrichPedidosForOperationalView(allRows, serviceClient, persistReconciliation);
    const filteredRows = enrichedRows.filter((row) => matchesOrdersOperationalView(row, operationalView));

    return listResponse(filteredRows.slice(from, to + 1), filteredRows.length);
  }

  if (normalizedSearch) {
    const { data: rpcData, error: rpcError } = await (serviceClient as any).rpc('search_pedidos_paginated', {
      p_search: normalizedSearch,
      p_status: status || null,
      p_date_from: startDateIso,
      p_date_to: endDateIso,
      p_price_min: priceMin,
      p_price_max: priceMax,
      p_page: page,
      p_page_size: pageSize,
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
    });

    if (rpcError) {
      logDbError('pedidos_search_rpc_failed', '/api/pedidos', normalizedSearch, rpcError, {
        rpc_name: 'search_pedidos_paginated',
        sortBy,
        sortOrder,
        search_present: true,
        fallback_used: false,
      });
      return NextResponse.json({ erro: 'Falha ao buscar pedidos com filtro de busca.' }, { status: 500 });
    }

    const rows = Array.isArray(rpcData?.data) ? rpcData.data : [];
    const total = Number(rpcData?.total ?? 0) || 0;
    const enrichedRows = await enrichPedidosForOperationalView(rows, serviceClient, persistReconciliation);

    return listResponse(enrichedRows, total);
  }

  const filterContext = {
    status,
    dateFrom: startDateIso,
    endDateIso,
    priceMin,
    priceMax,
  };

  if (operationalView === 'urgent') {
    async function loadUrgentCandidates(useSaleDate: boolean) {
      const candidates: any[] = [];
      const chunkSize = 500;

      while (true) {
        let query = (serviceClient as any).from('pedidos_operacionais').select('*');
        query = applyPedidoFilters(query, { ...filterContext, useSaleDate });
        query = applyOperationalViewFilter(query, operationalView);
        query = applyPedidoSortWithMode(query, sortBy, sortOrder, useSaleDate);
        const offset = candidates.length;
        const { data: chunk, error: chunkError } = await query.range(offset, offset + chunkSize - 1);
        if (chunkError) return { data: candidates, error: chunkError };
        candidates.push(...(chunk || []));
        if ((chunk || []).length < chunkSize) return { data: candidates, error: null };
      }
    }

    let urgentResult = await loadUrgentCandidates(true);
    if (isMissingSaleDateColumnError(urgentResult.error)) {
      urgentResult = await loadUrgentCandidates(false);
    }
    if (urgentResult.error) {
      logDbError('pedidos_urgent_query_failed', '/api/pedidos', normalizedSearch, urgentResult.error, {
        operationalView,
      });
      return NextResponse.json({ erro: 'Falha ao carregar pedidos urgentes.' }, { status: 500 });
    }

    const enrichedRows = await enrichPedidosForOperationalView(urgentResult.data, serviceClient, persistReconciliation);
    const urgentRows = enrichedRows.filter((row) => matchesOrdersOperationalView(row, 'urgent'));
    return listResponse(urgentRows.slice(from, to + 1), urgentRows.length);
  }

  async function runListQueries(useSaleDate: boolean) {
    let countQuery = (serviceClient as any).from('pedidos_operacionais').select('*', { count: 'exact', head: false }).range(0, 0);
    countQuery = applyPedidoFilters(countQuery, { ...filterContext, useSaleDate });
    countQuery = applyOperationalViewFilter(countQuery, operationalView);
    const countResult = await countQuery;

    let dataQuery = (serviceClient as any).from('pedidos_operacionais').select('*');
    dataQuery = applyPedidoFilters(dataQuery, { ...filterContext, useSaleDate });
    dataQuery = applyOperationalViewFilter(dataQuery, operationalView);
    dataQuery = applyPedidoSortWithMode(dataQuery, sortBy, sortOrder, useSaleDate);
    const dataResult = await dataQuery.range(from, to);

    return { countResult, dataResult };
  }

  let {
    countResult: { count, error: countError },
    dataResult: { data, error },
  } = await runListQueries(true);

  const missingSaleDateColumn = isMissingSaleDateColumnError(countError) || isMissingSaleDateColumnError(error);
  if (missingSaleDateColumn) {
    logDbError('pedidos_schema_drift_fallback_data', '/api/pedidos', normalizedSearch, countError || error, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: true,
      fallback_reason: 'missing_data_venda_column',
    });

    ({
      countResult: { count, error: countError },
      dataResult: { data, error },
    } = await runListQueries(false));
  }

  if (countError) {
    logDbError('pedidos_count_query_failed', '/api/pedidos', normalizedSearch, countError, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: missingSaleDateColumn,
    });
    return NextResponse.json({ erro: 'Falha ao contar pedidos filtrados.' }, { status: 500 });
  }

  if (error) {
    logDbError('pedidos_data_query_failed', '/api/pedidos', normalizedSearch, error, {
      sortBy,
      sortOrder,
      search_present: false,
      fallback_used: missingSaleDateColumn,
    });
    return NextResponse.json({ erro: 'Falha ao carregar pedidos.' }, { status: 500 });
  }

  const enrichedRows = await enrichPedidosForOperationalView(data || [], serviceClient, persistReconciliation);

  return listResponse(enrichedRows, count || 0);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const body = await request.json();
  const { data, error } = await serviceClient.from('pedidos').insert(body).select().single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
