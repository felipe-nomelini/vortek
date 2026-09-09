import 'server-only';
import type { createServiceClient } from '@/lib/supabase';
import { reconcileLocalNfeSnapshotFromXml } from '@/lib/fiscal/nfe-local-reconciliation';
import { isBkr1Supplier } from '@/lib/supplier-balance';
import { resolvePreferredOfferForProduct, resolveSupplierPaymentMode } from '@/lib/produto-fornecedor';
import { getSkuLookupVariants } from '@/lib/sku';
import { calcularSaldoEstoqueInterno, expandirItensReservaEstoqueInterno, type ComposicaoKitEstoqueInterno } from '@/lib/estoque-interno-saldo';
import { calculateInternalFulfillmentCapacity } from '@/lib/orders/fulfillment-capacity';
import { filterOperationalDropshippingSupplierOffers, loadOperationalDropshippingSupplierIds } from '@/lib/dslite/supplier-policy';

export function logDbError(
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

export function reconcileNotaFiscalEmitidaRow(row: any) {
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
      .select('id,produto_id,dslite_fornecedor_id,fornecedor_nome,custo,estoque,ativo,prioridade,payment_mode')
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

  const operationalSupplierIds = await loadOperationalDropshippingSupplierIds(serviceClient);
  const offersByProductId = new Map<string, any[]>();
  for (const offer of filterOperationalDropshippingSupplierOffers(offers || [], operationalSupplierIds)) {
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
      const preferredSupplierId = String(preferredOffer?.dslite_fornecedor_id || '').trim();
      const fornecedorNome = String(preferredOffer?.fornecedor_nome || '').trim();
      return {
        produtoId: String(product.id),
        fornecedorId: preferredSupplierId || null,
        fornecedorNome: fornecedorNome || null,
        paymentMode: preferredOffer?.payment_mode || null,
        custo: Number(preferredOffer?.custo || 0),
        quantidade: Number(item?.quantidade || 1),
        produtoDescricao: product.nome || item?.titulo || null,
        produtoSku: product.sku || item?.seller_sku || null,
      };
    }).filter(Boolean) as Array<{
      produtoId: string;
      fornecedorId: string | null;
      fornecedorNome: string | null;
      paymentMode: string | null;
      custo: number;
      quantidade: number;
      produtoDescricao: string | null;
      produtoSku: string | null;
    }>;
    if (!selected.length) continue;

    let internalStockItems: Array<{ produtoId: string; quantidade: number }> = [];
    let composicaoInternaValida = true;
    try {
      internalStockItems = expandirItensReservaEstoqueInterno(
        selected.map((item) => ({
          produtoId: item.produtoId,
          sku: String(item.produtoSku || item.produtoId),
          quantidade: item.quantidade,
        })),
        internalKitCompositions,
      );
    } catch {
      composicaoInternaValida = false;
    }
    const saldoInternoDisponivelParaPedido = new Map(
      internalStockItems.map((item) => [
        item.produtoId,
        (saldoInternoPorProduto.get(item.produtoId) || 0)
          + (compromissoInternoPorPedidoProduto.get(`${pedidoId}:${item.produtoId}`) || 0),
      ]),
    );
    const estoqueInternoCompleto = composicaoInternaValida
      && selected.length === itens.length
      && calculateInternalFulfillmentCapacity(
        internalStockItems,
        saldoInternoDisponivelParaPedido,
      ) >= 1;
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
    const paymentMode = singleSupplier && first.fornecedorId
      ? resolveSupplierPaymentMode(first.paymentMode, first.fornecedorId)
      : null;
    previews.set(pedidoId, {
      fornecedor_id: singleSupplier ? first.fornecedorId : null,
      fornecedor_nome: singleSupplier ? first.fornecedorNome : 'Múltiplos fornecedores previstos',
      fornecedor_telefone: fornecedor?.telefone || null,
      supplier_pix_key: fornecedor?.supplier_pix_key || null,
      supplier_payment_mode: paymentMode,
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

export async function enrichPedidosWithCompras(rows: any[], serviceClient: ReturnType<typeof createServiceClient>) {
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
