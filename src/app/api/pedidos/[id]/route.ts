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
    dslite_id: String(row.dsid),
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

  const [ordersResult, itemsResult, purchasesResult, historyResult] = await Promise.all([
    operationalPedidoIds.length
      ? client
          .from('pedidos')
          .select('id,ml_order_id,numero,dslite_id,fulfillment_source,envio_interno_at,dslite_status')
          .in('id', operationalPedidoIds)
      : Promise.resolve({ data: [], error: null }),
    operationalPedidoIds.length
      ? client
          .from('pedido_itens')
          .select('pedido_id,titulo,quantidade,seller_sku,ml_item_id,valor_unitario,valor_total_liquido')
          .in('pedido_id', operationalPedidoIds)
      : Promise.resolve({ data: [], error: null }),
    operationalDsliteIds.length
      ? client
          .from('compras')
          .select('id,dsid,status,status_dslite,fornecedor_id,fornecedor_nome,produto_descricao,produto_sku,quantidade,valor_total,valor_frete,supplier_payment_mode,supplier_payment_status,supplier_payment_amount,supplier_payment_reference,supplier_payment_notes,nf_numero,nf_chave,rastreio')
          .in('dsid', operationalDsliteIds)
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

  const failed = [ordersResult, itemsResult, purchasesResult, historyResult].find((result) => result.error);
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

  const purchases = (purchasesResult.data || []).map(mapPurchase);
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
