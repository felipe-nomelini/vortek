import { z } from 'zod';

const mlOrderShippingSchema = z.object({
  tags: z.array(z.string()).optional().catch([]),
  shipping: z.object({
    id: z.union([z.string(), z.number()]).nullable().optional(),
  }).nullable().optional(),
}).passthrough();

export type MlOrderShippingMode = {
  isNoShipping: boolean;
  shipmentId: string | null;
  tags: string[];
};

/**
 * Interpreta somente os campos necessários para separar Mercado Envios de
 * vendas com entrega combinada (`no_shipping`).
 */
export function parseMlOrderShippingMode(payload: unknown): MlOrderShippingMode {
  const parsed = mlOrderShippingSchema.safeParse(payload);
  if (!parsed.success) {
    return { isNoShipping: false, shipmentId: null, tags: [] };
  }

  const tags = parsed.data.tags ?? [];
  const shipmentId = parsed.data.shipping?.id == null
    ? null
    : String(parsed.data.shipping.id).trim() || null;

  return {
    isNoShipping: tags.includes('no_shipping') && !shipmentId,
    shipmentId,
    tags,
  };
}
