/**
 * Calcula o lucro real de um pedido do Mercado Livre.
 * Busca custos dos produtos no banco e frete na API do ML.
 */

import { createServiceClient } from '@/lib/supabase';
import { fetchML } from './integration';
import { getSkuLookupVariants } from '@/lib/sku';

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
  const skuLookupVariants = Array.from(new Set(skus.flatMap((sku) => getSkuLookupVariants(sku))));

  let custoTotal = 0;
  let taxasTotal = 0;
  let itensEncontrados = 0;

  if (itemIds.length > 0) {
    const { data: produtosPorMlItem } = await serviceClient
      .from('produtos')
      .select('ml_item_id, sku, custo, ml_fee')
      .in('ml_item_id', itemIds);

    const { data: produtosPorSku } = skuLookupVariants.length > 0
      ? await serviceClient
          .from('produtos')
          .select('ml_item_id, sku, custo, ml_fee')
          .in('sku', skuLookupVariants)
      : { data: [] };

    const [{ data: ofertasPorSku }, { data: ofertasPorSkuFornecedor }] = skuLookupVariants.length > 0
      ? await Promise.all([
          serviceClient
            .from('produto_fornecedor_ofertas')
            .select('produto_id,sku_oferta,custo')
            .in('sku_oferta', skuLookupVariants),
          serviceClient
            .from('produto_fornecedor_ofertas')
            .select('produto_id,sku_fornecedor,custo')
            .in('sku_fornecedor', skuLookupVariants),
        ])
      : [{ data: [] }, { data: [] }];

    const offerProductIds = Array.from(new Set([
      ...((ofertasPorSku || []) as any[]).map((row) => String(row.produto_id || '').trim()),
      ...((ofertasPorSkuFornecedor || []) as any[]).map((row) => String(row.produto_id || '').trim()),
    ].filter(Boolean)));

    const { data: produtosPorOferta } = offerProductIds.length > 0
      ? await serviceClient
          .from('produtos')
          .select('id, ml_item_id, sku, custo, ml_fee')
          .in('id', offerProductIds)
      : { data: [] };

    const mlItemMap = new Map(produtosPorMlItem?.map((p) => [p.ml_item_id, p]) || []);
    const skuMap = new Map(produtosPorSku?.map((p) => [p.sku, p]) || []);
    const productsById = new Map((produtosPorOferta || []).map((p: any) => [String(p.id || ''), p]));
    const offerSkuMap = new Map<string, any>();

    const registerOfferSku = (skuValue: unknown, offer: any) => {
      const offerSku = String(skuValue || '').trim();
      if (!offerSku) return;
      const product = productsById.get(String(offer.produto_id || ''));
      const row = {
        ...(product || {}),
        custo: Number(offer.custo || product?.custo || 0),
      };
      offerSkuMap.set(offerSku, row);
      for (const originalSku of skus) {
        if (getSkuLookupVariants(originalSku).includes(offerSku)) {
          offerSkuMap.set(originalSku, row);
        }
      }
    };

    for (const offer of (ofertasPorSku || []) as any[]) registerOfferSku(offer.sku_oferta, offer);
    for (const offer of (ofertasPorSkuFornecedor || []) as any[]) registerOfferSku(offer.sku_fornecedor, offer);

    for (const item of orderItems) {
      const mlItemId = item.item?.id;
      const sku = item.item?.seller_sku;
      const qty = item.quantity || 1;
      const skuVariants = getSkuLookupVariants(sku);
      const produto = (mlItemId && mlItemMap.get(mlItemId))
        || (sku && skuMap.get(sku))
        || skuVariants.map((variant) => skuMap.get(variant) || offerSkuMap.get(variant)).find(Boolean)
        || (sku && offerSkuMap.get(sku));
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
