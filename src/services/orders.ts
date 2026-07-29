/**
 * Calcula o lucro real de um pedido do Mercado Livre.
 * Busca custos dos produtos no banco e frete na API do ML.
 */

import { createServiceClient } from '@/lib/supabase';
import { fetchML } from './integration';
import { getSkuLookupVariants } from '@/lib/sku';
import {
  calculateFinalOrderProfit,
  resolveMlSellerShippingCost,
} from '@/lib/ml/order-profit';

export interface OrderDetail {
  id: string | number;
  total_amount?: number;
  seller?: { id?: string | number | null };
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
  freteDisponivel: boolean;
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
  sellerShippingCost?: number | null;
}

export async function calculateOrderProfit(
  detail: OrderDetail | null,
  shipmentDetail?: ShipmentDetail | null,
  options?: CalculateOrderProfitOptions,
): Promise<OrderProfitResult> {
  if (!detail) {
    return {
      lucro: null,
      custoTotal: 0,
      taxasTotal: 0,
      frete: 0,
      imposto: 0,
      itensEncontrados: 0,
      rastreio: null,
      freteDisponivel: false,
    };
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
      .select('id, ml_item_id, sku, custo, ml_fee')
      .in('ml_item_id', itemIds);

    const { data: produtosPorSku } = skuLookupVariants.length > 0
      ? await serviceClient
          .from('produtos')
          .select('id, ml_item_id, sku, custo, ml_fee')
          .in('sku', skuLookupVariants)
      : { data: [] };

    const [
      { data: ofertasPorSku },
      { data: ofertasPorSkuFornecedor },
      { data: vinculosCatalogo },
    ] = await Promise.all([
      ...(skuLookupVariants.length > 0
        ? [
          serviceClient
            .from('produto_fornecedor_ofertas')
            .select('produto_id,sku_oferta,custo')
            .in('sku_oferta', skuLookupVariants),
          serviceClient
            .from('produto_fornecedor_ofertas')
            .select('produto_id,sku_fornecedor,custo')
            .in('sku_fornecedor', skuLookupVariants),
        ]
        : [Promise.resolve({ data: [] }), Promise.resolve({ data: [] })]),
      serviceClient
        .from('catalogo_ml_snapshot')
        .select('ml_item_id,produto_id,sku_local')
        .in('ml_item_id', itemIds),
    ]);

    const linkedProductIds = Array.from(new Set([
      ...((ofertasPorSku || []) as any[]).map((row) => String(row.produto_id || '').trim()),
      ...((ofertasPorSkuFornecedor || []) as any[]).map((row) => String(row.produto_id || '').trim()),
      ...((vinculosCatalogo || []) as any[]).map((row) => String(row.produto_id || '').trim()),
    ].filter(Boolean)));

    const { data: produtosVinculados } = linkedProductIds.length > 0
      ? await serviceClient
          .from('produtos')
          .select('id, ml_item_id, sku, custo, ml_fee')
          .in('id', linkedProductIds)
      : { data: [] };

    const mlItemMap = new Map(produtosPorMlItem?.map((p) => [p.ml_item_id, p]) || []);
    const skuMap = new Map(produtosPorSku?.map((p) => [p.sku, p]) || []);
    const productsById = new Map((produtosVinculados || []).map((p: any) => [String(p.id || ''), p]));
    const catalogItemMap = new Map<string, any>();
    const offerSkuMap = new Map<string, any>();

    for (const vinculo of (vinculosCatalogo || []) as any[]) {
      const product = productsById.get(String(vinculo.produto_id || ''));
      const mlItemId = String(vinculo.ml_item_id || '').trim();
      if (product && mlItemId) catalogItemMap.set(mlItemId, product);
    }

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
        || (mlItemId && catalogItemMap.get(mlItemId))
        || (sku && skuMap.get(sku))
        || skuVariants.map((variant) => skuMap.get(variant) || offerSkuMap.get(variant)).find(Boolean)
        || (sku && offerSkuMap.get(sku));
      if (produto) {
        itensEncontrados++;
        const custo = produto.custo || 0;
        const taxa = item.sale_fee ?? produto.ml_fee ?? 0;
        custoTotal += custo * qty;
        taxasTotal += taxa * qty;
      }
    }
  }

  // 2. Buscar frete
  let rastreio: string | null = null;
  let frete = 0;
  let freteDisponivel = false;
  const allowShipmentFetch = options?.allowShipmentFetch ?? true;
  const explicitSellerShippingCost = options?.sellerShippingCost;
  try {
    const shipment = shipmentDetail ?? (allowShipmentFetch ? await fetchML<any>(`/orders/${detail.id}/shipments`) : null);
    if (shipment?.tracking_number) {
      rastreio = shipment.tracking_number;
    }

    if (
      explicitSellerShippingCost !== null
      && explicitSellerShippingCost !== undefined
      && Number.isFinite(Number(explicitSellerShippingCost))
      && Number(explicitSellerShippingCost) >= 0
    ) {
      frete = Number(explicitSellerShippingCost);
      freteDisponivel = true;
    } else if (allowShipmentFetch && shipment?.id) {
      const costs = await fetchML<any>(`/shipments/${encodeURIComponent(String(shipment.id))}/costs`, {
        headers: { 'x-format-new': 'true' },
      });
      const sellerCost = resolveMlSellerShippingCost(costs, detail.seller?.id);
      if (sellerCost !== null) {
        frete = sellerCost;
        freteDisponivel = true;
      }
    }
  } catch {
    // Lucro permanece pendente até o custo final do frete ficar disponível.
  }

  // 3. Calcular lucro
  const total = detail.total_amount || 0;
  const imposto = total * 0.04;
  const lucro = calculateFinalOrderProfit({
    total,
    productCost: custoTotal,
    saleFees: taxasTotal,
    sellerShippingCost: freteDisponivel ? frete : null,
    tax: imposto,
    matchedItems: itensEncontrados,
  });

  return {
    lucro,
    custoTotal,
    taxasTotal,
    frete,
    imposto,
    itensEncontrados,
    rastreio,
    freteDisponivel,
  };
}
