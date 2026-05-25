import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML, buscarXmlDaNF } from '@/services/integration';
import { calculateOrderProfit } from '@/services/orders';
import { criarPedidoDropshipping } from '@/services/dslite';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

function normalizeNfeStatus(status: string | null | undefined): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'authorized' || normalized === 'autorizada') return 'autorizada';
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancelada') return 'cancelada';
  if (!normalized) return 'pendente';
  return normalized;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { topic, resource } = body;

    if (!topic || !resource) {
      return NextResponse.json({ ok: false, erro: 'topic e resource obrigatórios' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const resourcePath = resource.replace('https://api.mercadolibre.com', '');

    if (topic === 'orders_v2') {
      const order = await fetchML<any>(resourcePath);
      if (order) {
        const { data: existing } = await serviceClient
          .from('pedidos')
          .select('id')
          .eq('ml_order_id', String(order.id))
          .maybeSingle();

        // Buscar detalhes completos do pedido (inclui order_items para cálculo de lucro)
        const detail = await fetchML<any>(`/orders/${order.id}`).catch(() => null);

        // Calcular lucro
        const { lucro, rastreio } = await calculateOrderProfit(detail);

        const pedidoPayload = {
          numero: Number(order.id) || 0,
          numero_loja: String(order.id || ''),
          data: order.date_created || new Date().toISOString(),
          contato_nome: order.buyer?.nickname || 'Desconhecido',
          contato_documento: String(order.buyer?.identification?.number || ''),
          total: order.total_amount || 0,
          situacao: order.status === 'paid' ? 'aberto' : 'atendido' as any,
          ml_order_id: String(order.id || ''),
          ml_pack_id: order.pack_id ? String(order.pack_id) : null,
          lucro,
          rastreio,
        } as any;

        if (existing) {
          await serviceClient.from('pedidos').update(pedidoPayload).eq('id', existing.id);
        } else {
          const { data: inserted } = await serviceClient
            .from('pedidos')
            .insert(pedidoPayload)
            .select('id')
            .single();

          if (inserted && order.status === 'paid') {
            const xmlSimples = `<?xml version="1.0" encoding="UTF-8"?>
<pedido>
  <cliente>${order.buyer?.nickname || 'Cliente'}</cliente>
  <valor>${order.total_amount || 0}</valor>
  <ml_order_id>${order.id}</ml_order_id>
</pedido>`;
            const dsliteResult = await criarPedidoDropshipping(xmlSimples);
            if (dsliteResult) {
              await serviceClient
                .from('pedidos')
                .update({
                  dslite_id: String(dsliteResult.dsid),
                  dslite_status: dsliteResult.status,
                })
                .eq('id', inserted.id);
            }
          }
        }
      }
    }

    if (topic === 'questions') {
      // Notificações de perguntas — serão processadas sob demanda
    }

    if (topic === 'items') {
      // Notificações de alterações em anúncios — serão processadas sob demanda
    }

    if (topic === 'shipments' || topic === 'shipment_update') {
      const shipment = await fetchML<any>(resourcePath);
      if (shipment?.id) {
        // Buscar pedido associado ao shipment
        const orderId = shipment.order_id || shipment.resource_id;
        if (orderId) {
          const situacao = mapearStatusShipment(shipment.status, shipment.substatus);
          // Não sobrescrever devolvido
          const { data: pedido } = await serviceClient
            .from('pedidos')
            .select('situacao')
            .eq('ml_order_id', String(orderId))
            .maybeSingle();
          const situacaoFinal = pedido?.situacao === 'devolvido' ? 'devolvido' : situacao;
          await serviceClient
            .from('pedidos')
            .update({
              ml_shipment_id: String(shipment.id),
              situacao: situacaoFinal as any,
            })
            .eq('ml_order_id', String(orderId));
        }
      }
    }

    if (topic === 'claims' || topic === 'claim_update') {
      const claim = await fetchML<any>(resourcePath);
      if (claim?.resource_id && claim.resource === 'order') {
        const isDevolvido = claim.resolution?.reason === 'item_returned' ||
                           (claim.resolution?.closed_by === 'mediator' &&
                            claim.resolution?.benefited?.includes('complainant'));
        const situacao = isDevolvido ? 'devolvido' : undefined;
        await serviceClient
          .from('pedidos')
          .update({
            ml_claim_id: String(claim.id),
            ml_claim_status: claim.status || null,
            ...(situacao ? { situacao } : {}),
          })
          .eq('ml_order_id', String(claim.resource_id));
      }
    }

    if (topic === 'invoices') {
      const invoice = await fetchML<any>(resourcePath);
      if (invoice?.order_id) {
        const { data: pedido } = await serviceClient
          .from('pedidos')
          .select('id, ml_pack_id')
          .eq('ml_order_id', String(invoice.order_id))
          .maybeSingle();
        const normalizedStatus = normalizeNfeStatus(invoice.status);
        const isAuthorized = normalizedStatus === 'autorizada';
        const invoiceKey = invoice.key || invoice.attributes?.invoice_key || null;

        await registrarEventoNfAuditoria({
          pedidoId: pedido?.id || null,
          mlOrderId: String(invoice.order_id),
          mlPackId: pedido?.ml_pack_id || null,
          evento: 'retorno_ml',
          respostaMl: {
            invoice_id: invoice.id || null,
            invoice_number: invoice.number || invoice.invoice_number || null,
            status: invoice.status || null,
            invoice_key: invoiceKey,
          },
          statusResultante: normalizedStatus,
        });

        // Tenta baixar o XML se a NF estiver autorizada
        let nfeXml: string | null = null;
        if (isAuthorized) {
          await registrarEventoNfAuditoria({
            pedidoId: pedido?.id || null,
            mlOrderId: String(invoice.order_id),
            mlPackId: pedido?.ml_pack_id || null,
            evento: 'download_xml',
            payloadEnviado: { invoice_id: invoice.id || null },
            statusResultante: 'started',
          });
          const xmlResult = await buscarXmlDaNF(String(invoice.order_id));
          if (xmlResult.xml) {
            nfeXml = xmlResult.xml;
          }
          await registrarEventoNfAuditoria({
            pedidoId: pedido?.id || null,
            mlOrderId: String(invoice.order_id),
            mlPackId: pedido?.ml_pack_id || null,
            evento: 'download_xml',
            respostaMl: {
              status_code_ml: xmlResult.status_code_ml ?? null,
              error_code_ml: xmlResult.error_code_ml ?? null,
              has_xml: Boolean(xmlResult.xml),
              error: xmlResult.error || null,
            },
            statusResultante: xmlResult.xml ? 'success' : 'failed',
          });
        }

        await serviceClient
          .from('pedidos')
          .update({
            nota_fiscal_numero: invoice.number || invoice.invoice_number || invoice.id,
            nota_fiscal_emitida: isAuthorized && !!invoiceKey && !!nfeXml,
            nfe_status: normalizedStatus,
            nfe_chave: invoiceKey,
            ...(nfeXml ? { nfe_xml: nfeXml } : {}),
          })
          .eq('ml_order_id', String(invoice.order_id));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro desconhecido' }, { status: 500 });
  }
}

function mapearStatusShipment(shipmentStatus: string, shipmentSubstatus?: string): string {
  switch (shipmentStatus) {
    case 'pending':
      return 'pendente';
    case 'handling':
      return 'preparando';
    case 'ready_to_ship':
      if (shipmentSubstatus === 'printed') return 'etiqueta_impressa';
      if (shipmentSubstatus === 'dropped_off') return 'coletado';
      if (shipmentSubstatus === 'picked_up') return 'coletado';
      return 'pronto_envio';
    case 'shipped':
      if (shipmentSubstatus === 'out_for_delivery') return 'saiu_entrega';
      if (shipmentSubstatus === 'receiver_absent') return 'dest_ausente';
      return 'em_transito';
    case 'delivered':
      return 'entregue';
    case 'not_delivered':
      if (shipmentSubstatus === 'refused_delivery') return 'recusado';
      return 'dest_ausente';
    case 'cancelled':
      return 'cancelado';
    default:
      return 'aberto';
  }
}
