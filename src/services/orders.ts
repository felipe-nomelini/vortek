/**
 * Agrega economia na base total do pedido, sem usar custo atual como prova histórica.
 * Ausência de CMV, tarifa, frete ou competência mantém o lucro inconclusivo.
 */

import { createServiceClient } from '@/lib/supabase';
import { fetchML } from './integration';
import { loadPricingTaxContext, type PricingTaxContext } from './pricing-tax-context';
import { calculateEconomicTaxCents } from './pricing-economy';
import { resolveOrderSaleDate } from '@/lib/ml/order-sale-date';
import {
  calculateFinalOrderProfit,
  resolveMlSellerShippingCost,
} from '@/lib/ml/order-profit';

export interface OrderDetail {
  id: string | number;
  total_amount?: number;
  date_created?: string;
  date_closed?: string;
  payments?: Array<{ status?: string; date_approved?: string }>;
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
  imposto: number | null;
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
  taxContext?: PricingTaxContext;
  taxContexts?: Map<string, Promise<PricingTaxContext>>;
  historicalCosts?: ReadonlyArray<{ itemId: string; quantity: number; totalCostCents: number; evidenceId: string }>;
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
      imposto: null,
      itensEncontrados: 0,
      rastreio: null,
      freteDisponivel: false,
    };
  }

  const orderItems = detail.order_items || [];
  let custoTotal = 0; let taxasTotal = 0; let itensEncontrados = 0;
  let feesComplete = orderItems.length > 0;
  const usedEvidence = new Set<string>();
  for (const item of orderItems) {
    const qty = item.quantity;
    if (!Number.isSafeInteger(qty) || Number(qty) <= 0) { feesComplete = false; continue; }
    const costs = options?.historicalCosts?.filter(c => c.itemId === item.item?.id && c.quantity === qty) || [];
    const cost = costs.length === 1 ? costs[0] : null;
    if (cost && cost.evidenceId.trim() && !usedEvidence.has(cost.evidenceId)
      && Number.isSafeInteger(cost.totalCostCents) && cost.totalCostCents >= 0) {
      custoTotal += cost.totalCostCents / 100; itensEncontrados++; usedEvidence.add(cost.evidenceId);
    }
    if (item.sale_fee == null || !Number.isFinite(item.sale_fee) || item.sale_fee < 0) feesComplete = false;
    else taxasTotal += item.sale_fee * qty!;
  }
  // Oferta atual e compras.valor_total (que admite fallback da receita) não provam CMV realizado.

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
  const total = detail.total_amount;
  const saleDate = resolveOrderSaleDate(detail).value;
  let imposto: number | null = null;
  if (saleDate) {
    const localMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date(saleDate));
    let pending = options?.taxContexts?.get(localMonth);
    if (!options?.taxContext && !pending) {
      pending = loadPricingTaxContext(createServiceClient(), new Date(`${localMonth}-01T00:00:00.000Z`));
      options?.taxContexts?.set(localMonth, pending);
    }
    const context = options?.taxContext ?? await pending!;
    if (context.referenceMonth === localMonth && context.appliedRate !== null && !context.manualRequired) {
      const cents = calculateEconomicTaxCents(Math.round(Number(total) * 100), context.appliedRate);
      imposto = cents === null ? null : cents / 100;
    }
  }
  const complete = typeof total === 'number' && Number.isFinite(total) && total > 0
    && feesComplete && orderItems.length > 0 && itensEncontrados === orderItems.length;
  const lucro = !complete || imposto === null ? null : calculateFinalOrderProfit({
    total: total!,
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
