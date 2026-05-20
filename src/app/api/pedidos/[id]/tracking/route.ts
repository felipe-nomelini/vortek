import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { fetchML } from '@/services/integration';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { id } = await params;

  // Buscar pedido no banco
  const { data: pedido, error } = await supabase
    .from('pedidos')
    .select('ml_order_id, ml_shipment_id, ml_claim_id, ml_claim_status, rastreio')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!pedido) return NextResponse.json({ erro: 'Pedido não encontrado' }, { status: 404 });

  const result: {
    currentStatus: string;
    currentSubstatus: string | null;
    carrier: { name: string; trackingUrl: string | null } | null;
    history: Array<{ status: string; substatus: string; date: string; description: string }>;
    returnHistory: Array<{ status: string; substatus: string; date: string; description: string; shipmentId: string }>;
    returnShipments: Array<{ shipmentId: string; status: string; trackingNumber: string | null; type: string; destination: string }>;
    claim: { id: string; status: string; type: string; stage: string; reason: string } | null;
    rastreio: string | null;
  } = {
    currentStatus: 'desconhecido',
    currentSubstatus: null,
    carrier: null,
    history: [],
    returnHistory: [],
    returnShipments: [],
    claim: null,
    rastreio: pedido.rastreio,
  };

  // 1. Buscar dados do shipment original (forward)
  if (pedido.ml_shipment_id) {
    try {
      const [current, historyData, carrier] = await Promise.all([
        fetchML<any>(`/shipments/${pedido.ml_shipment_id}`),
        fetchML<any[]>(`/shipments/${pedido.ml_shipment_id}/history`, { headers: { 'x-format-new': 'true' } }),
        fetchML<any>(`/shipments/${pedido.ml_shipment_id}/carrier`),
      ]);

      if (current) {
        result.currentStatus = current.status || 'desconhecido';
        result.currentSubstatus = current.substatus || null;
        if (!result.rastreio && current.tracking_number) {
          result.rastreio = current.tracking_number;
        }
      }

      if (historyData && Array.isArray(historyData)) {
        result.history = historyData.map((h: any) => ({
          status: h.status || '',
          substatus: h.substatus || '',
          date: h.date || '',
          description: traduzirSubstatus(h.substatus || h.status),
        })).filter((h: any) => h.date || h.status);
      }

      if (carrier) {
        result.carrier = {
          name: carrier.name || carrier.company || carrier.tracking_method || 'Transportadora',
          trackingUrl: carrier.tracking_url || carrier.url || null,
        };
      }
    } catch (err: any) {
      console.error(`[tracking][${id}] Erro ao buscar forward tracking:`, err?.message);
    }
  }

  // 2. Buscar dados da devolução (return)
  if (pedido.ml_claim_id) {
    try {
      // Buscar detalhes da claim
      const claim = await fetchML<any>(`/post-purchase/v1/claims/${pedido.ml_claim_id}`);
      if (claim) {
        result.claim = {
          id: String(pedido.ml_claim_id),
          status: claim.status || 'desconhecido',
          type: claim.type || '',
          stage: claim.stage || '',
          reason: traduzirMotivoClaim(claim.reason_id),
        };
      }

      // Buscar detalhes da devolução
      const returnData = await fetchML<any>(`/post-purchase/v2/claims/${pedido.ml_claim_id}/returns`);
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
            const returnHistoryData = await fetchML<any[]>(`/shipments/${shipId}/history`, {
              headers: { 'x-format-new': 'true' }
            });

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
            console.error(`[tracking][${id}] Erro ao buscar return history para shipment ${shipId}:`, err?.message);
          }
        }

        // Ordenar returnHistory por data
        result.returnHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      }
    } catch (err: any) {
      console.error(`[tracking][${id}] Erro ao buscar return data:`, err?.message);
    }
  }

  console.log(`[tracking][${id}] returning: forward=${result.history.length}, return=${result.returnHistory.length}, returnShipments=${result.returnShipments.length}`);
  return NextResponse.json(result);
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
