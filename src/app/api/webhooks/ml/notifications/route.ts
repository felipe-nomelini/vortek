import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML, fetchMLResult } from '@/services/integration';
import { calculateOrderProfit } from '@/services/orders';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { extractMlFiscalReleaseWindow } from '@/lib/ml/fiscal-release';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';

async function resolveFiscalReleaseWindow(shipment: any | null): Promise<{
  shipmentFetched: boolean;
  releaseCheckOk: boolean;
  releaseWindow: ReturnType<typeof extractMlFiscalReleaseWindow>;
}> {
  const shipmentFetched = Boolean(shipment && typeof shipment === 'object' && shipment.id);
  if (!shipmentFetched) {
    return {
      shipmentFetched: false,
      releaseCheckOk: false,
      releaseWindow: extractMlFiscalReleaseWindow({ shipment: null, leadTime: null }),
    };
  }

  const shipmentId = String(shipment.id);
  const leadTimeResult = await fetchMLResult<any>(`/shipments/${shipmentId}/lead_time`);
  if (!leadTimeResult.ok) {
    console.error(
      `[webhook-ml] Falha ao consultar lead_time do shipment ${shipmentId}: status=${leadTimeResult.status || 0} message=${leadTimeResult.error?.message || 'erro_desconhecido'}`,
    );
  }

  const releaseWindow = extractMlFiscalReleaseWindow({
    shipment,
    leadTime: leadTimeResult.ok ? leadTimeResult.data : null,
  });

  return {
    shipmentFetched: true,
    releaseCheckOk: leadTimeResult.ok,
    releaseWindow,
  };
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
        const shipment = await fetchML<any>(`/orders/${order.id}/shipments`).catch(() => null);
        const releaseInfo = await resolveFiscalReleaseWindow(shipment);
        const shipmentFetched = releaseInfo.shipmentFetched;
        const releaseCheckOk = releaseInfo.releaseCheckOk;
        const fiscalRelease = releaseInfo.releaseWindow;
        const hasFutureRelease = Boolean(fiscalRelease.releaseAt && fiscalRelease.isBlockedNow);
        const { data: existing } = await serviceClient
          .from('pedidos')
          .select('id,snapshot_incompleto,snapshot_pendencias,ml_fiscal_release_at')
          .eq('ml_order_id', String(order.id))
          .maybeSingle();

        // Buscar detalhes completos do pedido (inclui order_items para cálculo de lucro)
        const detail = await fetchML<any>(`/orders/${order.id}`).catch(() => null);

        // Calcular lucro
        const { lucro, rastreio } = await calculateOrderProfit(detail);

        const pedidoPayload: any = {
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
          ...(shipmentFetched ? { ml_shipment_id: String(shipment.id) } : {}),
          ...(shipmentFetched && releaseCheckOk
            ? {
                ml_fiscal_release_at: hasFutureRelease ? fiscalRelease.releaseAt : null,
                ml_fiscal_release_reason: hasFutureRelease ? (fiscalRelease.reason || 'buffered') : null,
                ml_fiscal_release_source: hasFutureRelease ? (fiscalRelease.sourcePath || 'orders_shipments') : null,
                ml_fiscal_release_checked_at: new Date().toISOString(),
              }
            : {}),
        };

        if (existing) {
          const { count: itensCount } = await serviceClient
            .from('pedido_itens')
            .select('*', { head: true, count: 'exact' })
            .eq('pedido_id', existing.id);
          const hasSnapshotItems = Boolean(itensCount && itensCount > 0);
          if (!hasSnapshotItems) {
            pedidoPayload.snapshot_incompleto = true;
            pedidoPayload.snapshot_pendencias = ['pedido_sem_itens', 'snapshot_origem_webhook_parcial'];
            pedidoPayload.sincronizado_em = null;
          }
          await serviceClient.from('pedidos').update(pedidoPayload).eq('id', existing.id);
          const hadReleaseBefore = Boolean(existing.ml_fiscal_release_at);
          if (shipmentFetched && releaseCheckOk && hasFutureRelease) {
            await registrarEventoNfAuditoria({
              pedidoId: String(existing.id),
              mlOrderId: String(order.id || ''),
              mlPackId: order.pack_id ? String(order.pack_id) : null,
              evento: hadReleaseBefore ? 'ml_fiscal_release_window_updated' : 'ml_fiscal_release_window_detected',
              respostaMl: {
                release_at: fiscalRelease.releaseAt,
                reason: fiscalRelease.reason || null,
                source_path: fiscalRelease.sourcePath,
                checked_at: pedidoPayload.ml_fiscal_release_checked_at,
                now_utc: new Date().toISOString(),
                blocked_now: true,
                source: 'orders_v2',
              },
              statusResultante: 'blocked',
            });
          } else if (shipmentFetched && releaseCheckOk && hadReleaseBefore) {
            await registrarEventoNfAuditoria({
              pedidoId: String(existing.id),
              mlOrderId: String(order.id || ''),
              mlPackId: order.pack_id ? String(order.pack_id) : null,
              evento: 'ml_fiscal_release_window_cleared',
              respostaMl: {
                release_at: null,
                reason: fiscalRelease.reason || null,
                source_path: fiscalRelease.sourcePath,
                checked_at: pedidoPayload.ml_fiscal_release_checked_at,
                now_utc: new Date().toISOString(),
                blocked_now: false,
                source: 'orders_v2',
              },
              statusResultante: 'cleared',
            });
          }
          if (!hasSnapshotItems) {
            await registrarEventoNfAuditoria({
              pedidoId: String(existing.id),
              mlOrderId: String(order.id || ''),
              mlPackId: order.pack_id ? String(order.pack_id) : null,
              evento: 'sync_snapshot_partial',
              respostaMl: {
                source: 'webhook_orders_v2',
                motivo: 'webhook_partial_order',
                pendencias: ['pedido_sem_itens', 'snapshot_origem_webhook_parcial'],
              },
              statusResultante: 'partial',
            });
          }
        } else {
          pedidoPayload.snapshot_incompleto = true;
          pedidoPayload.snapshot_pendencias = ['pedido_sem_itens', 'snapshot_origem_webhook_parcial'];
          pedidoPayload.sincronizado_em = null;
          const { data: inserted } = await serviceClient
            .from('pedidos')
            .insert(pedidoPayload)
            .select('id')
            .single();
          if (inserted?.id && shipmentFetched && releaseCheckOk && hasFutureRelease) {
            await registrarEventoNfAuditoria({
              pedidoId: String(inserted.id),
              mlOrderId: String(order.id || ''),
              mlPackId: order.pack_id ? String(order.pack_id) : null,
              evento: 'ml_fiscal_release_window_detected',
              respostaMl: {
                release_at: fiscalRelease.releaseAt,
                reason: fiscalRelease.reason || null,
                source_path: fiscalRelease.sourcePath,
                checked_at: pedidoPayload.ml_fiscal_release_checked_at,
                now_utc: new Date().toISOString(),
                blocked_now: true,
                source: 'orders_v2',
              },
              statusResultante: 'blocked',
            });
          }
          if (inserted?.id) {
            await registrarEventoNfAuditoria({
              pedidoId: String(inserted.id),
              mlOrderId: String(order.id || ''),
              mlPackId: order.pack_id ? String(order.pack_id) : null,
              evento: 'sync_snapshot_partial',
              respostaMl: {
                source: 'webhook_orders_v2',
                motivo: 'webhook_partial_order',
                pendencias: ['pedido_sem_itens', 'snapshot_origem_webhook_parcial'],
              },
              statusResultante: 'partial',
            });
          }
        }
      }
    }

    if (topic === 'questions') {
      // Notificações de perguntas — serão processadas sob demanda
    }

    if (topic === 'items') {
      const itemResult = await fetchMLResult<any>(resourcePath);
      if (!itemResult.ok || !itemResult.data) {
        console.warn(JSON.stringify({
          event: 'ml_items_webhook_fetch_failed',
          timestamp_utc: new Date().toISOString(),
          resource,
          resource_path: resourcePath,
          status: itemResult.status,
          error: itemResult.error?.message || 'Falha ao consultar item do ML após webhook',
        }));
      } else {
        const reconcileResult = await reconcileAnuncioMlFromItem(
          serviceClient,
          itemResult.data,
          'items_webhook',
        );
        if (!reconcileResult.ok) {
          console.error(JSON.stringify({
            event: 'ml_items_webhook_reconcile_failed',
            timestamp_utc: new Date().toISOString(),
            resource,
            resource_path: resourcePath,
            ml_item_id: reconcileResult.mlItemId,
            error: reconcileResult.error,
          }));
        }
      }
    }

    if (topic === 'shipments' || topic === 'shipment_update') {
      const shipment = await fetchML<any>(resourcePath);
      if (shipment?.id) {
        const releaseInfo = await resolveFiscalReleaseWindow(shipment);
        const releaseCheckOk = releaseInfo.releaseCheckOk;
        const fiscalRelease = releaseInfo.releaseWindow;
        const hasFutureRelease = Boolean(fiscalRelease.releaseAt && fiscalRelease.isBlockedNow);
        // Buscar pedido associado ao shipment
        const orderId = shipment.order_id || shipment.resource_id;
        if (orderId) {
          const situacao = mapearStatusShipment(shipment.status, shipment.substatus);
          // Não sobrescrever devolvido
          const { data: pedido } = await serviceClient
            .from('pedidos')
            .select('id,situacao,ml_fiscal_release_at,ml_pack_id')
            .eq('ml_order_id', String(orderId))
            .maybeSingle();
          const situacaoFinal = pedido?.situacao === 'devolvido' ? 'devolvido' : situacao;
          await serviceClient
            .from('pedidos')
            .update({
              ml_shipment_id: String(shipment.id),
              situacao: situacaoFinal as any,
              ...(releaseCheckOk
                ? {
                    ml_fiscal_release_at: hasFutureRelease ? fiscalRelease.releaseAt : null,
                    ml_fiscal_release_reason: hasFutureRelease ? (fiscalRelease.reason || 'buffered') : null,
                    ml_fiscal_release_source: hasFutureRelease ? (fiscalRelease.sourcePath || 'shipments_topic') : null,
                    ml_fiscal_release_checked_at: new Date().toISOString(),
                  }
                : {}),
            })
            .eq('ml_order_id', String(orderId));

          if (pedido?.id) {
            const hadReleaseBefore = Boolean((pedido as any).ml_fiscal_release_at);
            if (releaseCheckOk && hasFutureRelease) {
              await registrarEventoNfAuditoria({
                pedidoId: String((pedido as any).id),
                mlOrderId: String(orderId),
                mlPackId: (pedido as any).ml_pack_id ? String((pedido as any).ml_pack_id) : null,
                evento: hadReleaseBefore ? 'ml_fiscal_release_window_updated' : 'ml_fiscal_release_window_detected',
                respostaMl: {
                  release_at: fiscalRelease.releaseAt,
                  reason: fiscalRelease.reason || null,
                  source_path: fiscalRelease.sourcePath,
                  checked_at: new Date().toISOString(),
                  now_utc: new Date().toISOString(),
                  blocked_now: true,
                  source: 'shipments_topic',
                },
                statusResultante: 'blocked',
              });
            } else if (releaseCheckOk && hadReleaseBefore) {
              await registrarEventoNfAuditoria({
                pedidoId: String((pedido as any).id),
                mlOrderId: String(orderId),
                mlPackId: (pedido as any).ml_pack_id ? String((pedido as any).ml_pack_id) : null,
                evento: 'ml_fiscal_release_window_cleared',
                respostaMl: {
                  release_at: null,
                  reason: fiscalRelease.reason || null,
                  source_path: fiscalRelease.sourcePath,
                  checked_at: new Date().toISOString(),
                  now_utc: new Date().toISOString(),
                  blocked_now: false,
                  source: 'shipments_topic',
                },
                statusResultante: 'cleared',
              });
            }
          }
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
      await registrarEventoNfAuditoria({
        pedidoId: null,
        mlOrderId: null,
        mlPackId: null,
        evento: 'ml_fiscal_webhook_ignored',
        respostaMl: {
          motivo: 'fiscal_ml_desativado_por_politica',
          topic,
          resource,
          observacao: 'Webhook fiscal do ML ignorado sem consulta ao endpoint de invoices por política.',
        },
        statusResultante: 'ignored',
      });
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
