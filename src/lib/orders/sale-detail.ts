import type {
  PedidoOperacionalItemApiDto,
  PedidoVendaCompraDetalheApiDto,
  PedidoVendaGrupoDetalheApiDto,
} from '@/types/order';

type SaleDetailOrderRow = {
  id: string;
  ml_order_id?: string | null;
  numero?: string | number | null;
  dslite_id?: string | null;
  fulfillment_source?: string | null;
  envio_interno_at?: string | null;
  dslite_status?: string | null;
};

type SaleDetailItemRow = PedidoOperacionalItemApiDto & { pedido_id: string };

type BuildSaleDetailGroupsInput = {
  operationalPedidoIds: string[];
  operationalDsliteIds: string[];
  orders: SaleDetailOrderRow[];
  items: SaleDetailItemRow[];
  purchases: PedidoVendaCompraDetalheApiDto[];
};

function normalized(value: unknown): string {
  return String(value || '').trim();
}

export function buildSaleDetailGroups({
  operationalPedidoIds,
  operationalDsliteIds,
  orders,
  items,
  purchases,
}: BuildSaleDetailGroupsInput): {
  groups: PedidoVendaGrupoDetalheApiDto[];
  unmatchedPurchases: PedidoVendaCompraDetalheApiDto[];
} {
  const ordersById = new Map(orders.map((order) => [normalized(order.id), order]));
  const itemsByOrderId = new Map<string, PedidoOperacionalItemApiDto[]>();
  for (const item of items) {
    const orderId = normalized(item.pedido_id);
    const current = itemsByOrderId.get(orderId) || [];
    current.push({
      titulo: item.titulo,
      quantidade: Number(item.quantidade || 0),
      seller_sku: item.seller_sku || null,
      ml_item_id: item.ml_item_id || null,
      valor_unitario: Number(item.valor_unitario || 0),
      valor_total_liquido: Number(item.valor_total_liquido || 0),
    });
    itemsByOrderId.set(orderId, current);
  }
  const purchasesByDsliteId = new Map<string, PedidoVendaCompraDetalheApiDto[]>();
  for (const purchase of purchases) {
    const dsliteId = normalized(purchase.dslite_id);
    const current = purchasesByDsliteId.get(dsliteId) || [];
    current.push(purchase);
    purchasesByDsliteId.set(dsliteId, current);
  }
  const matchedPurchaseIds = new Set<string>();

  const groups = operationalPedidoIds.map((pedidoId) => {
    const order = ordersById.get(normalized(pedidoId));
    const dsliteId = normalized(order?.dslite_id);
    const purchaseCandidates = dsliteId ? purchasesByDsliteId.get(dsliteId) || [] : [];
    const purchase = purchaseCandidates.length === 1 ? purchaseCandidates[0] : null;
    if (purchase) matchedPurchaseIds.add(purchase.id);
    const fulfillmentSource = order?.fulfillment_source === 'internal'
      || order?.fulfillment_source === 'supplier'
      ? order.fulfillment_source
      : null;

    return {
      pedido_id: normalized(pedidoId),
      ml_order_id: normalized(order?.ml_order_id) || null,
      numero: normalized(order?.numero) || null,
      fulfillment_source: fulfillmentSource,
      envio_interno_at: order?.envio_interno_at || null,
      dslite_status: order?.dslite_status || null,
      items: itemsByOrderId.get(normalized(pedidoId)) || [],
      purchase,
    } satisfies PedidoVendaGrupoDetalheApiDto;
  });

  const operationalDsliteIdSet = new Set(operationalDsliteIds.map(normalized).filter(Boolean));
  const unmatchedPurchases = purchases.filter((purchase) => (
    operationalDsliteIdSet.has(normalized(purchase.dslite_id))
    && !matchedPurchaseIds.has(purchase.id)
  ));

  return { groups, unmatchedPurchases };
}
