import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  HOMOLOGATION_FIXTURE_READ_ONLY_ERROR,
  isHomologationFixtureSource,
} from '@/lib/homologation-fixture';
import type { PedidoTrackingApiDto } from '@/types/order';

const ML_NEW_FORMAT_HEADERS = { 'x-format-new': 'true' } as const;

function safeWebUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'sales.track');
  if (!auth.ok) return auth.response;
  const serviceClient = createServiceClient();

  const { id } = await params;

  // Buscar pedido no banco
  const { data: pedido, error } = await serviceClient
    .from('pedidos')
    .select('ml_order_id, ml_shipment_id, ml_claim_id, ml_claim_status, rastreio, snapshot_source')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 });
  if (isHomologationFixtureSource((pedido as any).snapshot_source)) {
    return NextResponse.json(HOMOLOGATION_FIXTURE_READ_ONLY_ERROR, { status: 409 });
  }

  const result: PedidoTrackingApiDto = {
    currentStatus: 'desconhecido',
    currentSubstatus: null,
    carrier: null,
    history: [],
    returnHistory: [],
    returnShipments: [],
    claim: null,
    rastreio: pedido.rastreio,
    warnings: [],
  };
  let requestedExternalResources = 0;
  let successfulExternalResources = 0;

  // 1. Buscar dados do shipment original (forward)
  if (pedido.ml_shipment_id) {
    requestedExternalResources += 3;
    const [currentResult, historyResult, carrierResult] = await Promise.allSettled([
      fetchML<any>(`/shipments/${pedido.ml_shipment_id}`, { headers: ML_NEW_FORMAT_HEADERS }),
      fetchML<any[]>(`/shipments/${pedido.ml_shipment_id}/history`, { headers: ML_NEW_FORMAT_HEADERS }),
      fetchML<any>(`/shipments/${pedido.ml_shipment_id}/carrier`, { headers: ML_NEW_FORMAT_HEADERS }),
    ]);

    if (currentResult.status === 'fulfilled') {
      successfulExternalResources += 1;
      const current = currentResult.value;
      if (current) {
        result.currentStatus = current.status || 'desconhecido';
        result.currentSubstatus = current.substatus || null;
        if (!result.rastreio && current.tracking_number) {
          result.rastreio = current.tracking_number;
        }
      }
    } else {
      result.warnings.push('Não foi possível carregar o estado atual do envio.');
      console.error(`[tracking][${id}] Erro ao buscar shipment atual:`, currentResult.reason instanceof Error ? currentResult.reason.message : 'unknown');
    }

    if (historyResult.status === 'fulfilled') {
      successfulExternalResources += 1;
      const historyData = historyResult.value;
      if (historyData && Array.isArray(historyData)) {
        result.history = historyData.map((h: any) => ({
          status: h.status || '',
          substatus: h.substatus || '',
          date: h.date || '',
          description: traduzirSubstatus(h.substatus || h.status),
        })).filter((h: any) => h.date || h.status);
        result.history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }
    } else {
      result.warnings.push('Não foi possível carregar o histórico do envio.');
      console.error(`[tracking][${id}] Erro ao buscar histórico do shipment:`, historyResult.reason instanceof Error ? historyResult.reason.message : 'unknown');
    }

    if (carrierResult.status === 'fulfilled') {
      successfulExternalResources += 1;
      const carrier = carrierResult.value;
      if (carrier) {
        result.carrier = {
          name: carrier.name || carrier.company || carrier.tracking_method || 'Transportadora',
          trackingUrl: safeWebUrl(carrier.tracking_url || carrier.url),
        };
      }
    } else {
      result.warnings.push('Não foi possível carregar os dados da transportadora.');
      console.error(`[tracking][${id}] Erro ao buscar transportadora:`, carrierResult.reason instanceof Error ? carrierResult.reason.message : 'unknown');
    }
  }

  // 2. Buscar dados da devolução (return)
  if (pedido.ml_claim_id) {
    requestedExternalResources += 2;
    const [claimResult, returnResult] = await Promise.allSettled([
      fetchML<any>(`/post-purchase/v1/claims/${pedido.ml_claim_id}`),
      fetchML<any>(`/post-purchase/v2/claims/${pedido.ml_claim_id}/returns`),
    ]);

    if (claimResult.status === 'fulfilled') {
      successfulExternalResources += 1;
      const claim = claimResult.value;
      if (claim) {
        result.claim = {
          id: String(pedido.ml_claim_id),
          status: claim.status || 'desconhecido',
          type: claim.type || '',
          stage: claim.stage || '',
          reason: traduzirMotivoClaim(claim.reason_id),
        };
      }
    } else {
      result.warnings.push('Não foi possível carregar os dados da reclamação.');
      console.error(`[tracking][${id}] Erro ao buscar claim:`, claimResult.reason instanceof Error ? claimResult.reason.message : 'unknown');
    }

    if (returnResult.status === 'fulfilled') {
      successfulExternalResources += 1;
      const returnData = returnResult.value;
      console.log(`[tracking][${id}] return data:`, returnData ? 'found' : 'null');

      if (returnData?.shipments && Array.isArray(returnData.shipments)) {
        // Salvar info dos return shipments
        result.returnShipments = returnData.shipments.map((s: any) => ({
          shipmentId: String(s.shipment_id || ''),
          status: s.status || 'desconhecido',
          trackingNumber: s.tracking_number || null,
          type: s.type || 'return',
          destination: s.destination?.name || '',
        }));

        // Buscar histórico de cada return shipment
        for (const returnShipment of returnData.shipments) {
          const shipId = returnShipment.shipment_id;
          if (!shipId) continue;

          try {
            requestedExternalResources += 1;
            const returnHistoryData = await fetchML<any[]>(`/shipments/${shipId}/history`, {
              headers: ML_NEW_FORMAT_HEADERS,
            });
            successfulExternalResources += 1;

            if (returnHistoryData && Array.isArray(returnHistoryData)) {
              const mapped = returnHistoryData.map((h: any) => ({
                status: h.status || '',
                substatus: h.substatus || '',
                date: h.date || '',
                description: traduzirSubstatus(h.substatus || h.status),
                shipmentId: String(shipId),
              })).filter((h: any) => h.date || h.status);

              result.returnHistory.push(...mapped);
            }
          } catch (err: any) {
            result.warnings.push(`Não foi possível carregar o histórico da devolução ${String(shipId)}.`);
            console.error(`[tracking][${id}] Erro ao buscar return history para shipment ${shipId}:`, err?.message);
          }
        }

        // Ordenar returnHistory por data
        result.returnHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }
    } else {
      result.warnings.push('Não foi possível carregar os dados da devolução.');
      console.error(`[tracking][${id}] Erro ao buscar return data:`, returnResult.reason instanceof Error ? returnResult.reason.message : 'unknown');
    }
  }

  if (requestedExternalResources > 0 && successfulExternalResources === 0) {
    return NextResponse.json(
      { erro: 'Não foi possível consultar o acompanhamento no Mercado Livre.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  console.log(`[tracking][${id}] returning: forward=${result.history.length}, return=${result.returnHistory.length}, returnShipments=${result.returnShipments.length}`);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

function traduzirSubstatus(substatus: string): string {
  const map: Record<string, string> = {
    printed: 'Etiqueta impressa',
    ready_to_print: 'Pronto para impressão',
    picked_up: 'Coletado pela transportadora',
    in_hub: 'No centro de distribuição',
    in_transit: 'Em trânsito',
    out_for_delivery: 'Saiu para entrega',
    receiver_absent: 'Destinatário ausente',
    refused_delivery: 'Entrega recusada',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
    waiting_for_label_generation: 'Aguardando geração da etiqueta',
    invoice_pending: 'Aguardando nota fiscal',
    dropped_off: 'Entregue no ponto de coleta',
    ready_for_pickup: 'Pronto para coleta',
    ready_for_dropoff: 'Pronto para entrega no ponto',
    in_warehouse: 'No armazém',
    measures_ready: 'Medidas e peso confirmados',
    authorized_by_carrier: 'Autorizado pela transportadora',
    waiting_for_carrier_authorization: 'Aguardando autorização da transportadora',
    handling: 'Em preparação',
    ready_to_ship: 'Pronto para envio',
    shipped: 'Enviado',
    not_delivered: 'Não entregue',
    pending: 'Pendente',
    stale: 'Atrasado',
    delayed: 'Atrasado',
    bad_address: 'Endereço incorreto',
    buyer_rescheduled: 'Reagendado pelo comprador',
    delivery_blocked: 'Entrega bloqueada',
    soon_deliver: 'Em breve na rota de entrega',
    waiting_for_confirmation: 'Aguardando confirmação',
    closed_by_user: 'Fechado pelo usuário',
  };
  return map[substatus] || substatus;
}

function traduzirMotivoClaim(reasonId: string): string {
  const map: Record<string, string> = {
    PDD9549: 'Produto não recebido',
    PDD9550: 'Produto com defeito',
    PDD9551: 'Produto diferente do anunciado',
    PDD9552: 'Arrependimento',
    PDD9553: 'Mercadoria avariada',
    PDD9554: 'Mercadoria incompleta',
    PDD9942: 'Devolução / Item returned',
  };
  return map[reasonId] || reasonId;
}
