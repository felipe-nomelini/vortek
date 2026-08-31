import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  consultarPedido,
  definirTransportadoraPedido,
  findDsliteShippingOptionForCarrier,
  listarTransportadorasPedido,
} from '@/services/dslite';
import { fetchML } from '@/services/integration';
import { createServiceClient } from '@/lib/supabase';
import { parseMlOrderShippingMode } from '@/lib/ml/order-shipping-mode';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { calculateOrderProfit } from '@/services/orders';
import {
  HOMOLOGATION_FIXTURE_READ_ONLY_ERROR,
  isHomologationFixtureSource,
} from '@/lib/homologation-fixture';

const requestSchema = z.object({
  pedidoId: z.string().uuid(),
  dsid: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
  transportadoraId: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
});

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parsed.data.dsid || !parsed.data.transportadoraId) {
    return NextResponse.json({ error: 'Pedido, DSID e transportadora são obrigatórios.' }, { status: 400 });
  }

  const { pedidoId, dsid, transportadoraId } = parsed.data;
  const client = createServiceClient();
  const { data: pedido, error: pedidoError } = await client
    .from('pedidos')
    .select('id,numero,ml_order_id,dslite_id,frete,lucro,snapshot_source')
    .eq('id', pedidoId)
    .maybeSingle();

  if (pedidoError || !pedido) {
    return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
  }
  if (isHomologationFixtureSource((pedido as any).snapshot_source)) {
    return NextResponse.json(HOMOLOGATION_FIXTURE_READ_ONLY_ERROR, { status: 409 });
  }
  if (String((pedido as any).dslite_id || '').trim() !== dsid) {
    return NextResponse.json({ error: 'DSID não pertence ao pedido informado.' }, { status: 409 });
  }

  const mlOrderId = String((pedido as any).ml_order_id || '').trim();
  const mlOrder = mlOrderId
    ? await fetchML<unknown>(`/orders/${encodeURIComponent(mlOrderId)}`).catch(() => null)
    : null;
  const shippingMode = parseMlOrderShippingMode(mlOrder);
  if (shippingMode.isNoShippingFulfilled) {
    await client
      .from('pedidos')
      .update({ situacao: 'entregue' } as any)
      .eq('id', pedidoId);
    await registrarEventoNfAuditoria({
      pedidoId,
      mlOrderId: mlOrderId || null,
      evento: 'ml_no_shipping_detected',
      respostaMl: {
        fulfilled: true,
        flow: 'dslite_paid_shipping_selection',
        action: 'blocked_already_fulfilled',
      },
      statusResultante: 'fulfilled_blocked',
    });
    return NextResponse.json(
      { error: 'Venda já concluída no Mercado Livre. Frete DSLite não será alterado.' },
      { status: 409 },
    );
  }
  if (!shippingMode.isNoShipping) {
    return NextResponse.json(
      { error: 'Seleção de frete DSLite permitida somente para venda sem Mercado Envios.' },
      { status: 409 },
    );
  }

  const options = await listarTransportadorasPedido(dsid);
  const selected = findDsliteShippingOptionForCarrier(options, transportadoraId);
  if (!selected) {
    return NextResponse.json({ error: 'Transportadora não disponível para este pedido.' }, { status: 409 });
  }
  if (selected.requiresLabel) {
    return NextResponse.json(
      { error: 'Esta opção exige etiqueta externa e não é um frete pago do fornecedor.' },
      { status: 409 },
    );
  }
  if (selected.error || !(selected.price > 0)) {
    return NextResponse.json(
      { error: selected.error || 'Cotação sem valor válido. Consulte novamente antes de selecionar.' },
      { status: 409 },
    );
  }

  const selection = await definirTransportadoraPedido(dsid, selected.transportadoraId);
  if (!selection?.success) {
    return NextResponse.json(
      { error: selection?.message || 'Falha ao selecionar transportadora na DSLite.' },
      { status: 502 },
    );
  }

  const pedidoDslite = await consultarPedido(dsid);
  const tracking = String(pedidoDslite?.rastreamento || '').trim() || null;
  const statusDslite = String(pedidoDslite?.status || '').trim() || null;
  const { lucro: nextProfit } = await calculateOrderProfit(mlOrder as any, null, {
    allowShipmentFetch: false,
    sellerShippingCost: selected.price,
  });

  await Promise.all([
    client
      .from('compras')
      .update({
        valor_frete: selected.price,
        ...(tracking ? { rastreio: tracking } : {}),
        ...(statusDslite ? { status_dslite: statusDslite } : {}),
      } as any)
      .eq('dsid', dsid),
    client
      .from('pedidos')
      .update({
        frete: selected.price,
        ...(nextProfit == null ? {} : { lucro: nextProfit }),
        ...(tracking ? { rastreio: tracking } : {}),
        ...(statusDslite ? { dslite_status: statusDslite } : {}),
        dslite_etiqueta_enviada: false,
        dslite_label_source: 'dslite_paid_shipping',
      } as any)
      .eq('id', pedidoId),
  ]);

  await registrarEventoNfAuditoria({
    pedidoId,
    mlOrderId: mlOrderId || null,
    evento: 'dslite_paid_shipping_selected',
    payloadEnviado: {
      dsid,
      transportadora_id: selected.transportadoraId,
    },
    respostaMl: {
      carrier_name: selected.name,
      service_name: selected.serviceName,
      estimated_price: selected.price,
      estimated_delivery_days: selected.deliveryDays,
      tracking,
      dslite_status: statusDslite,
    },
    statusResultante: 'success',
  });

  return NextResponse.json({
    success: true,
    data: {
      dsid,
      shipping: selected,
      tracking,
      status: statusDslite,
      message: `${selected.serviceName} selecionado na DSLite.`,
    },
  });
}
