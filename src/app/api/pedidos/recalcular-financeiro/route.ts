import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { fetchMLResult } from '@/services/integration';
import { calculateOrderProfit } from '@/services/orders';
import { extractSellerShippingCost } from '@/lib/ml/shipment-costs';

type PedidoRow = Pick<
  Database['public']['Tables']['pedidos']['Row'],
  'id' | 'numero' | 'data' | 'ml_order_id' | 'ml_shipment_id' | 'frete' | 'lucro' | 'totais_snapshot'
>;

type PedidoItemRow = Pick<
  Database['public']['Tables']['pedido_itens']['Row'],
  'id' | 'pedido_id' | 'quantidade' | 'valor_total_bruto' | 'desconto_item' | 'frete_rateado_item' | 'valor_total_liquido'
>;

function isAuthorizedRequest(request: Request): boolean {
  const apiKey = request.headers.get('x-api-key') || '';
  return Boolean(apiKey && apiKey === process.env.API_SECRET_KEY);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toIsoDateStart(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function toIsoDateEnd(value: string): string {
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const orderNumbers = Array.isArray(body?.orderNumbers)
    ? body.orderNumbers.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
    : [];
  const dateFrom = String(body?.dateFrom || '').trim();
  const dateTo = String(body?.dateTo || '').trim();
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 100)));

  const serviceClient = createServiceClient();
  let pedidosQuery = serviceClient
    .from('pedidos')
    .select('id,numero,data,ml_order_id,ml_shipment_id,frete,lucro,totais_snapshot')
    .not('ml_order_id', 'is', null)
    .order('data', { ascending: false })
    .limit(limit);

  if (orderNumbers.length > 0) {
    pedidosQuery = pedidosQuery.in('numero', orderNumbers);
  } else if (dateFrom || dateTo) {
    if (dateFrom) pedidosQuery = pedidosQuery.gte('data', toIsoDateStart(dateFrom));
    if (dateTo) pedidosQuery = pedidosQuery.lte('data', toIsoDateEnd(dateTo));
  } else {
    const last30Days = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
    pedidosQuery = pedidosQuery.gte('data', last30Days);
  }

  const { data: pedidos, error: pedidosError } = await pedidosQuery;
  if (pedidosError) {
    return NextResponse.json({ error: `Falha ao carregar pedidos: ${pedidosError.message}` }, { status: 500 });
  }

  const pedidosRows = (pedidos || []) as PedidoRow[];
  const pedidoIds = pedidosRows.map((pedido) => pedido.id);
  const { data: pedidoItens, error: pedidoItensError } = pedidoIds.length > 0
    ? await serviceClient
        .from('pedido_itens')
        .select('id,pedido_id,quantidade,valor_total_bruto,desconto_item,frete_rateado_item,valor_total_liquido')
        .in('pedido_id', pedidoIds)
    : { data: [], error: null };

  if (pedidoItensError) {
    return NextResponse.json({ error: `Falha ao carregar itens dos pedidos: ${pedidoItensError.message}` }, { status: 500 });
  }

  const itemsByPedidoId = new Map<string, PedidoItemRow[]>();
  for (const item of (pedidoItens || []) as PedidoItemRow[]) {
    const current = itemsByPedidoId.get(item.pedido_id) || [];
    current.push(item);
    itemsByPedidoId.set(item.pedido_id, current);
  }

  const processed = [];
  const errors = [];

  for (const pedido of pedidosRows) {
    const mlOrderId = String(pedido.ml_order_id || '').trim();
    if (!mlOrderId) {
      errors.push({ numero: pedido.numero, error: 'Pedido sem ml_order_id' });
      continue;
    }

    const orderResult = await fetchMLResult<any>(`/orders/${mlOrderId}`);
    if (!orderResult.ok || !orderResult.data) {
      errors.push({ numero: pedido.numero, error: orderResult.error?.message || 'Falha ao buscar order no ML' });
      continue;
    }

    const shipmentResult = await fetchMLResult<any>(`/orders/${mlOrderId}/shipments`);
    const shipmentDetail = shipmentResult.ok ? shipmentResult.data : null;

    let shipmentCostsPayload: any = null;
    let sellerShippingCost: number | null = null;
    if (shipmentDetail?.id) {
      const shipmentCostsResult = await fetchMLResult<any>(`/shipments/${shipmentDetail.id}/costs`);
      if (shipmentCostsResult.ok && shipmentCostsResult.data) {
        shipmentCostsPayload = shipmentCostsResult.data;
        sellerShippingCost = extractSellerShippingCost(shipmentCostsPayload, shipmentDetail?.sender_id);
      }
    }

    const financial = await calculateOrderProfit(orderResult.data, shipmentDetail, {
      allowShipmentFetch: false,
      sellerShippingCost,
      shipmentCostsPayload,
    });

    const itemRows = itemsByPedidoId.get(pedido.id) || [];
    const totalQty = itemRows.reduce((sum, item) => sum + Number(item.quantidade || 0), 0);
    let totalProdutos = 0;
    let descontoTotal = 0;
    let totalCalculadoComFrete = 0;
    let totalCalculadoSemFrete = 0;

    for (const item of itemRows) {
      const quantidade = Number(item.quantidade || 0);
      const valorTotalBruto = Number(item.valor_total_bruto || 0);
      const descontoItem = Number(item.desconto_item || 0);
      const baseSemFrete = round2(valorTotalBruto - descontoItem);
      const freteRateado = totalQty > 0 ? round2((financial.frete * quantidade) / totalQty) : 0;
      const valorTotalLiquido = round2(baseSemFrete + freteRateado);

      totalProdutos += valorTotalBruto;
      descontoTotal += descontoItem;
      totalCalculadoSemFrete += baseSemFrete;
      totalCalculadoComFrete += valorTotalLiquido;

      const { error: itemUpdateError } = await serviceClient
        .from('pedido_itens')
        .update({
          frete_rateado_item: freteRateado,
          valor_total_liquido: valorTotalLiquido,
        } as any)
        .eq('id', item.id);

      if (itemUpdateError) {
        errors.push({
          numero: pedido.numero,
          error: `Falha ao atualizar item ${item.id}: ${itemUpdateError.message}`,
        });
      }
    }

    const existingSnapshot: Record<string, any> = isPlainObject(pedido.totais_snapshot)
      ? pedido.totais_snapshot as Record<string, any>
      : {};
    const currentTotals: Record<string, any> = isPlainObject(existingSnapshot.totais)
      ? existingSnapshot.totais as Record<string, any>
      : {};
    const nextSnapshot = {
      ...existingSnapshot,
      totais: {
        ...currentTotals,
        total_produtos: round2(totalProdutos),
        frete_total: round2(financial.frete),
        desconto_total: round2(descontoTotal),
        total_final: round2(Number(orderResult.data?.total_amount || 0)),
        total_calculado_com_frete: round2(totalCalculadoComFrete),
        total_calculado_sem_frete: round2(totalCalculadoSemFrete),
      },
    };

    const { error: pedidoUpdateError } = await serviceClient
      .from('pedidos')
      .update({
        frete: round2(financial.frete),
        lucro: financial.lucro === null ? null : round2(financial.lucro),
        totais_snapshot: nextSnapshot as any,
      } as any)
      .eq('id', pedido.id);

    if (pedidoUpdateError) {
      errors.push({
        numero: pedido.numero,
        error: `Falha ao atualizar pedido: ${pedidoUpdateError.message}`,
      });
      continue;
    }

    processed.push({
      numero: pedido.numero,
      ml_order_id: mlOrderId,
      frete_anterior: Number(pedido.frete || 0),
      frete_novo: round2(financial.frete),
      lucro_anterior: pedido.lucro,
      lucro_novo: financial.lucro === null ? null : round2(financial.lucro),
      itens_atualizados: itemRows.length,
    });
  }

  return NextResponse.json({
    success: true,
    processed_count: processed.length,
    error_count: errors.length,
    processed,
    errors,
  });
}
