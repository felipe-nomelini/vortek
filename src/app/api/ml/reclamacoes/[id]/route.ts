import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  claimResponsibleLabel,
  claimStageLabel,
  claimStatusLabel,
  claimTypeLabel,
  classifyClaimPriority,
  normalizeClaimAvailableActions,
  type ClaimDetailResponse,
  type ClaimListItem,
  type ClaimResponsible,
} from '@/lib/ml/claims';
import { loadClaimsVisualReview, visualReviewMeta } from '@/lib/ml/claims-visual-review';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult, getMLConnectionStatus } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function responsibleValue(value: unknown): ClaimResponsible {
  return value === 'seller' || value === 'buyer' || value === 'mediator' ? value : null;
}

function json(payload: ClaimDetailResponse | { erro: string; precisaReconectar?: boolean }, status = 200) {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!/^\d{1,20}$/.test(id)) return json({ erro: 'Identificador da reclamação inválido.' }, 400);

  try {
    const visualReview = await loadClaimsVisualReview();
    if (visualReview) {
      const detail = visualReview.details[id];
      if (!detail) return json({ erro: 'Reclamação não encontrada.' }, 404);
      return json({ ...detail, visual_review: visualReviewMeta(visualReview) });
    }

    const connection = await getMLConnectionStatus();
    if (!connection.conectado) return json({ erro: 'Mercado Livre desconectado.', precisaReconectar: true }, 401);
    const [meResult, claimResult] = await Promise.all([
      fetchMLResult<Record<string, unknown>>('/users/me'),
      fetchMLResult<Record<string, any>>(`/post-purchase/v1/claims/${encodeURIComponent(id)}`),
    ]);
    const sellerId = meResult.ok ? stringValue(meResult.data?.id) : null;
    if (!sellerId) return json({ erro: 'Não foi possível identificar o vendedor conectado.' }, 502);
    if (!claimResult.ok || !claimResult.data) {
      return json({
        erro: 'Não foi possível consultar a reclamação no Mercado Livre.',
        precisaReconectar: claimResult.error?.category === 'auth_fatal',
      }, claimResult.status === 404 ? 404 : 502);
    }

    const rawClaim = claimResult.data;
    const sellerPlayer = Array.isArray(rawClaim.players)
      ? rawClaim.players.find((player: Record<string, unknown>) => (
          String(player.user_id || '') === sellerId
          && (player.role === 'respondent' || player.type === 'seller')
        ))
      : null;
    if (!sellerPlayer || rawClaim.resource !== 'order') {
      return json({ erro: 'Esta reclamação não pertence às vendas do vendedor conectado.' }, 403);
    }

    const reasonId = stringValue(rawClaim.reason_id);
    const orderId = stringValue(rawClaim.resource_id) || '';
    const serviceClient = createServiceClient();
    const orderContextPromise = Promise.all([
      serviceClient.from('pedidos').select('contato_nome,buyer_ml_id').eq('ml_order_id', orderId).maybeSingle(),
      serviceClient.from('pedido_itens').select('ml_item_id,titulo,quantidade').eq('ml_order_id', orderId),
    ]);
    const [detailResult, messagesResult, actionsResult, statusResult, reputationResult, reasonResult, orderContext] = await Promise.all([
      fetchMLResult<Record<string, unknown>>(`/post-purchase/v1/claims/${encodeURIComponent(id)}/detail`),
      fetchMLResult<unknown[]>(`/post-purchase/v1/claims/${encodeURIComponent(id)}/messages`),
      fetchMLResult<unknown[]>(`/post-purchase/v1/claims/${encodeURIComponent(id)}/actions-history`),
      fetchMLResult<unknown[]>(`/post-purchase/v1/claims/${encodeURIComponent(id)}/status-history`),
      fetchMLResult<Record<string, unknown>>(`/post-purchase/v1/claims/${encodeURIComponent(id)}/affects-reputation`),
      reasonId
        ? fetchMLResult<Record<string, unknown>>(`/post-purchase/v1/claims/reasons/${encodeURIComponent(reasonId)}`)
        : Promise.resolve(null),
      orderContextPromise,
    ]);
    const [orderResult, orderItemsResult] = orderContext;
    const firstItem = orderItemsResult.data?.[0] || null;
    const detail = detailResult.ok ? detailResult.data : null;
    const responsible = responsibleValue(detail?.action_responsible);
    const actions = normalizeClaimAvailableActions(sellerPlayer.available_actions);
    const dueDate = stringValue(detail?.due_date)
      || actions.find((action) => action.mandatory && action.due_date)?.due_date
      || null;
    const status = stringValue(rawClaim.status);
    const claim: ClaimListItem = {
      id,
      order_id: orderId,
      customer_name: stringValue(orderResult.data?.contato_nome),
      buyer_id: stringValue(orderResult.data?.buyer_ml_id),
      item_id: stringValue(firstItem?.ml_item_id),
      item_title: stringValue(firstItem?.titulo),
      item_count: orderItemsResult.data?.length || 0,
      type: stringValue(rawClaim.type),
      type_label: claimTypeLabel(stringValue(rawClaim.type)),
      stage: stringValue(rawClaim.stage),
      stage_label: claimStageLabel(stringValue(rawClaim.stage)),
      status,
      status_label: claimStatusLabel(status),
      reason_id: reasonId,
      problem: stringValue(detail?.problem),
      detail_title: stringValue(detail?.title),
      detail_description: stringValue(detail?.description),
      action_responsible: responsible,
      responsible_label: claimResponsibleLabel(responsible),
      due_date: dueDate,
      priority: classifyClaimPriority({ status, responsible, dueDate }),
      available_actions: actions,
      related_entities: Array.isArray(rawClaim.related_entities) ? rawClaim.related_entities.map(String) : [],
      resolution: rawClaim.resolution && typeof rawClaim.resolution === 'object'
        ? rawClaim.resolution as Record<string, unknown>
        : null,
      claimed_quantity: numberValue(rawClaim.claimed_quantity),
      date_created: stringValue(rawClaim.date_created),
      last_updated: stringValue(rawClaim.last_updated),
      context_available: Boolean(orderResult.data || firstItem),
      is_homologation_fixture: false,
    };
    const unavailable: string[] = [];
    if (!detailResult.ok) unavailable.push('detail');
    if (!messagesResult.ok) unavailable.push('messages');
    if (!actionsResult.ok) unavailable.push('actions_history');
    if (!statusResult.ok) unavailable.push('status_history');
    if (!reputationResult.ok) unavailable.push('affects_reputation');
    if (reasonId && (!reasonResult || !reasonResult.ok)) unavailable.push('reason');
    if (orderResult.error || orderItemsResult.error) unavailable.push('order_context');

    return json({
      claim,
      reason: reasonResult?.ok ? {
        id: stringValue(reasonResult.data?.id) || reasonId || '',
        name: stringValue(reasonResult.data?.name),
        detail: stringValue(reasonResult.data?.detail),
        flow: stringValue(reasonResult.data?.flow),
      } : null,
      messages: messagesResult.ok && Array.isArray(messagesResult.data)
        ? messagesResult.data.map((entry) => {
            const message = entry && typeof entry === 'object' ? entry as Record<string, any> : {};
            return {
              hash: stringValue(message.hash),
              sender_role: stringValue(message.sender_role),
              receiver_role: stringValue(message.receiver_role),
              message: stringValue(message.message),
              date_created: stringValue(message.date_created || message.message_date),
              status: stringValue(message.status),
              stage: stringValue(message.stage),
              attachments: Array.isArray(message.attachments) ? message.attachments.map((attachment: Record<string, unknown>) => ({
                filename: stringValue(attachment.filename) || '',
                original_filename: stringValue(attachment.original_filename),
                type: stringValue(attachment.type),
                size: numberValue(attachment.size),
              })).filter((attachment) => Boolean(attachment.filename)) : [],
            };
          })
        : [],
      actions_history: actionsResult.ok && Array.isArray(actionsResult.data)
        ? actionsResult.data.map((entry) => {
            const action = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
            return {
              action_name: stringValue(action.action_name),
              player_role: stringValue(action.player_role),
              claim_stage: stringValue(action.claim_stage),
              claim_status: stringValue(action.claim_status),
              date_created: stringValue(action.date_created),
            };
          })
        : [],
      status_history: statusResult.ok && Array.isArray(statusResult.data)
        ? statusResult.data.map((entry) => {
            const history = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
            return {
              stage: stringValue(history.stage),
              status: stringValue(history.status),
              date: stringValue(history.date),
              change_by: stringValue(history.change_by),
            };
          })
        : [],
      affects_reputation: reputationResult.ok ? {
        affects_reputation: stringValue(reputationResult.data?.affects_reputation),
        has_incentive: typeof reputationResult.data?.has_incentive === 'boolean'
          ? reputationResult.data.has_incentive
          : null,
        due_date: stringValue(reputationResult.data?.due_date),
      } : null,
      unavailable_sections: unavailable,
    });
  } catch (error) {
    console.error('[ml-claim-detail] Falha ao carregar detalhe:', error);
    return json({ erro: 'Falha ao carregar o detalhe da reclamação.' }, 500);
  }
}
