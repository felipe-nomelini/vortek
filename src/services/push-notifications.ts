import webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase';
import { notificationAppLink } from '@/lib/configuracoes/notifications';
import type { Json } from '@/types/database';

type PushEventType = 'new_sale' | 'new_question' | 'claim_opened' | 'test';

type PushInput = {
  eventType: PushEventType;
  title: string;
  body: string;
  url: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  userId?: string;
};

const MAX_ATTEMPTS = 5;

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

async function recipients(input: PushInput): Promise<string[]> {
  if (input.userId) return [input.userId];
  const client = createServiceClient();
  const [policyResult, targetsResult, profilesResult, usersResult] = await Promise.all([
    client
      .from('push_alert_settings')
      .select('enabled')
      .eq('alert_type', input.eventType)
      .maybeSingle(),
    client
      .from('push_alert_recipients')
      .select('recipient_role,user_id')
      .eq('alert_type', input.eventType),
    client.from('profiles').select('id,cargo'),
    client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (policyResult.error) throw new Error(`Falha ao consultar política push: ${policyResult.error.message}`);
  if (targetsResult.error) throw new Error(`Falha ao consultar destinatários push: ${targetsResult.error.message}`);
  if (profilesResult.error) throw new Error(`Falha ao consultar usuários push: ${profilesResult.error.message}`);
  if (usersResult.error) throw new Error(`Falha ao consultar estado dos usuários push: ${usersResult.error.message}`);
  if (!policyResult.data?.enabled) return [];

  const roles = new Set((targetsResult.data || []).map((target) => target.recipient_role).filter(Boolean));
  const explicitUsers = new Set((targetsResult.data || []).map((target) => target.user_id).filter(Boolean));
  const activeUsers = new Set(usersResult.data.users.filter((user) => {
    if (!user.banned_until) return true;
    const bannedUntil = Date.parse(user.banned_until);
    return Number.isNaN(bannedUntil) || bannedUntil <= Date.now();
  }).map((user) => user.id));

  return Array.from(new Set((profilesResult.data || [])
    .filter((profile) => activeUsers.has(profile.id))
    .filter((profile) => explicitUsers.has(profile.id) || roles.has(profile.cargo))
    .map((profile) => profile.id)));
}

export async function enqueuePushNotification(input: PushInput) {
  const client = createServiceClient();
  const url = notificationAppLink(input.url);
  if (!url) return { queued: 0, skipped: true, reason: 'app_url_not_configured' as const };

  const userIds = await recipients(input);
  if (!userIds.length) return { queued: 0, skipped: true, reason: 'no_active_recipients' as const };

  const rows = userIds.map((userId) => ({
    user_id: userId,
    event_type: input.eventType,
    title: input.title,
    body: input.body,
    url,
    payload: (input.payload || {}) as Json,
    dedupe_key: input.dedupeKey,
    status: 'pending',
    available_at: new Date().toISOString(),
  }));
  const { error } = await client.from('push_notification_outbox')
    .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  if (error) throw new Error(`Falha ao enfileirar push: ${error.message}`);
  return { queued: rows.length, skipped: false, reason: null };
}

export async function dispatchPushNotifications(limit = 50) {
  if (!configureWebPush()) return { sent: 0, retry: 0, failed: 0, skipped: 'vapid_not_configured' };
  const client = createServiceClient();
  const now = new Date().toISOString();
  const { data: pending } = await client.from('push_notification_outbox')
    .select('*')
    .in('status', ['pending', 'retry'])
    .lte('available_at', now)
    .order('created_at', { ascending: true })
    .limit(limit);

  let sent = 0;
  let retry = 0;
  let failed = 0;
  for (const notification of pending || []) {
    const attempts = Number(notification.attempts || 0) + 1;
    await client.from('push_notification_outbox').update({ status: 'processing', attempts, updated_at: now }).eq('id', notification.id);
    const { data: subscriptions } = await client.from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', notification.user_id);
    if (!subscriptions?.length) {
      await client.from('push_notification_outbox').update({ status: 'skipped', last_error: 'Usuário sem inscrição push ativa', updated_at: now }).eq('id', notification.id);
      continue;
    }

    const payload = JSON.stringify({
      eventType: notification.event_type,
      title: notification.title,
      body: notification.body,
      url: notification.url,
      tag: `${notification.event_type}:${notification.dedupe_key}`,
      data: notification.payload || {},
    });
    let delivered = false;
    let lastError = '';
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
        delivered = true;
      } catch (error: any) {
        lastError = error?.body || error?.message || 'Falha ao enviar push';
        if ([404, 410].includes(Number(error?.statusCode))) {
          await client.from('push_subscriptions').delete().eq('id', subscription.id);
        }
      }
    }
    if (delivered) {
      sent += 1;
      await client.from('push_notification_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('id', notification.id);
    } else if (attempts >= MAX_ATTEMPTS) {
      failed += 1;
      await client.from('push_notification_outbox').update({ status: 'failed', last_error: lastError.slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', notification.id);
    } else {
      retry += 1;
      await client.from('push_notification_outbox').update({ status: 'retry', last_error: lastError.slice(0, 1000), available_at: new Date(Date.now() + attempts * 60000).toISOString(), updated_at: new Date().toISOString() }).eq('id', notification.id);
    }
  }
  return { sent, retry, failed };
}

async function notify(input: PushInput) {
  const result = await enqueuePushNotification(input);
  if (result.queued > 0) void dispatchPushNotifications().catch(() => null);
  return result;
}

export function pushEvents() {
  return {
    newSale: (order: { id?: string | null; ml_order_id?: string | null; contato_nome?: string | null; total?: number | null }) => {
      const orderId = String(order.ml_order_id || order.id || 'unknown');
      return notify({ eventType: 'new_sale', title: 'Nova venda', body: `Pedido #${orderId} · ${order.contato_nome || 'Cliente'} · R$ ${Number(order.total || 0).toFixed(2)}`, url: `/pedidos?search=${encodeURIComponent(orderId)}`, dedupeKey: `new_sale:${orderId}`, payload: order as Record<string, unknown> });
    },
    newQuestion: (question: { id: string | number; item_title?: string | null; text?: string | null }) => notify({ eventType: 'new_question', title: 'Nova pergunta ML', body: question.item_title || question.text || 'Pergunta aguardando resposta', url: '/perguntas', dedupeKey: `new_question:${question.id}`, payload: question }),
    claimOpened: (claim: { id?: string | null; ml_order_id?: string | null; ml_claim_id?: string | null; contato_nome?: string | null }) => notify({ eventType: 'claim_opened', title: 'Nova reclamação ML', body: `Pedido #${claim.ml_order_id || claim.id || '—'} · Claim ${claim.ml_claim_id || '—'}`, url: `/pedidos?search=${encodeURIComponent(String(claim.ml_order_id || claim.id || ''))}`, dedupeKey: `claim_opened:${claim.ml_claim_id}`, payload: claim as Record<string, unknown> }),
  };
}
