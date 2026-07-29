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

export type MlVirtualKitOrderGroup = {
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
