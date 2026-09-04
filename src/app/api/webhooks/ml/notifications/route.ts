import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML, fetchMLResult } from '@/services/integration';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';
import { extractMlFiscalReleaseWindow } from '@/lib/ml/fiscal-release';
import { reconcileAnuncioMlFromItem } from '@/lib/ml/reconcile-anuncio';
import { runMlSingleStageJob } from '@/services/sync-ml-job';
import { resolveOrderSaleDate } from '@/lib/ml/order-sale-date';
import { mapearStatusShipment } from '@/lib/ml/shipment-status';
import { alertMlLabelReleased, alertNewQuestion, alertNewSale } from '@/services/whatsapp-alerts';
import { pushEvents } from '@/services/push-notifications';
import {
  enfileirarSyncMlEstoqueInterno,
  estornarReservaEnvioInternoCancelado,
  isEnderecoEstoqueInternoMl,
  obterEnderecoRetornoPadraoMl,
  registrarDevolucaoInterna,
} from '@/lib/estoque-interno';
import { detachDeletedMlListing, isMlListingDeleted } from '@/lib/ml/listing-deletion';
import { isMlOrderPaid } from '@/lib/ml/order-sale-alert';
import { resolveWebhookOrderSituation } from '@/lib/ml/webhook-order-stub';
import { createSupplierCancellationCreditCandidate } from '@/lib/supplier-credits';
import {
  ML_ORDER_HYDRATION_JOB_TYPE,
  normalizeMlOrderHydrationKey,
} from '@/lib/sync/ml-order-hydration';
import { validateMercadoLivreWebhookUser } from '@/lib/ml-account-guard';

const WEBHOOK_STUB_PENDING_TAGS = ['pedido_sem_itens', 'webhook_hydration_pending', 'snapshot_origem_webhook_stub'];

function normalizeResourcePath(resource: string): string {
  const normalized = String(resource || '').replace('https://api.mercadolibre.com', '').trim();
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function extractOrderIdFromResourcePath(resourcePath: string): string | null {
  const match = String(resourcePath || '').match(/^\/orders\/([^/?]+)/i);
  return match?.[1] ? String(match[1]).trim() : null;
}

function mergePendingTags(current: unknown, next: string[]): string[] {
  const currentTags = Array.isArray(current)
    ? current.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...currentTags, ...next]));
}

function buildWebhookStubPayload(order: any, existing: any) {
  const needsHydration = !existing?.id || Boolean(existing?.snapshot_incompleto) || !existing?.sincronizado_em;
  const saleDate = resolveOrderSaleDate(order);
  return {
    numero: Number(order.id) || 0,
    numero_loja: String(order.id || ''),
    data: order.date_created || new Date().toISOString(),
    data_venda: saleDate.value || order.date_created || new Date().toISOString(),
    data_venda_source: saleDate.source,
    contato_nome: order.buyer?.nickname || existing?.contato_nome || 'Desconhecido',
    contato_documento: String(order.buyer?.identification?.number || existing?.contato_documento || ''),
    total: order.total_amount || existing?.total || 0,
    situacao: resolveWebhookOrderSituation({
      orderStatus: order.status,
      existingSituation: existing?.situacao,
    }),
    ml_order_id: String(order.id || ''),
    ml_pack_id: order.pack_id ? String(order.pack_id) : null,
    ...(needsHydration
      ? {
          snapshot_incompleto: true,
          snapshot_pendencias: mergePendingTags(existing?.snapshot_pendencias, WEBHOOK_STUB_PENDING_TAGS),
          sincronizado_em: null,
        }
      : {}),
  };
}

async function persistWebhookOrderStub(params: {
  serviceClient: ReturnType<typeof createServiceClient>;
  order: any;
  existing: any;
}) {
  const { serviceClient, order, existing } = params;
  const mlOrderId = String(order?.id || '').trim();
  if (!mlOrderId) return null;

  const payload = buildWebhookStubPayload(order, existing);
  const shouldReconcileConcretization = existing?.situacao === 'em_transito'
    && String(order?.status || '').toLowerCase() === 'paid'
    && Array.isArray(order?.payments)
    && order.payments.some((payment: any) => (
      String(payment?.status || '').toLowerCase() === 'approved'
      && Boolean(String(payment?.id || '').trim())
    ));
  const shouldHydrate = !existing?.id
    || Boolean(existing?.snapshot_incompleto)
    || !existing?.sincronizado_em
    || shouldReconcileConcretization;

  if (existing?.id) {
    await serviceClient
      .from('pedidos')
      .update(payload)
      .eq('id', existing.id);
    return {
      pedidoId: String(existing.id),
      action: 'updated' as const,
      shouldHydrate,
    };
  }

  const { data: inserted, error } = await serviceClient
    .from('pedidos')
    .insert(payload)
    .select('id')
    .single();

  if (error || !inserted?.id) {
    throw new Error(error?.message || 'Falha ao criar pedido stub do webhook');
  }

  return {
    pedidoId: String(inserted.id),
    action: 'inserted' as const,
    shouldHydrate: true,
  };
}

async function persistWebhookOrderPendingStub(params: {
  serviceClient: ReturnType<typeof createServiceClient>;
  mlOrderId: string;
  existing: any;
}) {
  const { serviceClient, mlOrderId, existing } = params;
  const normalizedMlOrderId = String(mlOrderId || '').trim();
  if (!normalizedMlOrderId) return null;

  const now = new Date().toISOString();
  const payload = {
    numero: Number(normalizedMlOrderId) || 0,
    numero_loja: normalizedMlOrderId,
    data: existing?.data || now,
    data_venda: existing?.data_venda || now,
    data_venda_source: existing?.data_venda_source || 'webhook_resource_pending',
    contato_nome: existing?.contato_nome || 'Desconhecido',
    contato_documento: String(existing?.contato_documento || ''),
    total: existing?.total || 0,
    situacao: existing?.situacao || 'aberto',
    ml_order_id: normalizedMlOrderId,
    snapshot_incompleto: true,
    snapshot_pendencias: mergePendingTags(existing?.snapshot_pendencias, WEBHOOK_STUB_PENDING_TAGS),
    snapshot_source: 'webhook_orders_v2_pending',
    sincronizado_em: null,
  };

  if (existing?.id) {
    await serviceClient
      .from('pedidos')
      .update(payload)
      .eq('id', existing.id);
    return {
      pedidoId: String(existing.id),
      action: 'updated' as const,
    };
  }

  const { data: inserted, error } = await serviceClient
    .from('pedidos')
    .insert(payload as any)
    .select('id')
    .single();

  if (error || !inserted?.id) {
    throw new Error(error?.message || 'Falha ao criar pedido pendente do webhook');
  }

  return {
    pedidoId: String(inserted.id),
    action: 'inserted' as const,
  };
}

async function queueOrderHydrationJob(params: {
  serviceClient: ReturnType<typeof createServiceClient>;
  mlOrderId: string;
  resourcePath: string;
  receivedAt: string;
  pedidoId?: string | null;
}) {
  const { serviceClient, mlOrderId, resourcePath, receivedAt, pedidoId } = params;
  const dedupeKey = normalizeMlOrderHydrationKey(mlOrderId);
  if (!dedupeKey) {
    throw new Error('ID do pedido ML inválido para fila de hidratação');
  }

  const { data: existingJob, error: existingJobError } = await serviceClient
    .from('jobs')
    .select('id,status')
    .eq('tipo', ML_ORDER_HYDRATION_JOB_TYPE)
    .eq('dedupe_key', dedupeKey)
    .in('status', ['pendente', 'rodando', 'on_hold'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingJobError) {
    throw new Error(`Falha ao consultar fila de hidratação: ${existingJobError.message}`);
  }
  if (existingJob?.id) {
    return { id: String(existingJob.id), created: false, status: String(existingJob.status || '') };
  }

  const initialLog = [
    {
      event_type: 'webhook_dispatch',
      type: 'info',
      message: `Hidratacao assíncrona enfileirada para pedido ${mlOrderId}`,
      timestamp: new Date().toISOString(),
      source: 'webhook_orders_v2',
      ml_order_id: mlOrderId,
      resource_path: resourcePath,
      received_at: receivedAt,
      attempt: 1,
    },
  ];

  const { data: insertedJob, error } = await serviceClient
    .from('jobs')
    .insert({
      tipo: ML_ORDER_HYDRATION_JOB_TYPE,
      dedupe_key: dedupeKey,
      status: 'pendente',
      progresso: 0,
      total: 1,
      processados: 0,
      log: initialLog,
      cancelado: false,
      created_by: null,
    })
    .select('id, status')
    .single();

  if (error?.code === '23505') {
    const { data: concurrentJob } = await serviceClient
      .from('jobs')
      .select('id,status')
      .eq('tipo', ML_ORDER_HYDRATION_JOB_TYPE)
      .eq('dedupe_key', dedupeKey)
      .in('status', ['pendente', 'rodando', 'on_hold'])
      .limit(1)
      .maybeSingle();
    if (concurrentJob?.id) {
      return { id: String(concurrentJob.id), created: false, status: String(concurrentJob.status || '') };
    }
  }
  if (error || !insertedJob?.id) {
    throw new Error(error?.message || 'Falha ao enfileirar job de hidratacao do webhook');
  }

  setTimeout(() => {
    void (async () => {
      await registrarEventoNfAuditoria({
        pedidoId: pedidoId || null,
        mlOrderId,
        mlPackId: null,
        evento: 'webhook_deferred_processing_started',
        respostaMl: {
          source: 'webhook_orders_v2',
          resource_path: resourcePath,
          job_id: insertedJob.id,
          job_tipo: 'ml_orders_v2_hydration',
          received_at: receivedAt,
          hydration_target: 'sync_pedidos',
          trigger_source: 'webhook_async',
          attempt: 1,
        },
        statusResultante: 'queued',
      });

      try {
        const result = await runMlSingleStageJob({
          jobId: insertedJob.id,
          tipo: ML_ORDER_HYDRATION_JOB_TYPE,
          path: '/api/sync/pedidos',
          label: 'ML Orders V2 Hydration',
          query: { mlOrderId },
          body: {
            mlOrderId,
            triggerSource: 'webhook_async',
            source: 'webhook_orders_v2',
          },
          retryOnFailure: true,
        });

        const deferred = result.status === 'on_hold';

        await registrarEventoNfAuditoria({
          pedidoId: pedidoId || null,
          mlOrderId,
          mlPackId: null,
          evento: result.status === 'completo'
            ? 'webhook_deferred_processing_success'
            : deferred
              ? 'webhook_deferred_processing_deferred'
              : 'webhook_deferred_processing_failed',
          respostaMl: {
            source: 'webhook_orders_v2',
            resource_path: resourcePath,
            job_id: insertedJob.id,
            job_tipo: 'ml_orders_v2_hydration',
            hydration_target: 'sync_pedidos',
            trigger_source: 'webhook_async',
            job_status: result.status,
            processados: result.processados,
            total: result.total,
          },
          statusResultante: result.status,
        });
      } catch (err: any) {
        await registrarEventoNfAuditoria({
          pedidoId: pedidoId || null,
          mlOrderId,
          mlPackId: null,
          evento: 'webhook_deferred_processing_failed',
          respostaMl: {
            source: 'webhook_orders_v2',
            resource_path: resourcePath,
            job_id: insertedJob.id,
            job_tipo: 'ml_orders_v2_hydration',
            hydration_target: 'sync_pedidos',
            trigger_source: 'webhook_async',
            error: err?.message || 'erro_desconhecido',
          },
          statusResultante: 'erro',
        });
      }
    })();
  }, 0);

  return { id: String(insertedJob.id), created: true, status: String(insertedJob.status || 'pendente') };
}

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
  const startedAtMs = Date.now();
  try {
    const body = await request.json();
    const { topic, resource, user_id: userId } = body;

    if (!topic || !resource) {
      return NextResponse.json({ ok: false, erro: 'topic e resource obrigatórios' }, { status: 400 });
    }

    const webhookUser = validateMercadoLivreWebhookUser(userId);
    if (!webhookUser.allowed) {
      console.warn(JSON.stringify({
        event: 'ml_webhook_user_ignored',
        timestamp_utc: new Date().toISOString(),
        topic,
        resource,
        user_id: webhookUser.userId,
        reason: webhookUser.reason,
      }));
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: webhookUser.reason,
      });
    }

    const serviceClient = createServiceClient();
    const resourcePath = normalizeResourcePath(resource);

    if (topic === 'orders_v2') {
      const receivedAt = new Date().toISOString();
      const mlOrderIdFromResource = extractOrderIdFromResourcePath(resourcePath);
      const orderResult = await fetchMLResult<any>(resourcePath);
      const order = orderResult.ok ? orderResult.data : null;
      const mlOrderId = String(order?.id || mlOrderIdFromResource || '').trim();
      const { data: existingPedido } = mlOrderId
        ? await serviceClient
            .from('pedidos')
            .select('id,contato_nome,contato_documento,total,situacao,snapshot_incompleto,snapshot_pendencias,sincronizado_em,ml_pack_id')
            .eq('ml_order_id', mlOrderId)
            .maybeSingle()
        : { data: null };

      if (mlOrderId) {
        void registrarEventoNfAuditoria({
          pedidoId: null,
          mlOrderId,
          mlPackId: order?.pack_id ? String(order.pack_id) : null,
          evento: 'webhook_received',
          respostaMl: {
            topic,
            resource,
            resource_path: resourcePath,
            source: 'webhook_orders_v2',
            received_at: receivedAt,
            fetch_order_ok: orderResult.ok,
            upstream_status: orderResult.status,
          },
          statusResultante: 'received',
        });
      }

      let pedidoId: string | null = null;
      let shouldHydrate = Boolean(mlOrderId) && (!existingPedido?.id || Boolean(existingPedido?.snapshot_incompleto) || !existingPedido?.sincronizado_em);
      if (order) {
        const stubResult = await persistWebhookOrderStub({
          serviceClient,
          order,
          existing: existingPedido,
        });
        pedidoId = stubResult?.pedidoId || null;
        shouldHydrate = stubResult?.shouldHydrate ?? shouldHydrate;
        if (pedidoId && order.status === 'cancelled') {
          const estorno = await estornarReservaEnvioInternoCancelado(
            pedidoId,
            `Pedido ${String(order.id)} cancelado no Mercado Livre`,
          );
          if (estorno.estornadas > 0) {
            await registrarEventoNfAuditoria({
              pedidoId,
              mlOrderId: String(order.id),
              mlPackId: order.pack_id ? String(order.pack_id) : null,
              evento: 'estoque_interno_saida_estornada_cancelamento',
              respostaMl: {
                movimentos_estornados: estorno.estornadas,
                produtos: estorno.produtoIds,
                source: 'webhook_orders_v2',
              },
              statusResultante: 'success',
            });
          }
          try {
            await createSupplierCancellationCreditCandidate(serviceClient, pedidoId, 'ml_webhook');
          } catch (creditError) {
            console.error('[supplier-credits] Falha ao registrar cancelamento recebido por webhook:', creditError);
          }
        }
        if (isMlOrderPaid(order)) {
          void alertNewSale({
            id: pedidoId,
            numero: order.id,
            ml_order_id: String(order.id || ''),
            ml_pack_id: order.pack_id ? String(order.pack_id) : null,
            contato_nome: order.buyer?.nickname || 'Desconhecido',
            total: Number(order.total_amount || 0),
            status: order.status || null,
          });
          if (stubResult?.action === 'inserted') {
            void pushEvents().newSale({
              id: pedidoId,
              ml_order_id: String(order.id || ''),
              contato_nome: order.buyer?.nickname || 'Desconhecido',
              total: Number(order.total_amount || 0),
            }).catch(() => null);
          }
        }
      } else if (mlOrderId) {
        const stubResult = await persistWebhookOrderPendingStub({
          serviceClient,
          mlOrderId,
          existing: existingPedido,
        });
        pedidoId = stubResult?.pedidoId || null;
        // O ML pode notificar antes de liberar /orders/{id}; evita jobs imediatos que falham e deixa o cron hidratar.
        shouldHydrate = false;
      }

      if (mlOrderId && shouldHydrate) {
        await queueOrderHydrationJob({
          serviceClient,
          mlOrderId,
          resourcePath,
          receivedAt,
          pedidoId,
        });
      }

      if (mlOrderId) {
        void registrarEventoNfAuditoria({
          pedidoId,
          mlOrderId,
          mlPackId: order?.pack_id ? String(order.pack_id) : null,
          evento: 'webhook_acked',
          respostaMl: {
            topic,
            resource,
            resource_path: resourcePath,
            source: 'webhook_orders_v2',
            ack_duration_ms: Date.now() - startedAtMs,
            fetch_order_ok: orderResult.ok,
            upstream_status: orderResult.status,
            stub_persisted: Boolean(pedidoId),
            hydration_queued: Boolean(mlOrderId && shouldHydrate),
          },
          statusResultante: 'acked',
        });
      }

      return NextResponse.json({ ok: true, queued: Boolean(mlOrderId && shouldHydrate), mlOrderId: mlOrderId || null });
    }

    if (topic === 'questions') {
      const questionResult = await fetchMLResult<any>(resourcePath);
      if (!questionResult.ok || !questionResult.data) {
        console.warn(JSON.stringify({
          event: 'ml_questions_webhook_fetch_failed',
          timestamp_utc: new Date().toISOString(),
          resource,
          resource_path: resourcePath,
          status: questionResult.status,
          error_code: questionResult.error?.code || null,
          error_category: questionResult.error?.category || null,
          trace_id: questionResult.error?.traceId || null,
          error: questionResult.error?.message || 'Falha ao consultar pergunta do ML após webhook',
        }));
      } else {
        const question = questionResult.data;
        const isUnanswered = String(question.status || '').toUpperCase() === 'UNANSWERED' && !question.answer;
        if (isUnanswered) {
          let itemTitle: string | null = null;
          let itemPermalink: string | null = null;
          const itemId = String(question.item_id || '').trim();
          if (itemId) {
            const itemResult = await fetchMLResult<any>(
              `/items/${encodeURIComponent(itemId)}?attributes=id,title,permalink`,
            );
            if (itemResult.ok && itemResult.data) {
              itemTitle = itemResult.data.title || null;
              itemPermalink = itemResult.data.permalink || null;
            }
          }

          void alertNewQuestion({
            id: question.id,
            item_id: question.item_id || null,
            item_title: itemTitle,
            item_permalink: itemPermalink,
            text: question.text || null,
            buyer_id: question.from?.id || null,
            date_created: question.date_created || null,
            status: question.status || null,
          });
          void pushEvents().newQuestion({
            id: question.id,
            item_title: itemTitle,
            text: question.text || null,
          }).catch(() => null);
        }
      }
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
          error_code: itemResult.error?.code || null,
          error_category: itemResult.error?.category || null,
          trace_id: itemResult.error?.traceId || null,
          error: itemResult.error?.message || 'Falha ao consultar item do ML após webhook',
        }));
      } else {
        const mlItemId = String(itemResult.data.id || '').trim();
        if (mlItemId && isMlListingDeleted(itemResult.data)) {
          try {
            await detachDeletedMlListing(serviceClient, mlItemId);
            console.log(JSON.stringify({
              event: 'ml_deleted_listing_detached',
              timestamp_utc: new Date().toISOString(),
              ml_item_id: mlItemId,
              source: 'items_webhook',
            }));
          } catch (error: any) {
            console.error(JSON.stringify({
              event: 'ml_deleted_listing_detach_failed',
              timestamp_utc: new Date().toISOString(),
              ml_item_id: mlItemId,
              error: error?.message || 'Falha ao remover referências de anúncio excluído',
            }));
          }
          return NextResponse.json({ received: true, deleted_listing_detached: true });
        }
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

        const observedStatus = String(itemResult.data.status || '').trim().toLowerCase();
        if (mlItemId && ['active', 'paused'].includes(observedStatus)) {
          try {
            const { data: linkedListing, error: linkedListingError } = await serviceClient
              .from('anuncios_ml')
              .select('produto_id')
              .eq('ml_item_id', mlItemId)
              .maybeSingle();
            if (linkedListingError) throw new Error(linkedListingError.message);

            let produtoId = String(linkedListing?.produto_id || '').trim();
            if (!produtoId) {
              const { data: linkedProduct, error: linkedProductError } = await serviceClient
                .from('produtos')
                .select('id')
                .eq('ml_item_id', mlItemId)
                .maybeSingle();
              if (linkedProductError) throw new Error(linkedProductError.message);
              produtoId = String(linkedProduct?.id || '').trim();
            }

            if (produtoId) {
              const stockSync = await enfileirarSyncMlEstoqueInterno(produtoId, {
                mlItemId,
                availableQuantity: itemResult.data.available_quantity === null
                  || itemResult.data.available_quantity === undefined
                  ? null
                  : Number(itemResult.data.available_quantity),
                status: observedStatus,
              });
              console.log(JSON.stringify({
                event: 'ml_items_webhook_authoritative_stock',
                timestamp_utc: new Date().toISOString(),
                ml_item_id: mlItemId,
                produto_id: produtoId,
                observed_quantity: itemResult.data.available_quantity ?? null,
                observed_status: observedStatus,
                enqueued: stockSync.enfileirados,
                unchanged: stockSync.semAlteracao,
                processing: stockSync.emProcessamento,
                manually_blocked: stockSync.bloqueadosManualmente,
              }));
            }
          } catch (error: any) {
            console.error(JSON.stringify({
              event: 'ml_items_webhook_authoritative_stock_failed',
              timestamp_utc: new Date().toISOString(),
              ml_item_id: mlItemId,
              error: error?.message || 'Falha ao restaurar estoque autoritativo do Vortek',
            }));
          }
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
          // Não sobrescrever devolvido
          const { data: pedido } = await serviceClient
            .from('pedidos')
            .select('id,situacao,ml_fiscal_release_at,ml_pack_id')
            .eq('ml_order_id', String(orderId))
            .maybeSingle();
          const situacao = mapearStatusShipment(
            shipment.status,
            shipment.substatus,
            pedido?.situacao || null,
          );
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
            const shipmentStatus = String(shipment.status || '').toLowerCase();
            const shipmentSubstatus = String(shipment.substatus || '').toLowerCase();
            const isReturningToSender =
              shipmentStatus === 'not_delivered' &&
              ['returning_to_sender', 'returned'].includes(shipmentSubstatus);
            if (isReturningToSender) {
              const enderecoRetornoPadrao = await obterEnderecoRetornoPadraoMl();
              await registrarDevolucaoInterna(
                String(pedido.id),
                pedido.situacao === 'dest_ausente' ? 'Destinatário ausente' : 'Entrega não realizada',
                shipmentSubstatus,
                isEnderecoEstoqueInternoMl(enderecoRetornoPadrao),
              );
            }

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
              void alertMlLabelReleased({
                id: String((pedido as any).id),
                numero: String(orderId),
                ml_order_id: String(orderId),
                ml_shipment_id: String(shipment.id),
                ml_fiscal_release_at: (pedido as any).ml_fiscal_release_at || null,
                situacao: (pedido as any).situacao || null,
              });
            }
          }
        }
      }
    }

    const postPurchaseActions = Array.isArray(body.actions)
      ? body.actions.map((action: unknown) => String(action || '').toLowerCase())
      : [];
    const isClaimNotification =
      topic === 'claims' ||
      topic === 'claim_update' ||
      (topic === 'post_purchase' &&
        postPurchaseActions.some((action: string) => ['claims', 'claims_actions'].includes(action)));

    if (isClaimNotification) {
      const claim = await fetchML<any>(resourcePath);
      if (claim?.resource_id && claim.resource === 'order') {
        const mlOrderId = String(claim.resource_id);
        const isDevolvido = claim.resolution?.reason === 'item_returned' ||
                           (claim.resolution?.closed_by === 'mediator' &&
                            claim.resolution?.benefited?.includes('complainant'));
        const situacao = isDevolvido ? 'devolvido' : undefined;
        const { data: pedido } = await serviceClient
          .from('pedidos')
          .update({
            ml_claim_id: String(claim.id),
            ml_claim_status: claim.status || null,
            ...(situacao ? { situacao } : {}),
          })
          .eq('ml_order_id', mlOrderId)
          .select('id')
          .maybeSingle();
        if (String(claim.status || '').toLowerCase() === 'opened') {
          void pushEvents().claimOpened({
            ml_order_id: mlOrderId,
            ml_claim_id: String(claim.id || ''),
          }).catch(() => null);
        }
        await queueOrderHydrationJob({
          serviceClient,
          mlOrderId,
          resourcePath,
          receivedAt: new Date().toISOString(),
          pedidoId: pedido?.id ? String(pedido.id) : null,
        });
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
