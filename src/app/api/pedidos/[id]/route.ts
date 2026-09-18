import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { loadOperationalSale } from '@/lib/mobile-sale-lookup';
import { mapSaleHistoryEvent } from '@/lib/mobile-sales';
import { buildSaleDetailGroups } from '@/lib/orders/sale-detail';
import { createServiceClient } from '@/lib/supabase';
import type {
  PedidoVendaCompraDetalheApiDto,
  PedidoVendaDetalheApiResponse,
} from '@/types/order';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const orderIdSchema = z.string().uuid();

function mapPurchase(row: any): PedidoVendaCompraDetalheApiDto {
  return {
    id: String(row.id),
    dslite_id: String(row.dsid || ''),
    pedido_id: row.pedido_id || null,
    evolusom_order_id: row.evolusom_order_id || null,
    status: row.status || null,
    status_dslite: row.status_dslite || null,
    fornecedor_id: row.fornecedor_id || null,
    fornecedor_nome: row.fornecedor_nome || null,
    produto_descricao: row.produto_descricao || null,
    produto_sku: row.produto_sku || null,
    quantidade: row.quantidade == null ? null : Number(row.quantidade),
    valor_total: row.valor_total == null ? null : Number(row.valor_total),
    valor_frete: row.valor_frete == null ? null : Number(row.valor_frete),
    supplier_payment_mode: row.supplier_payment_mode || null,
    supplier_payment_status: row.supplier_payment_status || null,
    supplier_payment_amount: row.supplier_payment_amount == null ? null : Number(row.supplier_payment_amount),
    supplier_settlement_id: row.supplier_settlement_id || null,
    supplier_payment_reference: row.supplier_payment_reference || null,
    supplier_payment_notes: row.supplier_payment_notes || null,
    nf_numero: row.nf_numero || null,
    nf_chave: row.nf_chave || null,
    rastreio: row.rastreio || null,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const parsedId = orderIdSchema.safeParse(rawId);
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID();
  if (!parsedId.success) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_SALE_ID', message: 'Identificador da venda inválido' }, meta: { requestId } },
      { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    );
  }

  const readOnlyHeaders = new Headers(request.headers);
  readOnlyHeaders.set('x-vortek-read-only', '1');
  const lookup = await loadOperationalSale(
    new Request(request.url, { headers: readOnlyHeaders }),
    parsedId.data,
  );
  if (!lookup.ok) return lookup.response;

  const order = lookup.row;
  const operationalPedidoIds = (Array.isArray(order.operational_pedido_ids)
    ? order.operational_pedido_ids
    : [order.id])
    .map((value: unknown) => String(value || '').trim())
    .filter(Boolean);
  const operationalDsliteIds = (Array.isArray(order.operational_dslite_ids)
    ? order.operational_dslite_ids
    : [order.dslite_id])
    .map((value: unknown) => String(value || '').trim())
    .filter(Boolean);
  const client = createServiceClient();

  const [ordersResult, itemsResult, purchasesResult, directPurchasesResult, historyResult] = await Promise.all([
    operationalPedidoIds.length
      ? client
          .from('pedidos')
          .select('id,ml_order_id,numero,dslite_id,fulfillment_source,envio_interno_at,dslite_status')
          .in('id', operationalPedidoIds)
      : Promise.resolve({ data: [], error: null }),
    operationalPedidoIds.length
      ? client
          .from('pedido_itens')
          .select('pedido_id,titulo,quantidade,seller_sku,ml_item_id,valor_unitario,valor_total_liquido,cmv_unitario_snapshot,cmv_total_snapshot,cmv_capturado_em')
          .in('pedido_id', operationalPedidoIds)
      : Promise.resolve({ data: [], error: null }),
    operationalDsliteIds.length
      ? client
          .from('compras')
          .select('id,dsid,status,status_dslite,fornecedor_id,fornecedor_nome,produto_descricao,produto_sku,quantidade,valor_total,valor_frete,supplier_payment_mode,supplier_payment_status,supplier_payment_amount,supplier_settlement_id,supplier_payment_reference,supplier_payment_notes,nf_numero,nf_chave,rastreio')
          .in('dsid', operationalDsliteIds)
      : Promise.resolve({ data: [], error: null }),
    operationalPedidoIds.length
      ? client.from('compras').select('id,dsid,pedido_id,evolusom_order_id,status,status_dslite,fornecedor_id,fornecedor_nome,produto_descricao,produto_sku,quantidade,valor_total,valor_frete,supplier_payment_mode,supplier_payment_status,supplier_payment_amount,supplier_settlement_id,supplier_payment_reference,supplier_payment_notes,nf_numero,nf_chave,rastreio')
          .in('pedido_id', operationalPedidoIds)
      : Promise.resolve({ data: [], error: null }),
    operationalPedidoIds.length
      ? client
          .from('nf_auditoria_eventos')
          .select('id,evento,status_resultante,created_at')
          .in('pedido_id', operationalPedidoIds)
          .order('created_at', { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const failed = [ordersResult, itemsResult, purchasesResult, directPurchasesResult, historyResult].find((result) => result.error);
  if (failed?.error) {
    console.error('[sale-detail] Falha ao carregar detalhe da venda', {
      requestId,
      saleId: parsedId.data,
      code: failed.error.code,
    });
    return NextResponse.json(
      { data: null, error: { code: 'SALE_DETAIL_FAILED', message: 'Falha ao carregar detalhes da venda' }, meta: { requestId } },
      { status: 500, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    );
  }

  const purchases = [...(purchasesResult.data || []), ...(directPurchasesResult.data || [])].map(mapPurchase);
  const settlementIds = [...new Set(purchases.map((purchase) => purchase.supplier_settlement_id).filter((id): id is string => Boolean(id)))];
  if (settlementIds.length) {
    const [headers, items] = await Promise.all([
      client.from('supplier_settlements').select('id,status').in('id', settlementIds),
      client.from('supplier_settlement_items').select('compra_id,credit_amount,pix_amount').in('settlement_id', settlementIds).is('released_at', null),
    ]);
    if (headers.error || items.error) return NextResponse.json({ data: null, error: { code: 'SETTLEMENT_READ_FAILED', message: 'Falha ao consultar liquidação' }, meta: { requestId } }, { status: 500 });
    const statusById = new Map((headers.data || []).map((row) => [row.id, row.status]));
    const allocationByPurchase = new Map((items.data || []).map((row) => [row.compra_id, row]));
    for (const purchase of purchases) {
      purchase.supplier_settlement_status = statusById.get(purchase.supplier_settlement_id || '') || null;
      purchase.supplier_settlement_credit_amount = allocationByPurchase.get(purchase.id)?.credit_amount ?? null;
      purchase.supplier_settlement_pix_amount = allocationByPurchase.get(purchase.id)?.pix_amount ?? null;
    }
  }
  const { groups, unmatchedPurchases } = buildSaleDetailGroups({
    operationalPedidoIds,
    operationalDsliteIds,
    orders: ordersResult.data || [],
    items: itemsResult.data || [],
    purchases,
  });
  const payload: PedidoVendaDetalheApiResponse = {
    data: {
      order,
      groups,
      unmatchedPurchases,
      history: (historyResult.data || []).map(mapSaleHistoryEvent),
    },
    error: null,
    meta: { requestId },
  };

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
  });
}
