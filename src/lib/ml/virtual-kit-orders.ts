import { z } from 'zod';

const kitOrderSchema = z.object({
  order_id: z.union([z.string(), z.number()]),
  item_id: z.string().nullable().optional(),
  parent_item_id: z.string().nullable().optional(),
  pack_id: z.union([z.string(), z.number()]).nullable().optional(),
  shipment_id: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough();

const bundleSchema = z.object({
  pack_id: z.union([z.string(), z.number()]).nullable().optional(),
  shipment_id: z.union([z.string(), z.number()]).nullable().optional(),
  kit_orders: z.array(kitOrderSchema).optional().catch([]),
}).passthrough();

const responseSchema = z.object({
  bundles: z.array(bundleSchema).optional().catch([]),
}).passthrough();

const packSchema = z.object({
  id: z.union([z.string(), z.number()]),
  shipment: z.object({
    id: z.union([z.string(), z.number()]).nullable().optional(),
  }).nullable().optional(),
  orders: z.array(z.object({
    id: z.union([z.string(), z.number()]),
  }).passthrough()).optional().catch([]),
}).passthrough();

export type MlVirtualKitOrderGroup = {
  orderIds: string[];
  parentItemId: string | null;
  packId: string | null;
  shipmentId: string | null;
};

export type MlPackOrderGroup = {
  orderIds: string[];
  packId: string;
  shipmentId: string | null;
};

export type MlOperationalOrderGroup = {
  type: 'virtual_kit' | 'cart';
  orderIds: string[];
  parentItemId: string | null;
  packId: string | null;
  shipmentId: string | null;
};

/**
 * Extrai somente o grupo de kit virtual que contém a order informada.
 * Carrinhos comuns (`main_orders`/`addons_orders`) ficam fora deste fluxo.
 */
export function parseMlVirtualKitOrderGroup(
  payload: unknown,
  currentOrderId: string,
): MlVirtualKitOrderGroup | null {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) return null;

  const normalizedCurrentOrderId = String(currentOrderId || '').trim();
  for (const bundle of parsed.data.bundles ?? []) {
    const orders = bundle.kit_orders ?? [];
    if (!orders.some((order) => String(order.order_id) === normalizedCurrentOrderId)) {
      continue;
    }

    const orderIds = Array.from(
      new Set(orders.map((order) => String(order.order_id).trim()).filter(Boolean)),
    );
    if (orderIds.length < 2) return null;

    const parentItemIds = Array.from(
      new Set(orders.map((order) => String(order.parent_item_id || '').trim()).filter(Boolean)),
    );
    if (parentItemIds.length !== 1) return null;

    return {
      orderIds,
      parentItemId: parentItemIds[0] || null,
      packId: bundle.pack_id == null ? null : String(bundle.pack_id).trim() || null,
      shipmentId: bundle.shipment_id == null
        ? null
        : String(bundle.shipment_id).trim() || null,
    };
  }

  return null;
}

/**
 * Extrai orders de um pack comum. O filtro por seller deve ser feito depois,
 * consultando cada order, pois um pack pode conter itens de outros vendedores.
 */
export function parseMlPackOrderGroup(
  payload: unknown,
  currentOrderId: string,
): MlPackOrderGroup | null {
  const parsed = packSchema.safeParse(payload);
  if (!parsed.success) return null;

  const orderIds = Array.from(new Set(
    (parsed.data.orders || [])
      .map((order) => String(order.id).trim())
      .filter(Boolean),
  ));
  const normalizedCurrentOrderId = String(currentOrderId || '').trim();
  if (
    orderIds.length < 2
    || !orderIds.includes(normalizedCurrentOrderId)
  ) {
    return null;
  }

  return {
    orderIds,
    packId: String(parsed.data.id).trim(),
    shipmentId: parsed.data.shipment?.id == null
      ? null
      : String(parsed.data.shipment.id).trim() || null,
  };
}

export function filterPackOrdersBySeller(params: {
  currentOrderId: string;
  currentSellerId: string | number | null | undefined;
  orderDetails: Array<{
    id?: string | number | null;
    seller?: { id?: string | number | null } | null;
    total_amount?: number | null;
  } | null>;
}) {
  const currentOrderId = String(params.currentOrderId || '').trim();
  const currentSellerId = String(params.currentSellerId ?? '').trim();
  if (!currentOrderId || !currentSellerId) return [];

  const seen = new Set<string>();
  const filtered = params.orderDetails.filter((detail): detail is NonNullable<typeof detail> => {
    const orderId = String(detail?.id ?? '').trim();
    const sellerId = String(detail?.seller?.id ?? '').trim();
    if (!orderId || sellerId !== currentSellerId || seen.has(orderId)) return false;
    seen.add(orderId);
    return true;
  });
  return filtered.some((detail) => String(detail.id) === currentOrderId)
    ? filtered
    : [];
}

/**
 * Rateia custo único do shipment pelo valor das orders do mesmo seller.
 * Última order absorve diferença de centavos para soma permanecer exata.
 */
export function allocateMlShipmentCost(params: {
  sellerShippingCost: number;
  currentOrderId: string;
  orders: Array<{ id?: string | number | null; total_amount?: number | null }>;
}): number {
  const totalCost = Number(params.sellerShippingCost);
  if (!Number.isFinite(totalCost) || totalCost < 0) return 0;

  const orders = params.orders
    .map((order) => ({
      id: String(order.id ?? '').trim(),
      total: Number(order.total_amount || 0),
    }))
    .filter((order) => order.id && Number.isFinite(order.total) && order.total >= 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (orders.length <= 1) return Number(totalCost.toFixed(2));

  const totalOrders = orders.reduce((sum, order) => sum + order.total, 0);
  if (totalOrders <= 0) return Number(totalCost.toFixed(2));

  let allocated = 0;
  const shares = new Map<string, number>();
  orders.forEach((order, index) => {
    const share = index === orders.length - 1
      ? Number((totalCost - allocated).toFixed(2))
      : Number(((totalCost * order.total) / totalOrders).toFixed(2));
    allocated = Number((allocated + share).toFixed(2));
    shares.set(order.id, share);
  });

  return shares.get(String(params.currentOrderId || '').trim())
    ?? Number(totalCost.toFixed(2));
}
