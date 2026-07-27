import { z } from 'zod';

const mlOrderShippingSchema = z.object({
  tags: z.array(z.string()).optional().catch([]),
  fulfilled: z.boolean().nullable().optional(),
  shipping: z.object({
    id: z.union([z.string(), z.number()]).nullable().optional(),
  }).nullable().optional(),
}).passthrough();

export type MlOrderShippingMode = {
  isNoShipping: boolean;
  isNoShippingFulfilled: boolean;
  shipmentId: string | null;
  tags: string[];
};

export type MlOrderSituation = 'aberto' | 'cancelado' | 'devolvido' | 'entregue';

/**
 * Interpreta somente os campos necessários para separar Mercado Envios de
 * vendas com entrega combinada (`no_shipping`).
 */
export function parseMlOrderShippingMode(payload: unknown): MlOrderShippingMode {
  const parsed = mlOrderShippingSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      isNoShipping: false,
      isNoShippingFulfilled: false,
      shipmentId: null,
      tags: [],
    };
  }

  const tags = parsed.data.tags ?? [];
  const shipmentId = parsed.data.shipping?.id == null
    ? null
    : String(parsed.data.shipping.id).trim() || null;
  const isNoShipping = tags.includes('no_shipping') && !shipmentId;

  return {
    isNoShipping,
    isNoShippingFulfilled: isNoShipping && parsed.data.fulfilled === true,
    shipmentId,
    tags,
  };
}

/**
 * Resolve situação básica da venda antes de consultar um shipment.
 * Em vendas sem Mercado Envios, `fulfilled=true` é a confirmação de conclusão.
 */
export function resolveMlOrderSituation(params: {
  status: string;
  tags: string[];
  isReturned: boolean;
  isNoShippingFulfilled: boolean;
}): MlOrderSituation {
  if (params.isReturned) return 'devolvido';
  if (params.isNoShippingFulfilled || params.tags.includes('delivered')) return 'entregue';
  if (params.status === 'cancelled') return 'cancelado';
  return 'aberto';
}
