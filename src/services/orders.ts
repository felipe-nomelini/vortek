/**
 * Calcula o lucro real de um pedido do Mercado Livre.
 * Busca custos dos produtos no banco e frete na API do ML.
 */

import { createServiceClient } from '@/lib/supabase';
import { fetchML } from './integration';

export interface OrderDetail {
  id: string | number;
  total_amount?: number;
  order_items?: Array<{
    item?: { id?: string; seller_sku?: string };
    quantity?: number;
    sale_fee?: number;
  }>;
}

export interface OrderProfitResult {
  lucro: number | null;
  custoTotal: number;
  taxasTotal: number;
  frete: number;
  imposto: number;
  itensEncontrados: number;
  rastreio: string | null;
}

export interface ShipmentDetail {
  id?: string | number;
  tracking_number?: string | null;
  shipping_option?: {
    list_cost?: number | null;
    cost?: number | null;
  } | null;
}

export interface CalculateOrderProfitOptions {
  allowShipmentFetch?: boolean;
}

export async function calculateOrderProfit(
  detail: OrderDetail | null,
  shipmentDetail?: ShipmentDetail | null,
  options?: CalculateOrderProfitOptions,
): Promise<OrderProfitResult> {
  if (!detail) {
    return { lucro: null, custoTotal: 0, taxasTotal: 0, frete: 0, imposto: 0, itensEncontrados: 0, rastreio: null };
  }

  const serviceClient = createServiceClient();

  // 1. Buscar custos dos produtos
  const orderItems = detail.order_items || [];
  const itemIds = orderItems.map((i) => i.item?.id).filter(Boolean) as string[];
  const skus = orderItems.map((i) => i.item?.seller_sku).filter(Boolean) as string[];

  let custoTotal = 0;
  let taxasTotal = 0;
  let itensEncontrados = 0;

  if (itemIds.length > 0) {
    const { data: produtosPorMlItem } = await serviceClient
      .from('produtos')
      .select('ml_item_id, sku, custo, ml_fee')
      .in('ml_item_id', itemIds);

    const { data: produtosPorSku } = skus.length > 0
      ? await serviceClient
          .from('produtos')
          .select('ml_item_id, sku, custo, ml_fee')
          .in('sku', skus)
      : { data: [] };

    const mlItemMap = new Map(produtosPorMlItem?.map((p) => [p.ml_item_id, p]) || []);
    const skuMap = new Map(produtosPorSku?.map((p) => [p.sku, p]) || []);

    for (const item of orderItems) {
      const mlItemId = item.item?.id;
      const sku = item.item?.seller_sku;
      const qty = item.quantity || 1;
      const produto = (mlItemId && mlItemMap.get(mlItemId)) || (sku && skuMap.get(sku));
      if (produto) {
        itensEncontrados++;
        const custo = produto.custo || 0;
        const taxa = item.sale_fee || produto.ml_fee || 0;
        custoTotal += custo * qty;
        taxasTotal += taxa * qty;
      }
    }
  }

  // 2. Buscar frete
  let rastreio: string | null = null;
  let frete = 0;
  const allowShipmentFetch = options?.allowShipmentFetch ?? true;
  try {
    const shipment = shipmentDetail ?? (allowShipmentFetch ? await fetchML<any>(`/orders/${detail.id}/shipments`) : null);
    if (shipment?.tracking_number) {
      rastreio = shipment.tracking_number;
    }
    const shipOpt = shipment?.shipping_option;
    if (shipOpt && typeof shipOpt.list_cost === 'number') {
      const buyerCost = typeof shipOpt.cost === 'number' ? shipOpt.cost : 0;
      frete = shipOpt.list_cost - buyerCost;
    }
  } catch {
    // Ignora erros de shipping
  }

  // 3. Calcular lucro
  const total = detail.total_amount || 0;
  const imposto = total * 0.04;
  const lucro = itensEncontrados > 0 ? total - custoTotal - taxasTotal - frete - imposto : null;

  return {
    lucro,
    custoTotal,
    taxasTotal,
    frete,
    imposto,
    itensEncontrados,
    rastreio,
  };
}
